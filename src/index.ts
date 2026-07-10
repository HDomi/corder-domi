import {
  Client,
  GatewayIntentBits,
  Interaction,
  REST,
  Routes,
} from "discord.js";
import * as dotenv from "dotenv";
import { dbManager } from "./db";
import { initLogger } from "./logger";
import { commands } from "./commands";
import { initScheduler } from "./scheduler";

dotenv.config();

// 글로벌 console.log/error 우회 및 파일 로깅 초기화
initLogger();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 명령어 이름으로 매핑하는 Map 구성
const commandMap = new Map(commands.map((cmd) => [cmd.data.name, cmd]));
const commandsJson = commands.map((cmd) => cmd.data.toJSON());

client.once("ready", async (readyClient) => {
  console.log(
    `🚀 Coder-Domi ChatOps 에이전트 가동 상태 정상: ${readyClient.user?.tag}`,
  );

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (token && clientId) {
    try {
      const rest = new REST({ version: "10" }).setToken(token);
      console.log(
        `${commandsJson.length}개의 애플리케이션 (/) 슬래시 커맨드 등록(갱신)을 시작합니다.`,
      );
      await rest.put(Routes.applicationCommands(clientId), { body: commandsJson });
      console.log(
        `성공적으로 ${commandsJson.length}개의 애플리케이션 (/) 슬래시 커맨드를 등록(갱신)했습니다.`,
      );
    } catch (error) {
      console.error("⚠️ 슬래시 커맨드 등록 중 오류 발생:", error);
    }
  } else {
    console.warn(
      "⚠️ DISCORD_TOKEN 또는 CLIENT_ID가 .env에 설정되지 않아 슬래시 커맨드를 등록할 수 없습니다.",
    );
  }

  // 블로그 자동 포스팅 스케줄러 가동
  initScheduler(readyClient);
});

client.on("interactionCreate", async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;
  const command = commandMap.get(commandName);

  if (!command) {
    console.warn(`⚠️ 등록되지 않은 커맨드 호출: ${commandName}`);
    return;
  }

  // 사전 조건(Preconditions) 검사
  let session = null;
  if (command.requiresSession) {
    session = dbManager.getSession(interaction.channelId);
    if (!session) {
      return interaction.reply({
        content:
          "❌ 활성화된 개발 세션이 없습니다. 먼저 `/연결 [앱이름]` 명령어로 채널을 연결해 주세요.",
        ephemeral: true,
      });
    }
  }

  if (command.requiresSpec) {
    // requiresSpec이 true인 경우 requiresSession도 참이어야 하므로 session이 존재합니다.
    if (!session || !session.spec_summary) {
      return interaction.reply({
        content:
          "❌ 활성화된 기획 명세서가 부재합니다. 먼저 `/기획` 명령어로 프로젝트 골격을 설명해 주세요.",
        ephemeral: true,
      });
    }
  }

  try {
    await command.execute(interaction, session || undefined);
  } catch (error: any) {
    console.error(`❌ 커맨드 실행 중 에러 발생 (${commandName}):`, error);
    const errorMsg = `❌ 명령어 실행 중 오류가 발생했습니다: ${error.message}`;
    if (interaction.deferred) {
      await interaction.editReply(errorMsg);
    } else if (interaction.replied) {
      await interaction.followUp({ content: errorMsg, ephemeral: true });
    } else {
      await interaction.reply({ content: errorMsg, ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
