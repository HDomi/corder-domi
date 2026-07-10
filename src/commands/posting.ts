import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Command } from "../types";
import { runBlogPostingPipeline } from "../blogPipeline";

export const posting: Command = {
  data: new SlashCommandBuilder()
    .setName("포스팅")
    .setDescription("즉시 AI 블로그 포스팅을 생성하고 Firebase에 업로드합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    // LLM 추론 및 임베딩 연산에 2~4분이 소요되므로 interaction 타임아웃을 막기 위해 deferReply 적용
    await interaction.deferReply();

    const startTime = Date.now();
    let currentStatus = "1단계: 과거 포스팅(RAG) 데이터 로드 중...";

    // 경과 시간을 사람이 읽기 좋은 형식으로 포맷팅
    const formatElapsed = (ms: number): string => {
      const totalSeconds = Math.floor(ms / 1000);
      if (totalSeconds < 60) return `${totalSeconds}초`;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}분 ${seconds}초`;
    };

    // 공통 Embed 업데이트 헬퍼
    const updateProgressEmbed = async (status: string) => {
      currentStatus = status;
      const elapsed = Date.now() - startTime;

      const progressEmbed = new EmbedBuilder()
        .setTitle("🔄 AI 블로그 포스팅 생성 중...")
        .setDescription("포스팅 생성 작업을 수행하고 있습니다. 완료 시 정적 블로그 빌드가 함께 시작됩니다.")
        .setColor(0x3498db) // 파란색
        .addFields(
          { name: "📋 현재 단계", value: currentStatus },
          { name: "⏱️ 경과 시간", value: formatElapsed(elapsed) }
        )
        .setTimestamp();

      try {
        await interaction.editReply({ embeds: [progressEmbed] });
      } catch (e) {
        // API 레이턴시 등으로 인한 일시적 에러나 인터랙션 취소 무시
      }
    };

    // 첫 안내 임베드 발송
    await updateProgressEmbed(currentStatus);

    // 3초 간격 실시간 갱신 타이머 시작
    const timer = setInterval(async () => {
      await updateProgressEmbed(currentStatus);
    }, 3000);

    try {
      const post = await runBlogPostingPipeline(
        interaction.client,
        undefined,
        async (statusMsg) => {
          await updateProgressEmbed(statusMsg);
        }
      );

      clearInterval(timer);

      const totalTime = Date.now() - startTime;
      const embed = new EmbedBuilder()
        .setTitle("✅ AI 블로그 수동 포스팅 완료")
        .setDescription(`성공적으로 새로운 에세이를 작성하고 Firebase RTDB에 등록했습니다.`)
        .setColor(0x2ecc71)
        .addFields(
          { name: "📝 제목", value: post.title },
          { name: "💡 요약", value: post.summary || "(요약 없음)" },
          { name: "🏷️ 태그", value: Object.keys(post.tags).join(", ") || "(태그 없음)" },
          { name: "🆔 UUID", value: `\`${post.uuid}\``, inline: true },
          { name: "🕒 작성시간", value: post.createdAt, inline: true },
          { name: "⏱️ 총 소요 시간", value: formatElapsed(totalTime), inline: true },
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: any) {
      clearInterval(timer);
      console.error("❌ 수동 포스팅 생성 실패:", error);

      const totalTime = Date.now() - startTime;
      const errorEmbed = new EmbedBuilder()
        .setTitle("❌ 포스팅 생성 실패")
        .setDescription(`작업 도중 오류가 발생하여 중단되었습니다.`)
        .setColor(0xe74c3c)
        .addFields(
          { name: "🔍 오류 내용", value: error.message || "알 수 없는 오류" },
          { name: "⏱️ 경과 시간", value: formatElapsed(totalTime) }
        )
        .setTimestamp();

      try {
        await interaction.editReply({ embeds: [errorEmbed] });
      } catch (e) {
        // 이미 종료된 인터랙션 무시
      }
    }
  },
};
