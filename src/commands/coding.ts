import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import * as fs from "fs";
import * as path from "path";
import { Session } from "../db";
import { generateCodeUpdate } from "../ai";
import { getWorkspaceContext } from "../utils";
import { Command } from "../types";

export const coding: Command = {
  data: new SlashCommandBuilder()
    .setName("코딩")
    .setDescription(
      "AI를 통해 기획 명세 및 대화 내용을 분석해 자동으로 파일을 생성/수정합니다.",
    )
    .addStringOption((option) =>
      option
        .setName("요청")
        .setDescription("실행할 코딩 작업 지시 (예: 로그인 버튼 컴포넌트 추가)")
        .setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName("로컬모델사용")
        .setDescription("로컬 모델(Ollama) 사용 여부 (True: Ollama, False: Gemini)")
        .setRequired(false),
    ),
  requiresSession: true,
  requiresSpec: true,
  async execute(interaction: ChatInputCommandInteraction, session?: Session) {
    const currentSession = session!;
    const userRequest = interaction.options.getString("요청", true).trim();
    const localModelOpt = interaction.options.getBoolean("로컬모델사용");

    // 디스코드는 3초 이내에 응답하지 않으면 타임아웃 에러가 발생하므로 디퍼 응답 상태로 전환합니다.
    await interaction.deferReply();

    try {
      // 1. 워크스페이스 내 모든 소스 파일 정보 수집
      const workspaceContext = getWorkspaceContext(currentSession.project_path);

      // 2. AI 분석 응답 호출
      const changes = await generateCodeUpdate(
        currentSession.spec_summary,
        workspaceContext,
        userRequest,
        localModelOpt !== null ? localModelOpt : undefined,
      );

      if (changes.length === 0) {
        await interaction.editReply(
          `💻 **사용자 요청:** "${userRequest}"\n\nℹ️ AI 분석 결과, 변경해야 할 파일이 없습니다.`,
        );
        return;
      }

      const updatedFiles: string[] = [];

      // 3. 파일 쓰기 처리
      for (const change of changes) {
        const targetPath = path.resolve(currentSession.project_path, change.path);

        // 경로 이탈 보안 방지 검사
        if (!targetPath.startsWith(currentSession.project_path)) {
          console.warn(
            `[Security Warning] Blocked file write attempt outside workspace: ${change.path}`,
          );
          continue;
        }

        // 폴더 생성
        const dirPath = path.dirname(targetPath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        // 파일 덮어쓰기
        fs.writeFileSync(targetPath, change.content, "utf-8");
        updatedFiles.push(change.path);
      }

      const fileListStr = updatedFiles.map((f) => `- \`${f}\``).join("\n");
      await interaction.editReply(
        `💻 **사용자 요청:** "${userRequest}"\n\n✅ AI 코드 자동 인젝션 완료!\n다음 파일들이 생성/수정되어 로컬 워크스페이스에 저장되었습니다:\n${fileListStr}\n\nGitHub 원격 레포지토리에 반영하려면 \`/적용\` 명령을 입력해 주세요.`,
      );
    } catch (error: any) {
      console.error(error);
      const errorMsg = `💻 **사용자 요청:** "${userRequest}"\n\n❌ ChatOps 자동화 파이프라인 중단 에러: ${error.message}`;
      if (interaction.deferred) {
        await interaction.editReply(errorMsg);
      } else {
        await interaction.reply(errorMsg);
      }
    }
  },
};
