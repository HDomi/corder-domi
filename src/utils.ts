import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

// 미니 PC 인프라 내에서 대상 타겟 코드가 동기화되어 움직일 워크스페이스 정의
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR
  ? path.resolve(process.env.WORKSPACE_DIR)
  : path.resolve(process.env.HOME || "", "coder-domi-storage/workspace");

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// 워크스페이스 내부의 텍스트 기반 소스 파일들을 재귀적으로 수집하여 컨텍스트화
export const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".output",
  ".nuxt",
  ".next",
  ".svelte-kit",
  ".cache",
  "cache",
  ".DS_Store",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "chatops.db",
]);

export function getWorkspaceContext(projectPath: string): {
  files: { path: string; content: string }[];
} {
  const result: { files: { path: string; content: string }[] } = { files: [] };
  let fileCount = 0;

  function traverse(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const list = fs.readdirSync(currentDir);
    for (const item of list) {
      if (IGNORED_NAMES.has(item)) continue;

      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        traverse(fullPath);
      } else if (stat.isFile()) {
        // 보안/VRAM 초과 방지: 200KB를 넘는 대형 파일 또는 파일 한계(150개)를 넘어가면 건너뜀
        if (stat.size > 204800 || fileCount >= 150) continue;

        const relativePath = path.relative(projectPath, fullPath);
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          result.files.push({ path: relativePath, content });
          fileCount++;
        } catch (e) {
          // 바이너리 파일이나 읽을 수 없는 파일은 무시
        }
      }
    }
  }

  traverse(projectPath);
  return result;
}

export function getPuppeteerExecutablePath(): string {
  // Puppeteer 실행 경로 탐색 (로컬 macOS 기본 Chrome / Docker 환경변수 지원)
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    const paths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        executablePath = p;
        break;
      }
    }
  }

  if (!executablePath) {
    throw new Error(
      "Chromium 브라우저 실행 경로를 찾을 수 없습니다. 환경변수 PUPPETEER_EXECUTABLE_PATH를 설정해 주세요.",
    );
  }

  return executablePath;
}

export function executeShellCommand(
  cmd: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = exec(cmd, { cwd, shell: "/bin/bash", signal }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });

    if (child.stdout) {
      child.stdout.on("data", (data) =>
        console.log(`[쉘-표준출력] ${data.toString().trim()}`),
      );
    }
    if (child.stderr) {
      child.stderr.on("data", (data) =>
        console.error(`[쉘-표준에러] ${data.toString().trim()}`),
      );
    }
  });
}
