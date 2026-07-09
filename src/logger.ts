import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const LOG_DIR = path.resolve(__dirname, "../logs");
const LOG_FILE = path.join(LOG_DIR, "bot.log");

// 로그 디렉토리 생성
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 오리지널 콘솔 함수 백업
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

function getTimestamp(): string {
  return new Date().toISOString();
}

function writeToFile(level: string, message: string) {
  try {
    const logMessage = `[${getTimestamp()}] [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, logMessage, "utf-8");
  } catch (e) {
    originalError("로그 파일에 기록하는 데 실패했습니다:", e);
  }
}

function formatArgs(args: any[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");
}

export function initLogger() {
  console.log = (...args: any[]) => {
    const message = formatArgs(args);
    originalLog(...args);
    writeToFile("INFO", message);
  };

  console.error = (...args: any[]) => {
    const message = formatArgs(args);
    originalError(...args);
    writeToFile("ERROR", message);
  };

  console.warn = (...args: any[]) => {
    const message = formatArgs(args);
    originalWarn(...args);
    writeToFile("WARN", message);
  };

  console.info = (...args: any[]) => {
    const message = formatArgs(args);
    originalInfo(...args);
    writeToFile("INFO", message);
  };
}

export function getRecentLogs(lineCount: number = 100): string {
  if (!fs.existsSync(LOG_FILE)) {
    return "로그 파일이 존재하지 않습니다.";
  }

  const content = fs.readFileSync(LOG_FILE, "utf-8");
  const lines = content.split("\n");

  if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  const recentLines = lines.slice(-lineCount);
  return recentLines.join("\n");
}

export function getOllamaLogs(lineCount: number = 100): string {
  // 1단계: 환경변수 OLLAMA_LOG_PATH 확인
  const envPath = process.env.OLLAMA_LOG_PATH;
  if (envPath && fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, "utf-8");
      return getTailLines(content, lineCount);
    } catch (e: any) {
      console.error(`OLLAMA_LOG_PATH (${envPath}) 로그를 읽는데 실패했습니다:`, e.message);
    }
  }

  // 2단계: macOS 기본 경로 확인
  const macDefaultPath = path.join(
    process.env.HOME || "",
    ".ollama/logs/server.log",
  );
  if (fs.existsSync(macDefaultPath)) {
    try {
      const content = fs.readFileSync(macDefaultPath, "utf-8");
      return getTailLines(content, lineCount);
    } catch (e: any) {
      console.error(`macOS 기본 Ollama 로그를 읽는데 실패했습니다:`, e.message);
    }
  }

  // 3단계: 리눅스 systemd journalctl 실행 시도
  try {
    const output = execSync(`journalctl -u ollama -n ${lineCount} --no-pager`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    if (output && output.trim()) {
      return output.trim();
    }
  } catch (e: any) {
    // journalctl 명령이 없거나 실패한 경우 무시하고 다음 단계로 진행
  }

  // 4단계: Docker 컨테이너 로그 실행 시도 (ollama 컨테이너명 가정)
  try {
    const output = execSync(`docker logs ollama --tail ${lineCount}`, {
      encoding: "utf-8",
      stdio: "pipe",
    });
    if (output && output.trim()) {
      return output.trim();
    }
  } catch (e: any) {
    // 실패 시 무시
  }

  return `❌ Ollama 로그를 조회할 수 없습니다. 
- 환경변수 \`OLLAMA_LOG_PATH\`를 올바른 로그 파일 경로로 설정해 주세요.
- (예: /var/log/ollama.log 또는 ~/.ollama/logs/server.log)`;
}

function getTailLines(content: string, lineCount: number): string {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines.slice(-lineCount).join("\n");
}
