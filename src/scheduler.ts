import cron from "node-cron";
import { Client } from "discord.js";
import { firebaseClient } from "./firebase";
import { runBlogPostingPipeline } from "./blogPipeline";

export function initScheduler(client: Client) {
  console.log("⏰ 블로그 자동 포스팅 스케줄러를 등록합니다. (매일 오후 2시 KST 실행)");

  // 매일 오후 2시 정각(14:00)에 실행하는 크론 스케줄링 등록
  // 타임존을 Asia/Seoul로 명시하여 로컬 서버 타임존 영향 배제
  cron.schedule(
    "0 14 * * *",
    async () => {
      console.log("🔔 [스케줄러] 오후 2시 자동 포스팅 검사를 실행합니다...");

      try {
        const isActive = await firebaseClient.getSchedulerActiveStatus();
        if (!isActive) {
          console.log("ℹ️ [스케줄러] 자동 포스팅 스케줄러 상태가 '비활성화(false)' 상태이므로 생성을 건너뜁니다.");
          return;
        }

        console.log("🤖 [스케줄러] 자동 포스팅 스케줄러 활성화 확인. 포스팅 빌드를 시작합니다.");
        await runBlogPostingPipeline(client);
        console.log("✅ [스케줄러] 자동 포스팅 생성 및 업로드를 성공적으로 완료했습니다.");
      } catch (error: any) {
        console.error("❌ [스케줄러] 자동 포스팅 실행 중 예기치 못한 에러 발생:", error);
      }
    },
    {
      timezone: "Asia/Seoul",
    }
  );
}
