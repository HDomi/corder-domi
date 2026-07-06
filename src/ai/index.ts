import { FileChange } from "./types";
import { selectRelevantFilesOllama, generateCodeUpdateOllama } from "./ollama";
import { selectRelevantFilesGemini, generateCodeUpdateGemini } from "./gemini";

export * from "./types";

export async function generateCodeUpdate(
  spec: string,
  workspaceContext: { files: { path: string; content: string }[] },
  userRequest: string,
  localModelOverride?: boolean,
): Promise<FileChange[]> {
  const isLocalMode = localModelOverride !== undefined ? localModelOverride : (process.env.LOCAL_MODE === "true");
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const useLocal = isLocalMode || !geminiApiKey;
  if (localModelOverride === undefined && !isLocalMode && !geminiApiKey) {
    console.warn(
      "⚠️ GEMINI_API_KEY가 설정되어 있지 않아 로컬 모델(Ollama) 모드로 자동 전환합니다.",
    );
  }

  const allPaths = workspaceContext.files.map((f) => f.path);
  let selectedPaths: string[] = [];

  console.log(
    `[Prompt Diet] 1단계: 의존 파일 선별 분석 시작... (전체 파일 수: ${
      workspaceContext.files.length
    }개 / 모드: ${useLocal ? "Ollama" : "Gemini"})`,
  );

  try {
    if (useLocal) {
      const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
      const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;
      selectedPaths = await selectRelevantFilesOllama(
        cleanUrl,
        spec,
        allPaths,
        userRequest,
      );
    } else {
      selectedPaths = await selectRelevantFilesGemini(
        geminiApiKey!,
        spec,
        allPaths,
        userRequest,
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ 1단계 파일 선별 도중 에러가 발생하여 전체 파일을 보냅니다:",
      error,
    );
    selectedPaths = allPaths;
  }

  // 선별된 파일들을 기반으로 새로운 정제 컨텍스트 구성
  const selectedPathsSet = new Set(selectedPaths);
  const prunedFiles = workspaceContext.files.filter((f) =>
    selectedPathsSet.has(f.path),
  );

  // 만약 새로 생성해야 하는 파일이 있다면, 해당 경로 정보를 빈 본문과 함께 컨텍스트에 표시해준다.
  for (const p of selectedPaths) {
    if (!allPaths.includes(p)) {
      prunedFiles.push({
        path: p,
        content: "(새로 생성할 파일 - 현재 비어있음)",
      });
    }
  }

  console.log(
    `[Prompt Diet] 2단계: 핵심 소스 코드 전송 시작... (다이어트 후 파일 수: ${
      prunedFiles.length
    }개 / ${allPaths.length}개 / 모드: ${useLocal ? "Ollama" : "Gemini"})`,
  );
  console.log(
    `[Prompt Diet] 전송할 파일 목록:\n${prunedFiles
      .map((f) => ` - ${f.path}`)
      .join("\n")}`,
  );

  if (useLocal) {
    const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
    const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;
    return generateCodeUpdateOllama(cleanUrl, spec, prunedFiles, userRequest);
  } else {
    return generateCodeUpdateGemini(
      geminiApiKey!,
      spec,
      prunedFiles,
      userRequest,
    );
  }
}
