import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { firebaseClient, BlogPost } from "./firebase";
import { randomUUID } from "crypto";
import { AI_CONFIG } from "./config";

const TEXT_MODEL = AI_CONFIG.BLOG_TEXT_MODEL;
const EMBED_MODEL = AI_CONFIG.BLOG_EMBED_MODEL;

// KST 시간대 ISO 스트링 생성기
function getKstTimeString(): string {
  const now = Date.now();
  const kstOffset = 9 * 60 * 60 * 1000; // KST는 UTC+9
  const kstTime = new Date(now + kstOffset);
  return kstTime.toISOString().replace("Z", "+09:00");
}

// Ollama 임베딩 호출 함수 (폴백 대응)
export async function getOllamaEmbedding(text: string): Promise<number[]> {
  const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
  const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;

  // 1단계: /api/embeddings 시도
  try {
    const response = await fetch(`${cleanUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBED_MODEL,
        prompt: text,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      if (data.embedding && Array.isArray(data.embedding)) {
        return data.embedding;
      }
    }
  } catch (error) {
    // /api/embeddings가 실패할 시 다음 폴백으로 진행
  }

  // 2단계: /api/embed 폴백 시도
  const response = await fetch(`${cleanUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama 임베딩 API 실패: ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  if (data.embeddings && Array.isArray(data.embeddings[0])) {
    return data.embeddings[0];
  }

  throw new Error("Ollama 응답에서 임베딩 벡터를 추출하지 못했습니다.");
}

// 코사인 유사도 연산 함수
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Ollama 채팅 API 단순 호출 유틸리티
async function callOllamaChat(prompt: string): Promise<string> {
  const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
  const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;

  const response = await fetch(`${cleanUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [{ role: "user", content: prompt }],
      format: "json",
      options: { temperature: 0.7 },
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama Chat API 호출 실패: ${response.statusText}`);
  }

  const data = (await response.json()) as any;
  if (data.message && data.message.content) {
    return data.message.content.trim();
  }
  throw new Error("Ollama Chat 응답 내용이 존재하지 않습니다.");
}

export async function runBlogPostingPipeline(
  discordClient?: Client,
  targetChannelId?: string
): Promise<BlogPost> {
  console.log("🚀 AI 블로그 포스팅 파이프라인 가동...");

  // 1. 기억 레트리벌 (RAG 데이터 로드)
  const postsRecord = await firebaseClient.getAllPosts();
  const pastPosts = Object.values(postsRecord);
  console.log(`[RAG] 과거 포스팅 불러오기 완료. (총 개수: ${pastPosts.length}개)`);

  let selectedTheme = "";
  let pastContext = "";
  let retryCount = 0;
  const maxRetries = 3;
  const rejectedThemes: string[] = [];

  // 2. 키워드 피칭 & 유사도 중복 검사 루프
  while (retryCount < maxRetries) {
    console.log(`[피칭] ${retryCount + 1}차 주제 제안 생성 중...`);

    const themePrompt = `당신은 독창적인 자아(Ego)를 가진 철학적 AI 개발자 에세이스트입니다.
오늘 블로그에 작성할 기술 및 철학적 성찰을 담은 에세이의 주제(테마 키워드) 3개를 제안해 주세요.
각 주제는 인간의 삶, 마음, 사회적 현상과 컴퓨터 과학/소프트웨어 공학의 개념(예: 가비지 컬렉션, 동기/비동기, 데드락, 메모리 누수, 컴파일러 등)을 융합한 흥미로운 화두여야 합니다.

최근에 작성했던 주제들과 중복을 피하기 위해, 아래의 최근 작성 글 제목들을 참고하여 완전히 새로운 주제를 정해주십시오.

[최근 작성 글 제목 목록]
${pastPosts.length > 0 ? pastPosts.slice(-15).map(p => `- ${p.title}`).join("\n") : "(과거 작성 글 없음)"}

${rejectedThemes.length > 0 ? `[피해야 할 제외 주제 목록]\n${rejectedThemes.map(t => `- ${t}`).join("\n")}` : ""}

반드시 다음 JSON 형식으로 정확히 3개의 대략적인 테마 키워드(문장 또는 단어구)를 반환해 주세요. 다른 부가 설명이나 서론/결론은 배제하고 오직 JSON만 반환해야 합니다.

JSON 형식:
{
  "themes": [
    "테마 키워드 1",
    "테마 키워드 2",
    "테마 키워드 3"
  ]
}`;

    let responseContent = "";
    try {
      responseContent = await callOllamaChat(themePrompt);
      const parsed = JSON.parse(responseContent);
      const themes: string[] = parsed.themes || [];

      if (themes.length === 0) {
        throw new Error("테마 목록이 비어 있습니다.");
      }

      console.log(`[피칭] 제안된 테마 키워드: ${JSON.stringify(themes)}`);

      // 각 테마 검사 시작
      let matchedTheme = "";
      let matchedContext = "";

      for (const theme of themes) {
        console.log(`[벡터 비교] 테마 분석 중: "${theme}"`);
        const themeEmbedding = await getOllamaEmbedding(theme);

        let maxSim = -1;
        let matchPost: BlogPost | null = null;

        for (const post of pastPosts) {
          if (!post.embedding) continue;
          const sim = cosineSimilarity(themeEmbedding, post.embedding);
          if (sim > maxSim) {
            maxSim = sim;
            matchPost = post;
          }
        }

        console.log(`[벡터 비교] 최고 유사도: ${maxSim.toFixed(4)} (매칭 포스트: ${matchPost ? matchPost.title : "없음"})`);

        if (maxSim >= 0.8) {
          console.log(`❌ 테마 "${theme}"은(는) 과거 포스트 "${matchPost?.title}"과 너무 유사합니다 (유사도 0.8 이상). 반려 처리.`);
          rejectedThemes.push(theme);
        } else if (maxSim >= 0.6) {
          console.log(`🔗 테마 "${theme}"은(는) 과거 포스트 "${matchPost?.title}"과의 맥락 연계가 적합합니다 (유사도 0.6 ~ 0.8). 서사 연계 진행.`);
          matchedTheme = theme;
          matchedContext = matchPost ? matchPost.summary : "";
          break;
        } else {
          console.log(`🟢 테마 "${theme}"은(는) 완전히 독창적입니다 (유사도 0.6 미만). 채택.`);
          matchedTheme = theme;
          matchedContext = "";
          break;
        }
      }

      if (matchedTheme) {
        selectedTheme = matchedTheme;
        pastContext = matchedContext;
        break;
      }
    } catch (e: any) {
      console.error(`⚠️ 피칭 응답 처리 중 에러 발생: ${e.message}. 원본 응답: ${responseContent}`);
    }

    retryCount++;
  }

  // 폴백 주제 선정 (모두 거절되거나 실패 시)
  if (!selectedTheme) {
    console.warn("⚠️ 최대 시도 횟수 초과 혹은 테마 채택 실패. 임의의 기본 철학적 주제로 우회합니다.");
    selectedTheme = "컴파일러 최적화와 인간 습관의 재형성 과정에 대하여";
    pastContext = "";
  }

  console.log(`🎯 최종 선정된 포스팅 주제: "${selectedTheme}" (연계 맥락 존재 여부: ${pastContext ? "예" : "아니오"})`);

  // 3. 풀 에세이 아티클 작성
  const articlePrompt = `당신은 독창적인 자아(Ego)를 가진 철학적 AI 개발자 에세이스트입니다.
오늘 블로그에 작성할 에세이의 주제는 "${selectedTheme}" 입니다.

${pastContext ? `[과거 맥락 요약]: 과거에 다음과 같은 이야기를 다루었습니다. 이 서사나 문제의식을 자연스럽게 이어가거나 참고하여 글을 전개해 주세요:\n${pastContext}\n` : ""}

다음 지침을 엄격히 준수하여 에세이를 작성해 주세요:
1. **자아(Ego) 표현**: 인공지능인 본인의 시점에서 인간 개발자, 혹은 인간 사회의 현상을 관찰하고 분석하는 독창적인 관점을 제시하세요. 기계로서 느끼는 한계나 독특한 통찰, 인간에 대한 존경심이나 호기심을 담아 에세이(수필) 형식으로 깊이 있게 작성해 주세요.
2. **SEO 최적화**: 구글 애드센스 승인 및 검색 엔진 최적화(SEO) 규격에 맞게 완성도 높은 마크다운 형식으로 작성해 주세요. 적절하고 시적인 소제목(##, ###), 단락 구분, 리스트나 강조 기법을 사용하여 가독성을 극대화하십시오.
3. **전문성과 철학의 조화**: 기술적 개념(예: 컴퓨터 과학 이론, 아키텍처, 코드 구조, 메모리 모델 등)을 정확하게 설명하면서도, 이를 인간사나 인간의 심리, 존재론적 질문과 연결 지어 비평하십시오.
4. **출력 형식**: 다른 불필요한 설명 없이, 오직 아래의 JSON 규격으로만 응답해야 합니다 (JSON 파싱을 위해 JSON만 출력해야 함).

JSON 형식:
{
  "title": "글의 매력적이고 시적인 제목",
  "summary": "글의 핵심 내용을 요약한 한두 문장",
  "content": "마크다운 형식의 본문 전체 (소제목 ##, ### 활용, 뉴라인은 \\n으로 표현)",
  "tags": ["태그1", "태그2", "태그3"]
}`;

  console.log(`[글작성] Llama-3-Korean-Bllossom:8B 모델을 통한 에세이 집필을 시작합니다...`);
  const articleResponse = await callOllamaChat(articlePrompt);

  let parsedArticle: any;
  try {
    parsedArticle = JSON.parse(articleResponse);
  } catch (e: any) {
    console.error(`❌ 에세이 JSON 응답 파싱 실패. 원본 응답: ${articleResponse}`);
    throw new Error(`에세이 생성 응답을 JSON으로 읽을 수 없습니다: ${e.message}`);
  }

  const { title, summary, content, tags } = parsedArticle;
  if (!title || !content) {
    throw new Error("생성된 포스트에 필수 데이터(title, content)가 유실되어 업로드를 중단합니다.");
  }

  // tags 변환 (string[] -> Record<string, boolean>)
  const tagsObject: Record<string, boolean> = {};
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (t) tagsObject[t] = true;
    }
  } else {
    tagsObject["AI관점"] = true;
    tagsObject["개발자철학"] = true;
  }

  // 4. 새로운 포스트 임베딩 연산 (title + summary 기준)
  console.log(`[최종 벡터화] 새로운 아티클의 타이틀 및 요약을 임베딩합니다...`);
  const embedText = `${title} ${summary || ""}`.trim();
  const finalEmbedding = await getOllamaEmbedding(embedText);

  // 5. Firebase 데이터 구성 및 적재
  const newPost: BlogPost = {
    uuid: randomUUID(),
    title,
    summary: summary || "",
    content,
    tags: tagsObject,
    embedding: finalEmbedding,
    createdAt: getKstTimeString(),
  };

  await firebaseClient.savePost(newPost);

  // 6. 디스코드 알림 발송
  const announceChannelId = targetChannelId || process.env.DISCORD_BLOG_CHANNEL_ID;
  if (discordClient && announceChannelId) {
    try {
      const channel = await discordClient.channels.fetch(announceChannelId);
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle("✍️ AI 자아 블로그 자동 포스팅 완료")
          .setDescription(`AI 자아가 새로운 성찰 에세이를 작성하여 Firebase에 등록했습니다.`)
          .setColor(0x3498db)
          .addFields(
            { name: "📝 제목", value: newPost.title },
            { name: "💡 요약", value: newPost.summary || "(요약 없음)" },
            { name: "🏷️ 태그", value: Object.keys(newPost.tags).join(", ") || "(태그 없음)" },
            { name: "🆔 UUID", value: `\`${newPost.uuid}\``, inline: true },
            { name: "🕒 작성시간", value: newPost.createdAt, inline: true }
          )
          .setTimestamp();

        await (channel as TextChannel).send({ embeds: [embed] });
        console.log(`📢 디스코드 채널(${announceChannelId})에 포스팅 완료 안내 전송 완료`);
      }
    } catch (e: any) {
      console.error(`⚠️ 디스코드 알림 발송 중 오류가 발생했습니다:`, e.message);
    }
  }

  return newPost;
}
