import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Session } from "../db";
import { setupPushAndDeployPages } from "../git";
import { Command } from "../types";

export const deploy: Command = {
  data: new SlashCommandBuilder()
    .setName("배포")
    .setDescription(
      "현재 프로젝트를 GitHub 원격 레포지토리에 반영(Push)하고 GitHub Pages로 자동 배포합니다.",
    ),
  requiresSession: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const gitToken = process.env.GIT_TOKEN;
    if (!gitToken) {
      return interaction.reply({
        content:
          "❌ 서버 `.env` 파일에 `GIT_TOKEN` 설정이 누락되었습니다. GitHub Personal Access Token을 설정해 주세요.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const { repoUrl, pagesUrl } = await setupPushAndDeployPages(
        currentSession.project_path,
        currentSession.app_name,
        gitToken,
      );
      await interaction.editReply(
        `🚀 GitHub 레포지토리 및 Pages 배포 완료!\n\n📂 **원격 저장소 주소:** ${repoUrl}\n🌐 **GitHub Pages 주소:** ${pagesUrl}\n*(참고: Pages 배포 워크플로우 완료 후 사이트가 실제 가동되기까지 약 1~2분 소요될 수 있습니다.)*`,
      );
    } catch (error: any) {
      console.error(error);
      await interaction.editReply(
        `❌ GitHub Pages 배포 적용 실패: ${error.message}`,
      );
    }
  },
};
