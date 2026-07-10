import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { Command } from "../types";
import { stopBlogPostingPipeline } from "../blogPipeline";

export const stopPosting: Command = {
  data: new SlashCommandBuilder()
    .setName("포스팅중지")
    .setDescription("현재 진행 중인 AI 블로그 포스팅 생성 및 Ollama 연산을 즉시 중단합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    const success = stopBlogPostingPipeline();

    if (!success) {
      return interaction.reply({
        content: "ℹ️ 현재 실행 중인 포스팅 생성 파이프라인 작업이 없습니다.",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("⏹️ 포스팅 생성 작업 중지")
      .setDescription("진행 중이던 AI 블로그 포스팅 생성 작업 및 Ollama 연산 호출을 강제 중단했습니다.")
      .setColor(0xe74c3c) // 빨간색
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
