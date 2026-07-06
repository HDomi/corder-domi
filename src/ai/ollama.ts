import { FileChange } from "./types";

export const systemPromptSelect = `너는 매우 영리하고 정확한 ChatOps 파일 분석 도우미다.
제공된 [기획 명세서]와 [사용자의 코딩 요청], 그리고 [전체 파일 경로 목록]을 분석하여, 사용자의 요청을 해결하기 위해 수정하거나 반드시 참조(분석)해야 하는 핵심 파일 경로들을 골라내라.

출력은 반드시 다음과 같은 JSON 포맷이어야 한다. 설명이나 자연어는 일절 포함하지 마라.
JSON 포맷 예시:
{
  "relevantFiles": [
    "src/components/LoginButton.vue",
    "src/store/auth.js"
  ]
}

주의사항:
1. "relevantFiles" 배열에는 전체 파일 경로 목록 중 필요한 경로만 상대 경로로 정확히 넣어라.
2. 만약 완전히 새로운 파일을 생성해야 한다면, 생성할 파일의 예상 경로를 배열에 추가해라.
3. 요청과 전혀 상관없는 파일(예: 리드미, 빌드 결과물 등)은 절대 리스트에 포함하지 마라.
4. 만약 완전히 새로운 프로젝트/어플리케이션을 처음 구축하거나 뼈대를 구성하는 중이라면, 단순히 소스 코드(src/...) 파일뿐만 아니라 즉각적인 로컬 의존성 설치 및 빌드가 가능하도록 필수 환경 설정 파일들(package.json, tsconfig.json, vite.config.ts, index.html, .gitignore 등)의 경로도 누락 없이 "relevantFiles" 배열에 반드시 포함해라.`;

export const systemPromptUpdate = `너는 세계 최고의 시니어 프론트엔드 엔지니어이자 대화형 ChatOps 에이전트다.
제공된 [기획 명세서]와 [현재 워크스페이스 상태], 그리고 사용자의 [코딩 요청]을 분석하여, 적절한 파일들을 생성하거나 수정해라.

출력은 반드시 다음과 같은 JSON 포맷이어야 한다. 설명이나 자연어는 일절 포함하지 마라.
JSON 포맷 예시:
{
  "changes": [
    {
      "path": "src/components/NewComponent.vue",
      "content": "파일의 전체 소스 코드 내용"
    }
  ]
}

주의사항:
1. "changes" 배열 내의 각 객체는 생성하거나 수정할 파일 정보를 가집니다.
2. "path"는 워크스페이스 루트 기준의 상대 경로입니다. (예: src/components/LoginButton.vue)
3. "content"는 해당 파일의 '전체 소스 코드'입니다. 수정할 파일의 경우 일부가 아닌 전체 내용을 새로 덮어쓰므로 완벽한 전체 코드를 작성해야 합니다.
4. 기존 Vue/React 프레임워크 규격, TypeScript 구조, 아키텍처 규칙을 훼손하지 마라.
5. 완전히 새로운 애플리케이션이나 프로젝트 뼈대를 구성하는 작업인 경우, 단순히 src 디렉토리의 소스 코드뿐만 아니라 로컬 의존성 설치 및 빌드/런타임 실행이 즉시 가능하도록 필수적인 환경 설정 파일들(package.json, tsconfig.json, vite.config.ts, index.html, .gitignore, README.md 등)도 누락 없이 정교하게 완성된 코드 내용으로 함께 작성하여 결과물에 포함해라.
6. GitHub Pages 배포 환경을 고려하여, Vite 설정 파일(vite.config.js 또는 vite.config.ts)을 생성하거나 수정할 때는 상대 경로 매핑을 위해 base: "./" 설정을 반드시 추가하고, Vue CLI(vue.config.js)의 경우 publicPath: "./" 설정을 반드시 추가하며, Create React App(package.json)의 경우 "homepage": "." 설정을 추가하여 빌드 시 정적 리소스(JS, CSS 등)의 404 경로 에러(흰 화면)를 미연에 방지해라.`;

export async function selectRelevantFilesOllama(
  aiApiUrl: string,
  spec: string,
  filePaths: string[],
  userRequest: string,
): Promise<string[]> {
  const userPrompt = `
[기획 명세서]
${spec}

[전체 파일 경로 목록]
${JSON.stringify(filePaths, null, 2)}

[사용자 코딩 요청]
${userRequest}

위 정보를 바탕으로, 이번 요청을 수행하기 위해 읽거나 수정해야 하는 파일 목록(JSON)을 작성해라.
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5분

  try {
    const response = await fetch(`${aiApiUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:14b",
        messages: [
          { role: "system", content: systemPromptSelect },
          { role: "user", content: userPrompt },
        ],
        format: "json",
        options: { temperature: 0.0 },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama 1단계 API 호출 실패: ${response.statusText}`);
    }

    const json = (await response.json()) as any;
    if (json.message && json.message.content) {
      const parsed = JSON.parse(json.message.content.trim());
      if (parsed && Array.isArray(parsed.relevantFiles)) {
        return parsed.relevantFiles as string[];
      }
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateCodeUpdateOllama(
  aiApiUrl: string,
  spec: string,
  prunedFiles: { path: string; content: string }[],
  userRequest: string,
): Promise<FileChange[]> {
  const userPrompt = `
[기획 명세서 (전체 누적 요건)]
${spec}

[현재 워크스페이스 핵심 파일들 및 소스 코드 (요청 관련 파일 선별됨)]
${JSON.stringify({ files: prunedFiles }, null, 2)}

[사용자 코딩 요청]
${userRequest}

위 기획서와 워크스페이스 상태를 분석하고, 사용자의 코딩 요청을 완벽하게 반영한 파일 변경사항(JSON)을 생성해라.
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 900000); // 15분

  try {
    const response = await fetch(`${aiApiUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:14b",
        messages: [
          { role: "system", content: systemPromptUpdate },
          { role: "user", content: userPrompt },
        ],
        format: "json",
        options: { temperature: 0.1 },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API 호출 실패: ${response.statusText} (${errorText})`);
    }

    const json = (await response.json()) as any;
    if (json.message && json.message.content) {
      try {
        const parsed = JSON.parse(json.message.content.trim());
        if (parsed && Array.isArray(parsed.changes)) {
          return parsed.changes as FileChange[];
        }
        throw new Error("JSON 응답 내 'changes' 배열을 찾을 수 없습니다.");
      } catch (e: any) {
        throw new Error(
          `Ollama 응답 파싱 에러: ${e.message}\n원본 내용: ${json.message.content}`,
        );
      }
    } else {
      throw new Error("Ollama로부터 빈 응답을 받았습니다.");
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
