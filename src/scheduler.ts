import cron from "node-cron";
import { Client } from "discord.js";
import { firebaseClient } from "./firebase";
import { runBlogPostingPipeline } from "./blogPipeline";

export async function initScheduler(client: Client) {
  console.log("⏰ 블로그 자동 포스팅 스케줄러를 등록합니다. (매일 오후 2시 KST 실행)");

  // KST 기준 현재 날짜와 시간 구하기 헬퍼
  const getKstInfo = () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));

    const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;
    const hour = parseInt(partMap.hour, 10);
    return { dateStr, hour };
  };

  // 1. 서버 시작/재배포 시점에 오늘 이미 자동 포스팅이 실행되었는지 확인하고 누락 시 자동 빌드 트리거 (자가 복구)
  try {
    const isActive = await firebaseClient.getSchedulerActiveStatus();
    if (isActive) {
      const { dateStr, hour } = getKstInfo();
      console.log(
        `🔍 [스케줄러] 시작 시점 검사: 활성화 상태. 현재 KST 시각: ${hour}시. 오늘 날짜: ${dateStr}`,
      );

      // 현재 시간이 오후 2시(14시) 이후인 경우에만 당일 자동 포스팅 실행 여부를 체크하여 누락분 보정
      if (hour >= 14) {
        const lastAutoPostDate = await firebaseClient.getLastAutoPostingDate();

        if (lastAutoPostDate !== dateStr) {
          console.log(
            `🔔 [스케줄러] 오늘(${dateStr}) 오후 2시 정기 자동 포스팅이 누락되었습니다. 즉시 생성을 시작합니다.`,
          );

          // 먼저 실행 날짜 기록을 남겨 다중 기동 시 중복 생성을 즉시 차단
          await firebaseClient.setLastAutoPostingDate(dateStr);

          // 백그라운드에서 비동기 처리하여 봇 구동 지연 방지
          runBlogPostingPipeline(client).catch(async (err) => {
            console.error("❌ [스케줄러] 시작 시점 자동 포스팅 실행 중 오류 발생:", err);
            // 에러가 났을 경우 다시 재시도될 수 있도록 날짜 기록 롤백 처리
            await firebaseClient.setLastAutoPostingDate("");
          });
        } else {
          console.log(
            `ℹ️ [스케줄러] 오늘(${dateStr}) 자동 포스팅이 이미 성공적으로 완료되었습니다.`,
          );
        }
      } else {
        console.log(
          "ℹ️ [스케줄러] 아직 오늘 오후 2시 전이므로 즉시 자동 포스팅을 트리거하지 않고 정기 크론을 대기합니다.",
        );
      }
    } else {
      console.log("ℹ️ [스케줄러] 시작 시점 검사: 자동 포스팅 스케줄러가 비활성화 상태입니다.");
    }
  } catch (error: any) {
    console.error("❌ [스케줄러] 시작 시점 자가 복구 검사 실패:", error);
  }

  // 2. 매일 오후 2시 정각(14:00)에 실행하는 크론 스케줄링 등록
  // 타임존을 Asia/Seoul로 명시하여 로컬 서버 타임존 영향 배제
  cron.schedule(
    "0 14 * * *",
    async () => {
      console.log("🔔 [스케줄러] 오후 2시 자동 포스팅 검사를 실행합니다...");

      try {
        const isActive = await firebaseClient.getSchedulerActiveStatus();
        if (!isActive) {
          console.log(
            "ℹ️ [스케줄러] 자동 포스팅 스케줄러 상태가 '비활성화(false)' 상태이므로 생성을 건너뜁니다.",
          );
          return;
        }

        const { dateStr } = getKstInfo();
        console.log(
          `🤖 [스케줄러] 자동 포스팅 스케줄러 활성화 확인. 포스팅 빌드를 시작합니다. (오늘 날짜: ${dateStr})`,
        );

        // 실행 기록 선갱신으로 중복 호출 예방
        await firebaseClient.setLastAutoPostingDate(dateStr);

        await runBlogPostingPipeline(client);
        console.log("✅ [스케줄러] 자동 포스팅 생성 및 업로드를 성공적으로 완료했습니다.");
      } catch (error: any) {
        console.error("❌ [스케줄러] 자동 포스팅 실행 중 예기치 못한 에러 발생:", error);
        // 에러 시 롤백하여 수동/자가 복구가 감지할 수 있도록 함
        await firebaseClient.setLastAutoPostingDate("");
      }
    },
    {
      timezone: "Asia/Seoul",
    },
  );
}
