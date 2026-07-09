import { CodeUpdateResult, Phase1Result, Phase2Result } from "./types";
import { selectRelevantFilesOllama, generateCodeUpdateOllama } from "./ollama";
import { getWorkspaceContext, executeShellCommand } from "../utils";

export * from "./types";

export async function generateCodeUpdate(
  spec: string,
  projectPath: string,
  userRequest: string,
  abortSignal?: AbortSignal,
): Promise<CodeUpdateResult> {
  // 1단계: 초기 파일 목록 획득 및 분석 시작
  let workspaceContext = getWorkspaceContext(projectPath);
  let allPaths = workspaceContext.files.map((f) => f.path);
  let phase1Result: Phase1Result = { relevantFiles: [] };

  console.log(
    `[컨텍스트 최적화] 1단계: 의존성 파일 선별 및 초기화 분석을 시작합니다... (전체 파일 수: ${workspaceContext.files.length}개 / 모드: Ollama)`,
  );

  try {
    const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
    const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;
    phase1Result = await selectRelevantFilesOllama(
      cleanUrl,
      spec,
      allPaths,
      userRequest,
      abortSignal,
    );
  } catch (error) {
    console.warn("⚠️ 1단계 파일 선별 도중 에러가 발생했습니다:", error);
    phase1Result = { relevantFiles: allPaths };
  }

  // 1.5단계: 1단계에서 반환된 setupCommands 즉시 실행
  const runSetupCommands: string[] = [];
  if (phase1Result.setupCommands && phase1Result.setupCommands.length > 0) {
    const filteredSetup = phase1Result.setupCommands.filter(cmd => {
      const forbidden = ["npm start", "npm run dev", "npm run start", "yarn start", "yarn dev", "pnpm start", "pnpm dev", "next dev", "next start"];
      const isForbidden = forbidden.some(term => cmd.includes(term)) || (/\bvite\b/.test(cmd) && !/create-vite/.test(cmd));
      if (isForbidden) {
        console.warn(`⚠️ [검열 비상] 모델이 금지된 지속성 서버 명령어를 뱉어 실행을 차단했습니다: ${cmd}`);
        return false;
      }
      return true;
    });

    if (filteredSetup.length > 0) {
      console.log(`[1단계 사전 설정] 실행할 초기화 명령어 발견: ${filteredSetup.length}개`);
      const chainedCmd = filteredSetup.join(" && ");
      try {
        console.log(`[1단계 사전 설정] 결합된 초기화 명령어 실행 중: ${chainedCmd}`);
        await executeShellCommand(chainedCmd, projectPath, abortSignal);
        for (const cmd of filteredSetup) {
          runSetupCommands.push(cmd);
        }
      } catch (err: any) {
        console.error(`❌ [1단계 사전 설정 오류] 명령어 실행 실패: ${chainedCmd}`, err.message);
        if (abortSignal?.aborted) {
          throw new Error("작업이 사용자에 의해 중단되었습니다.");
        }
      }
    }
    // 명령어 실행 후 파일 구조 변경 가능성이 있으므로 워크스페이스 컨텍스트 재로드
    workspaceContext = getWorkspaceContext(projectPath);
    allPaths = workspaceContext.files.map((f) => f.path);
  }

  const selectedPaths = phase1Result.relevantFiles;

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
    `[컨텍스트 최적화] 2단계: 핵심 소스 코드 추출을 완료하여 모델에 전달합니다... (선별 파일 수: ${prunedFiles.length}개 / 전체 파일 수: ${allPaths.length}개 / 모드: Ollama)`,
  );
  console.log(
    `[컨텍스트 최적화] 모델 전송용 선별 파일 목록:\n${prunedFiles
      .map((f) => ` - ${f.path}`)
      .join("\n")}`,
  );

  let phase2Result: Phase2Result = { execute: [] };

  const aiApiUrl = process.env.AI_API_URL || "http://localhost:11434";
  const cleanUrl = aiApiUrl.endsWith("/") ? aiApiUrl.slice(0, -1) : aiApiUrl;
  phase2Result = await generateCodeUpdateOllama(cleanUrl, spec, prunedFiles, userRequest, abortSignal);

  return {
    setupCommands: runSetupCommands,
    relevantFiles: selectedPaths,
    execute: phase2Result.execute,
    desc: phase2Result.desc,
  };
}
