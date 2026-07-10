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

    try {
      const post = await runBlogPostingPipeline(interaction.client);

      const embed = new EmbedBuilder()
        .setTitle("✅ AI 블로그 수동 포스팅 완료")
        .setDescription(`성공적으로 새로운 에세이를 작성하고 Firebase RTDB에 등록했습니다.`)
        .setColor(0x2ecc71)
        .addFields(
          { name: "📝 제목", value: post.title },
          { name: "💡 요약", value: post.summary || "(요약 없음)" },
          { name: "🏷️ 태그", value: Object.keys(post.tags).join(", ") || "(태그 없음)" },
          { name: "🆔 UUID", value: `\`${post.uuid}\``, inline: true },
          { name: "🕒 작성시간", value: post.createdAt, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (error: any) {
      console.error("❌ 수동 포스팅 생성 실패:", error);
      await interaction.editReply(`❌ 포스팅 생성 중 오류가 발생했습니다: ${error.message}`);
    }
  },
};
