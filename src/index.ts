import { Client, GatewayIntentBits, Interaction, SlashCommandBuilder, REST, Routes } from 'discord.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { dbManager } from './db';
import { generateCodeUpdate } from './ollama';
import { setupAndPushRepo } from './git';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

// 미니 PC 인프라 내에서 대상 타겟 코드가 동기화되어 움직일 워크스페이스 정의
const WORKSPACE_DIR = path.resolve(process.env.HOME || '', 'discord-coder-domi/workspace');

if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

// 워크스페이스 내부의 텍스트 기반 소스 파일들을 재귀적으로 수집하여 컨텍스트화
function getWorkspaceContext(projectPath: string): { files: { path: string; content: string }[] } {
  const result: { files: { path: string; content: string }[] } = { files: [] };
  
  function traverse(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const list = fs.readdirSync(currentDir);
    for (const item of list) {
      if (item === '.git' || item === 'node_modules' || item === 'dist' || item === '.DS_Store') continue;
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        traverse(fullPath);
      } else if (stat.isFile()) {
        const relativePath = path.relative(projectPath, fullPath);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          result.files.push({ path: relativePath, content });
        } catch (e) {
          // 바이너리 파일이나 읽을 수 없는 파일은 무시
        }
      }
    }
  }
  
  traverse(projectPath);
  return result;
}

