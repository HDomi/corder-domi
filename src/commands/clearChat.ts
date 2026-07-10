import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "../types";

export const clearChat: Command = {
  data: new SlashCommandBuilder()
    .setName("채팅삭제")
    .setDescription("현재 채널의 최근 14일 이내 메시지들을 모두 일괄 삭제합니다."),
  requiresSession: false,
  async execute(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel;
    if (
      !channel ||
      !channel.isTextBased() ||
      channel.type === ChannelType.DM ||
      channel.type === ChannelType.GroupDM
    ) {
      return interaction.reply({
        content: "❌ 이 명령어는 텍스트 채널에서만 사용할 수 있습니다.",
        ephemeral: true,
      });
    }

    if ("bulkDelete" in channel) {
      await interaction.deferReply({ ephemeral: true });

      try {
        let totalDeleted = 0;
        let fetched;
        
        do {
          fetched = await channel.messages.fetch({ limit: 100 });
          if (fetched.size === 0) break;

          // filterOld = true를 설정하여 14일이 지난 메시지는 자동 제외하고 삭제합니다.
          const deleted = await channel.bulkDelete(fetched, true);
          totalDeleted += deleted.size;

          // 패치한 메시지는 있으나 삭제된 메시지가 0개라면 (모든 메시지가 14일 이상 경과), 무한루프 방지를 위해 종료
          if (deleted.size === 0) {
            break;
          }
        } while (fetched.size >= 100);

        return interaction.editReply({
          content: `✅ 현재 채널에서 최근 14일 이내의 메시지 **${totalDeleted}개**를 성공적으로 삭제했습니다.`,
        });
      } catch (error: any) {
        console.error("❌ [채팅삭제 오류]", error);
        return interaction.editReply({
          content: `❌ 메시지 삭제 중 오류가 발생했습니다: ${error.message}`,
        });
      }
    } else {
      return interaction.reply({
        content: "❌ 메시지 일괄 삭제(bulkDelete)를 지원하지 않는 채널 타입입니다.",
        ephemeral: true,
      });
    }
  },
};
