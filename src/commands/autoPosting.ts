import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Command } from "../types";
import { firebaseClient } from "../firebase";

export const autoPosting: Command = {
  data: new SlashCommandBuilder()
    .setName("자동포스팅")
    .setDescription("블로그 자동 포스팅 스케줄러의 활성화 상태를 조회하거나 변경합니다.")
    .addBooleanOption((option) =>
      option
        .setName("활성화")
        .setDescription("스케줄러 작동 여부 설정 (생략 시 토글 토글)")
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const currentStatus = await firebaseClient.getSchedulerActiveStatus();
      const inputStatus = interaction.options.getBoolean("활성화");

      // 입력 인자가 생략되었으면 현재 상태의 반대로 토글, 있으면 입력 값으로 변경
      const newStatus = inputStatus !== null ? inputStatus : !currentStatus;

      await firebaseClient.setSchedulerActiveStatus(newStatus);

      const embed = new EmbedBuilder()
        .setTitle("⏰ 블로그 자동 포스팅 스케줄러 설정 변경")
        .setDescription(`스케줄러 상태가 업데이트되었습니다.`)
        .setColor(newStatus ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: "📊 스케줄러 상태", value: newStatus ? "🟢 활성화됨 (Active)" : "🔴 비활성화됨 (Inactive)" },
          { name: "🕒 스케줄 시각", value: "매일 오후 2:00 정각 (KST/Asia/Seoul)", inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: any) {
      console.error("❌ 자동 포스팅 스케줄러 상태 변경 실패:", error);
      await interaction.editReply(`❌ 스케줄러 상태 변경 중 오류가 발생했습니다: ${error.message}`);
    }
  },
};
