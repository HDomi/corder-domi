import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { Command } from "../types";
import { firebaseClient } from "../firebase";
import { triggerBlogDeploy } from "../git";

export const deletePost: Command = {
  data: new SlashCommandBuilder()
    .setName("포스트삭제")
    .setDescription("블로그 포스팅 목록을 조회하여 특정 포스트를 안전하게 삭제합니다."),
  async execute(interaction: ChatInputCommandInteraction) {
    // 디스코드 인터랙션 타임아웃 방지 및 관리 전용 커맨드이므로 비공개(ephemeral) 답변으로 처리
    await interaction.deferReply({ ephemeral: true });

    try {
      const postsRecord = await firebaseClient.getAllPosts();
      const posts = Object.values(postsRecord).sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });

      if (posts.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setTitle("🗑️ AI 블로그 포스트 삭제")
          .setDescription("❌ 등록된 블로그 포스트가 존재하지 않습니다.")
          .setColor(0xe74c3c)
          .setTimestamp();

        return interaction.editReply({ embeds: [emptyEmbed] });
      }

      const itemsPerPage = 10;
      const totalPages = Math.ceil(posts.length / itemsPerPage);

      // 특정 페이지의 메시지 데이터를 생성하는 함수
      const generatePageMessage = (page: number) => {
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pagePosts = posts.slice(startIndex, endIndex);

        const embed = new EmbedBuilder()
          .setTitle(`🗑️ AI 블로그 포스트 삭제 목록 (${page}/${totalPages} 페이지)`)
          .setDescription(
            "삭제를 원하시는 포스트를 아래 선택 메뉴에서 골라주세요.\n한 페이지당 최대 10개의 포스트가 표시됩니다.",
          )
          .setColor(0xe74c3c)
          .setTimestamp();

        // 임베드 필드에 글 정보 표시
        pagePosts.forEach((post, idx) => {
          const indexNum = startIndex + idx + 1;
          embed.addFields({
            name: `${indexNum}. ${post.title}`,
            value: `요약: *${post.summary || "요약 없음"}*\n작성일: \`${post.createdAt || "알 수 없음"}\``,
          });
        });

        // 10개 글 선택용 드롭다운 구성
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId("delete_post_select_menu")
          .setPlaceholder("삭제할 포스트를 선택해 주세요...")
          .addOptions(
            pagePosts.map((post, idx) => ({
              label: `${startIndex + idx + 1}. ${post.title.substring(0, 90)}`,
              description: `${(post.summary || "").substring(0, 90) || "요약 없음"}`,
              value: `delete_uuid_${post.uuid}_page_${page}`,
            })),
          );

        // 페이지 네이션 버튼 구성
        const prevBtn = new ButtonBuilder()
          .setCustomId(`delete_prev_${page - 1}`)
          .setLabel("◀ 이전")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 1);

        const nextBtn = new ButtonBuilder()
          .setCustomId(`delete_next_${page + 1}`)
          .setLabel("다음 ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === totalPages);

        const cancelBtn = new ButtonBuilder()
          .setCustomId("delete_cancel")
          .setLabel("❌ 취소")
          .setStyle(ButtonStyle.Danger);

        const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          prevBtn,
          nextBtn,
          cancelBtn,
        );

        return {
          embeds: [embed],
          components: [menuRow, buttonRow],
        };
      };

      const reply = await interaction.editReply(generatePageMessage(1));

      // 버튼 및 드롭다운 응답 수집기 설정 (작동 시간 5분)
      const collector = reply.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 300000,
      });

      collector.on("collect", async (i) => {
        try {
          if (i.customId.startsWith("delete_prev_") || i.customId.startsWith("delete_next_")) {
            const page = parseInt(i.customId.split("_")[2]);
            await i.update(generatePageMessage(page));
          } else if (i.customId === "delete_cancel") {
            const cancelEmbed = new EmbedBuilder()
              .setTitle("🗑️ AI 블로그 포스트 삭제")
              .setDescription("❌ 포스트 삭제 작업이 취소되었습니다.")
              .setColor(0x95a5a6)
              .setTimestamp();

            await i.update({ embeds: [cancelEmbed], components: [] });
            collector.stop();
          } else if (i.isStringSelectMenu() && i.customId === "delete_post_select_menu") {
            const parts = i.values[0].split("_");
            const uuid = parts[2];
            const page = parseInt(parts[4]);

            const post = posts.find((p) => p.uuid === uuid);
            if (!post) {
              await i.update({
                content: "❌ 해당 포스트를 찾을 수 없습니다.",
                embeds: [],
                components: [],
              });
              return;
            }

            const confirmEmbed = new EmbedBuilder()
              .setTitle("⚠️ 포스트 삭제 최종 확인")
              .setDescription(
                `정말로 아래 포스트를 삭제하시겠습니까?\n삭제된 포스트는 복구할 수 없으며 블로그 사이트가 자동으로 재배포됩니다.`,
              )
              .setColor(0xf39c12)
              .addFields(
                { name: "📝 제목", value: post.title },
                { name: "💡 요약", value: post.summary || "(요약 없음)" },
                { name: "🕒 작성일", value: post.createdAt || "(알 수 없음)", inline: true },
                { name: "🆔 UUID", value: `\`${post.uuid}\``, inline: true },
              )
              .setTimestamp();

            const deleteBtn = new ButtonBuilder()
              .setCustomId(`delete_confirm_${uuid}_${page}`)
              .setLabel("🗑️ 삭제하기")
              .setStyle(ButtonStyle.Danger);

            const backBtn = new ButtonBuilder()
              .setCustomId(`delete_back_${page}`)
              .setLabel("◀ 목록으로")
              .setStyle(ButtonStyle.Secondary);

            const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
              deleteBtn,
              backBtn,
            );

            await i.update({ embeds: [confirmEmbed], components: [confirmRow] });
          } else if (i.customId.startsWith("delete_confirm_")) {
            const parts = i.customId.split("_");
            const uuid = parts[2];

            const post = posts.find((p) => p.uuid === uuid);
            if (!post) {
              await i.update({
                content: "❌ 이미 삭제되었거나 존재하지 않는 포스트입니다.",
                embeds: [],
                components: [],
              });
              return;
            }

            // 1. Firebase 실시간 데이터베이스에서 포스트 삭제
            await firebaseClient.deletePost(uuid);

            // 2. GitHub Pages 재배포 트리거
            const deployTriggered = await triggerBlogDeploy();

            const successEmbed = new EmbedBuilder()
              .setTitle("🗑️ 포스트 삭제 완료")
              .setDescription(`성공적으로 포스트를 데이터베이스에서 삭제했습니다.`)
              .setColor(0x2ecc71)
              .addFields(
                { name: "📝 제목", value: post.title },
                {
                  name: "🚀 정적 사이트 배포",
                  value: deployTriggered
                    ? "🟢 GitHub Actions 자동 배포 트리거됨 (3~5분 소요)"
                    : "🔴 GitHub Actions 배포 트리거 실패 또는 건너뜀",
                },
              )
              .setTimestamp();

            await i.update({ embeds: [successEmbed], components: [] });
            collector.stop();
          } else if (i.customId.startsWith("delete_back_")) {
            const page = parseInt(i.customId.split("_")[2]);
            await i.update(generatePageMessage(page));
          }
        } catch (err: any) {
          console.error("❌ 삭제 프로세스 중 예외 발생:", err);
          await i.followUp({
            content: `❌ 삭제 과정 중 오류가 발생했습니다: ${err.message}`,
            ephemeral: true,
          });
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          try {
            const timeoutEmbed = new EmbedBuilder()
              .setTitle("🗑️ AI 블로그 포스트 삭제")
              .setDescription("⏰ 입력 대기 시간이 초과되어 삭제 세션이 만료되었습니다.")
              .setColor(0x95a5a6)
              .setTimestamp();

            await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
          } catch (e) {
            // Ignore
          }
        }
      });
    } catch (error: any) {
      console.error("❌ 포스트삭제 커맨드 실행 실패:", error);
      await interaction.editReply(`❌ 포스트 삭제 목록을 불러오는 중 오류 발생: ${error.message}`);
    }
  },
};
