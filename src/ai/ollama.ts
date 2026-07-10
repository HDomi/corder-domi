import { Phase1Result, Phase2Result } from "./types";
import { Agent } from "undici";
import { AI_CONFIG } from "../config";

export async function selectRelevantFilesOllama(
  aiApiUrl: string,
  spec: string,
  filePaths: string[],
  userRequest: string,
  abortSignal?: AbortSignal,
): Promise<Phase1Result> {
  const userPrompt = `
[기획 명세서]
${spec}

[전체 파일 경로 목록]
${JSON.stringify(filePaths, null, 2)}

[사용자 코딩 요청]
${userRequest}
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5분

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      abortSignal.addEventListener("abort", onAbort);
      controller.signal.addEventListener("abort", () => {
        abortSignal.removeEventListener("abort", onAbort);
      });
    }
  }

  try {
    const response = await fetch(`${aiApiUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_CONFIG.CODER_SELECT_MODEL,
        messages: [{ role: "user", content: userPrompt }],
        format: "json",
        options: { temperature: 0.0 },
        stream: true, // 중단 감지를 위해 스트리밍 사용
      }),
      signal: controller.signal,
      // @ts-ignore
      dispatcher: new Agent({
        headersTimeout: 300000,
        bodyTimeout: 300000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama 1단계 API 호출 실패: ${response.statusText}`);
    }

    let accumulatedContent = "";
    let buffer = "";
    const decoder = new TextDecoder();

    // @ts-ignore
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsedChunk = JSON.parse(line);
          if (parsedChunk.message && parsedChunk.message.content) {
            accumulatedContent += parsedChunk.message.content;
          }
        } catch (err) {
          // Ignore
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsedChunk = JSON.parse(buffer);
        if (parsedChunk.message && parsedChunk.message.content) {
          accumulatedContent += parsedChunk.message.content;
        }
      } catch (err) {
        // Ignore
      }
    }

    if (accumulatedContent) {
      const parsed = JSON.parse(accumulatedContent.trim());
      if (parsed) {
        return {
          setupCommands: Array.isArray(parsed.setupCommands)
            ? parsed.setupCommands
            : [],
          relevantFiles: Array.isArray(parsed.relevantFiles)
            ? parsed.relevantFiles
            : [],
        };
      }
    }
    return { relevantFiles: [] };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateCodeUpdateOllama(
  aiApiUrl: string,
  spec: string,
  prunedFiles: { path: string; content: string }[],
  userRequest: string,
  abortSignal?: AbortSignal,
): Promise<Phase2Result> {
  const userPrompt = `
[기획 명세서 (전체 누적 요건)]
${spec}

[현재 워크스페이스 핵심 파일들 및 소스 코드 (요청 관련 파일 선별됨)]
${JSON.stringify({ files: prunedFiles }, null, 2)}

[사용자 코딩 요청]
${userRequest}
`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30분

  if (abortSignal) {
    if (abortSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      abortSignal.addEventListener("abort", onAbort);
      controller.signal.addEventListener("abort", () => {
        abortSignal.removeEventListener("abort", onAbort);
      });
    }
  }

  try {
    const response = await fetch(`${aiApiUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_CONFIG.CODER_UPDATE_MODEL,
        messages: [{ role: "user", content: userPrompt }],
        format: "json",
        options: { temperature: 0.1 },
        stream: true, // 중단 감지를 위해 스트리밍 사용
      }),
      signal: controller.signal,
      // @ts-ignore
      dispatcher: new Agent({
        headersTimeout: 1800000,
        bodyTimeout: 1800000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama API 호출 실패: ${response.statusText} (${errorText})`,
      );
    }

    let accumulatedContent = "";
    let buffer = "";
    const decoder = new TextDecoder();

    // @ts-ignore
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsedChunk = JSON.parse(line);
          if (parsedChunk.message && parsedChunk.message.content) {
            accumulatedContent += parsedChunk.message.content;
          }
        } catch (err) {
          // Ignore
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsedChunk = JSON.parse(buffer);
        if (parsedChunk.message && parsedChunk.message.content) {
          accumulatedContent += parsedChunk.message.content;
        }
      } catch (err) {
        // Ignore
      }
    }

    if (accumulatedContent) {
      try {
        const parsed = JSON.parse(accumulatedContent.trim());
        if (parsed && Array.isArray(parsed.execute)) {
          return {
            execute: parsed.execute,
            desc: parsed.desc,
          };
        }
        throw new Error("JSON 응답 내 'execute' 배열을 찾을 수 없습니다.");
      } catch (e: any) {
        console.error("❌ Ollama 파싱 실패 원본 내용:", accumulatedContent);
        throw new Error(`Ollama 응답 파싱 에러: ${e.message}`);
      }
    } else {
      throw new Error("Ollama로부터 빈 응답을 받았습니다.");
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
