export interface FileChange {
  path: string;
  content: string;
}

export async function generateCodeUpdate(
  spec: string,
  workspaceContext: { files: { path: string; content: string }[] },
  userRequest: string
): Promise<FileChange[]> {
  const aiApiUrl = process.env.AI_API_URL || 'http://localhost:11434';
  const cleanUrl = aiApiUrl.endsWith('/') ? aiApiUrl.slice(0, -1) : aiApiUrl;

  const systemPrompt = `너는 세계 최고의 시니어 프론트엔드 엔지니어이자 대화형 ChatOps 에이전트다.
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
4. 기존 Vue/React 프레임워크 규격, TypeScript 구조, 아키텍처 규칙을 훼손하지 마라.`;

  const userPrompt = `
[기획 명세서 (전체 누적 요건)]
${spec}

[현재 워크스페이스 파일들 및 소스 코드]
${JSON.stringify(workspaceContext, null, 2)}

[사용자 코딩 요청]
${userRequest}

위 기획서와 워크스페이스 상태를 분석하고, 사용자의 코딩 요청을 완벽하게 반영한 파일 변경사항(JSON)을 생성해라.
`;

  const response = await fetch(`${cleanUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen2.5-coder:14b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      format: 'json', // JSON 출력 강제
      options: {
        temperature: 0.1 // 코딩의 결정론적 정밀성을 위해 온도를 극도로 낮춤
      },
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama API 호출 실패: ${response.statusText} (${errorText})`);
  }

  const json = await response.json() as any;
  if (json.message && json.message.content) {
    try {
      const parsed = JSON.parse(json.message.content.trim());
      if (parsed && Array.isArray(parsed.changes)) {
        return parsed.changes as FileChange[];
      }
      throw new Error("JSON 응답 내 'changes' 배열을 찾을 수 없습니다.");
    } catch (e: any) {
      throw new Error(`Ollama 응답 파싱 에러: ${e.message}\n원본 내용: ${json.message.content}`);
    }
  } else {
    throw new Error('Ollama로부터 빈 응답을 받았습니다.');
  }
}