// 등록할 슬래시 커맨드 명세 정의
const commands = [
  new SlashCommandBuilder()
    .setName('연결')
    .setDescription('이 채널을 특정 애플리케이션의 개발 세션방으로 연결합니다.')
    .addStringOption(option =>
      option.setName('앱이름')
        .setDescription('생성하거나 연결할 애플리케이션 이름 (영어/숫자/대시만 가능)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('기획')
    .setDescription('프로젝트 기획 요구사항을 추가합니다.')
    .addStringOption(option =>
      option.setName('내용')
        .setDescription('추가할 기획 내용 (예: API 응답 지연 시 스켈레톤 UI 노출)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('코딩')
    .setDescription('Ollama를 통해 기획 명세 및 대화 내용을 분석해 자동으로 파일을 생성/수정합니다.')
    .addStringOption(option =>
      option.setName('요청')
        .setDescription('실행할 코딩 작업 지시 (예: 로그인 버튼 컴포넌트 추가)')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('적용')
    .setDescription('현재 프로젝트의 변경 코드를 GitHub 원격 레포지토리에 반영(Push)합니다.')
].map(command => command.toJSON());

client.once('ready', async (readyClient) => {
  console.log(`🚀 Coder-Domi ChatOps 에이전트 가동 상태 정상: ${readyClient.user?.tag}`);

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;

  if (token && clientId) {
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      console.log(`Started refreshing ${commands.length} application (/) commands.`);
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands }
      );
      console.log(`Successfully reloaded ${commands.length} application (/) commands.`);
    } catch (error) {
      console.error('⚠️ 슬래시 커맨드 등록 중 오류 발생:', error);
    }
  } else {
    console.warn('⚠️ DISCORD_TOKEN 또는 CLIENT_ID가 .env에 설정되지 않아 슬래시 커맨드를 등록할 수 없습니다.');
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, channelId } = interaction;

  // [명령어 1] 해당 채팅방을 가상 개발 세션으로 연결
  if (commandName === '연결') {
    const appName = interaction.options.getString('앱이름', true).trim();
    
    // 영어, 숫자, 대시(-) 문자만 포함하도록 방어적 이름 체크
    if (!/^[a-zA-Z0-9-_]+$/.test(appName)) {
      return interaction.reply({
        content: '❌ 앱 이름은 영문, 숫자, 대시(-), 언더바(_)만 사용할 수 있습니다.',
        ephemeral: true
      });
    }

    const projectPath = path.join(WORKSPACE_DIR, appName);
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }

    dbManager.saveSession(channelId, projectPath, '', appName);
    return interaction.reply(`✅ 이 채널을 [${appName}] 프로젝트 전용 실시간 개발 세션방으로 연결했습니다.\n경로: \`${projectPath}\``);
  }

  const session = dbManager.getSession(channelId);
  if (!session) {
    return interaction.reply({
      content: '❌ 활성화된 개발 세션이 없습니다. 먼저 `/연결 [앱이름]` 명령어로 채널을 연결해 주세요.',
      ephemeral: true
    });
  }

  // [명령어 2] 대화 기록 한계를 깨는 무제한 기획 명세서 아카이빙
  if (commandName === '기획') {
    const newSpec = interaction.options.getString('내용', true).trim();

    // 기존 세션에 누적 적재
    const updatedSpec = session.spec_summary 
      ? `${session.spec_summary}\n- ${newSpec}`
      : `- ${newSpec}`;

    dbManager.saveSession(channelId, session.project_path, updatedSpec, session.app_name);

    // 트랙 A: 파일 시스템(SPEC.md) 실시간 생성 및 동기화 박제
    const specFilePath = path.join(session.project_path, 'SPEC.md');
    fs.writeFileSync(specFilePath, updatedSpec, 'utf-8');

    return interaction.reply(`📝 기획 명세가 추가되었습니다. 전체 기획 아카이브는 프로젝트 내부 SPEC.md 파일에 영구 릴리즈됩니다.`);
  }

  // [명령어 3] qwen2.5-coder 두뇌 가동 -> 자동 파일 생성 및 변조 (로컬 저장만 처리)
  if (commandName === '코딩') {
    const userRequest = interaction.options.getString('요청', true).trim();

    if (!session.spec_summary) {
      return interaction.reply('❌ 활성화된 기획 명세서가 부재합니다. 먼저 `/기획` 명령어로 프로젝트 골격을 설명해 주세요.');
    }

    // 디스코드는 3초 이내에 응답하지 않으면 타임아웃 에러가 발생하므로 디퍼 응답 상태로 전환합니다.
    await interaction.deferReply();

    try {
      // 1. 워크스페이스 내 모든 소스 파일 정보 수집
      const workspaceContext = getWorkspaceContext(session.project_path);

      // 2. Ollama JSON 응답 호출
      const changes = await generateCodeUpdate(session.spec_summary, workspaceContext, userRequest);

      if (changes.length === 0) {
        await interaction.editReply('ℹ️ Ollama 분석 결과, 변경해야 할 파일이 없습니다.');
        return;
      }

      const updatedFiles: string[] = [];

      // 3. 파일 쓰기 처리
      for (const change of changes) {
        const targetPath = path.resolve(session.project_path, change.path);
        
        // 경로 이탈 보안 방지 검사
        if (!targetPath.startsWith(session.project_path)) {
          console.warn(`[Security Warning] Blocked file write attempt outside workspace: ${change.path}`);
          continue;
        }

        // 폴더 생성
        const dirPath = path.dirname(targetPath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }

        // 파일 덮어쓰기
        fs.writeFileSync(targetPath, change.content, 'utf-8');
        updatedFiles.push(change.path);
      }

      const fileListStr = updatedFiles.map(f => `- \`${f}\``).join('\n');
      await interaction.editReply(`✅ AI 코드 자동 인젝션 완료!\n다음 파일들이 생성/수정되어 로컬 워크스페이스에 저장되었습니다:\n${fileListStr}\n\nGitHub 원격 레포지토리에 반영하려면 \`/적용\` 명령을 입력해 주세요.`);

    } catch (error: any) {
      console.error(error);
      if (interaction.deferred) {
        await interaction.editReply(`❌ ChatOps 자동화 파이프라인 중단 에러: ${error.message}`);
      } else {
        await interaction.reply(`❌ ChatOps 자동화 파이프라인 중단 에러: ${error.message}`);
      }
    }
  }

  // [명령어 4] GitHub 원격 자동 생성 및 푸시 파이프라인
  if (commandName === '적용') {
    const gitToken = process.env.GIT_TOKEN;
    if (!gitToken) {
      return interaction.reply({
        content: '❌ 서버 `.env` 파일에 `GIT_TOKEN` 설정이 누락되었습니다. GitHub Personal Access Token을 설정해 주세요.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const repoUrl = await setupAndPushRepo(session.project_path, session.app_name, gitToken);
      await interaction.editReply(`🚀 GitHub 레포지토리 배포 완료!\n원격 저장소 주소: ${repoUrl}`);
    } catch (error: any) {
      console.error(error);
      await interaction.editReply(`❌ GitHub 동기화 적용 실패: ${error.message}`);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
