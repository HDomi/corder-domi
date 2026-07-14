import { initializeApp, cert } from "firebase-admin/app";
import { getDatabase, Database } from "firebase-admin/database";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

export interface BlogPost {
  uuid: string;
  title: string;
  summary: string;
  content: string;
  tags: Record<string, boolean>;
  embedding: number[];
  createdAt: string;
}

const dbUrl = process.env.FIREBASE_DATABASE_URL;

if (!dbUrl) {
  throw new Error("❌ 환경변수 FIREBASE_DATABASE_URL이 설정되지 않았습니다.");
}

// 서비스 계정 키 파일 로드
let serviceAccount: any = null;

const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
const defaultPath = path.resolve(__dirname, "../firebase-key.json");

if (envJson) {
  try {
    serviceAccount = JSON.parse(envJson);
  } catch (e: any) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT_JSON 파싱 실패:", e.message);
  }
} else if (envPath && fs.existsSync(envPath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(envPath, "utf-8"));
  } catch (e: any) {
    console.error(`❌ FIREBASE_SERVICE_ACCOUNT_PATH (${envPath}) 읽기 실패:`, e.message);
  }
} else if (fs.existsSync(defaultPath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
  } catch (e: any) {
    console.error("❌ 프로젝트 루트의 firebase-key.json 읽기 실패:", e.message);
  }
}

if (!serviceAccount) {
  throw new Error(
    "❌ Firebase 서비스 계정 키를 찾을 수 없습니다. 다음 방법 중 하나를 선택해 주세요:\n" +
      "1. 다운로드 받은 JSON 키 파일을 프로젝트 루트 디렉토리에 'firebase-key.json' 이라는 이름으로 저장\n" +
      "2. 환경변수 'FIREBASE_SERVICE_ACCOUNT_PATH'에 키 파일 절대 경로 지정\n" +
      "3. 환경변수 'FIREBASE_SERVICE_ACCOUNT_JSON'에 키 JSON 문자열 지정",
  );
}

// Firebase Admin SDK 초기화 (모듈러 방식)
const app = initializeApp({
  credential: cert(serviceAccount),
  databaseURL: dbUrl,
});

const db: Database = getDatabase(app);

export const firebaseClient = {
  /**
   * 스케줄러가 활성화 상태인지 확인합니다.
   * 경로: config/isSchedulerActive
   */
  async getSchedulerActiveStatus(): Promise<boolean> {
    try {
      const snapshot = await db.ref("config/isSchedulerActive").once("value");
      const val = snapshot.val();
      return val === null ? true : !!val;
    } catch (error) {
      console.error("⚠️ Firebase 스케줄러 상태 조회 중 오류 발생:", error);
      return false;
    }
  },

  /**
   * 스케줄러 활성화 여부 상태를 데이터베이스에 갱신합니다.
   * 경로: config/isSchedulerActive
   */
  async setSchedulerActiveStatus(active: boolean): Promise<void> {
    await db.ref("config/isSchedulerActive").set(active);
  },

  /**
   * 최근 자동 포스팅이 실행된 날짜를 가져옵니다.
   * 경로: config/lastAutoPostingDate
   */
  async getLastAutoPostingDate(): Promise<string | null> {
    try {
      const snapshot = await db.ref("config/lastAutoPostingDate").once("value");
      return snapshot.val();
    } catch (error) {
      console.error("⚠️ Firebase 최근 자동 포스팅 날짜 조회 중 오류 발생:", error);
      return null;
    }
  },

  /**
   * 최근 자동 포스팅이 실행된 날짜를 업데이트합니다.
   * 경로: config/lastAutoPostingDate
   */
  async setLastAutoPostingDate(dateStr: string): Promise<void> {
    await db.ref("config/lastAutoPostingDate").set(dateStr);
  },

  /**
   * 모든 블로그 포스트를 가져옵니다.
   * 경로: posts
   */
  async getAllPosts(): Promise<Record<string, BlogPost>> {
    try {
      const snapshot = await db.ref("posts").once("value");
      return snapshot.val() || {};
    } catch (error) {
      console.error("⚠️ Firebase 포스팅 정보 수집 중 오류 발생:", error);
      return {};
    }
  },

  /**
   * 새로운 포스트를 업로드합니다.
   * 경로: posts/{uuid}
   */
  async savePost(post: BlogPost): Promise<void> {
    await db.ref(`posts/${post.uuid}`).set(post);
    console.log(`✅ Firebase에 포스팅 저장 성공 (Admin SDK): ${post.title} (${post.uuid})`);
  },

  /**
   * 포스트를 데이터베이스에서 삭제합니다.
   * 경로: posts/{uuid}
   */
  async deletePost(uuid: string): Promise<void> {
    await db.ref(`posts/${uuid}`).remove();
    console.log(`🗑️ Firebase에서 포스팅 삭제 성공: ${uuid}`);
  },
};
