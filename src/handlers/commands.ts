import { Bot } from "grammy";
import { TelegramClient } from "telegram";
import { CONFIG } from "../config";
import { ensureUser, loadAnalytics, loadUsersSummary } from "../storage";
import { runDigest } from "../services/cron";
import { sendLongHtmlMessage } from "../utils";
import { pendingAdds, userWaitingMap, pendingInterestAdds } from "./state";
import {
  buildSourcesMessage,
  sourcesMainKeyboard,
  buildInterestsMessage,
  interestsMainKeyboard,
  buildScheduleMessage,
  buildScheduleKeyboard,
} from "./ui";

function clearPendingState(userId: number) {
  pendingAdds.delete(userId);
  userWaitingMap.delete(userId);
  pendingInterestAdds.delete(userId);
}

export function registerCommands(bot: Bot, tgClient: TelegramClient | null) {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) ensureUser(userId);

    const isConfigured = Boolean(
      CONFIG.OWNER_ID &&
      process.env.TG_STRING_SESSION &&
      process.env.TG_API_ID &&
      process.env.TG_API_HASH &&
      process.env.AI_API_KEY
    );

    let msg = `👋 <b>Добро пожаловать в Digest Bot!</b>\n\n`;
    msg += `🆔 <b>Ваш Chat ID:</b> <code>${userId}</code> <i>(нажмите, чтобы скопировать)</i>\n\n`;

    if (!isConfigured) {
      msg += `⚙️ <b>Инструкция по первоначальной настройке:</b>\n\n`;
      msg += `1. Откройте файл <code>.env</code> и укажите ваш ID:\n`;
      msg += `   <code>YOUR_CHAT_ID=${userId}</code>\n\n`;
      msg += `2. Получите <code>TG_API_ID</code> и <code>TG_API_HASH</code> на сайте <a href="https://my.telegram.org">my.telegram.org</a>\n\n`;
      msg += `3. Для чтения Telegram-каналов авторизуйтесь через терминал:\n`;
      msg += `   <code>bun run auth.ts</code>\n`;
      msg += `   <i>(скрипт запросит номер, код и сгенерирует строку для TG_STRING_SESSION)</i>\n\n`;
      msg += `4. В <code>.env</code> укажите ссылку на api вашего провайдера <code>AI_BASE_URL</code>, ключ <code>AI_API_KEY</code> и модель <code>AI_MODEL</code>\n\n`;
      msg += `<i>После сохранения параметров в .env перезапустите бота.</i>`;
    } else {
      msg += `Бот готов к работе. Доступные команды:\n\n` +
        `⚡ /latest — дайджест за 1 час\n` +
        `🗞 /digest — полный дайджест\n` +
        `📋 /sources — управление источниками (RSS / TG)\n` +
        `🎯 /interests — ваши темы и теги интересов\n` +
        `⏰ /schedule — время авто-рассылки\n` +
        `📊 /analytics — статистика генераций`;
    }

    await ctx.reply(msg, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("digest", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);
    clearPendingState(userId);

    const placeholder = await ctx.reply("⏳ <b>Собираю дайджест...</b>", { parse_mode: "HTML" });
    await runDigest(bot, tgClient, userId, CONFIG.MAIN_HOURS_WINDOW, "main", placeholder.message_id);
  });

  bot.command("latest", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);
    clearPendingState(userId);

    const placeholder = await ctx.reply("⏳ <b>Собираю последние новости...</b>", { parse_mode: "HTML" });
    await runDigest(bot, tgClient, userId, CONFIG.LATEST_HOURS_WINDOW, "latest", placeholder.message_id);
  });

  bot.command("sources", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);
    clearPendingState(userId);

    await ctx.reply(buildSourcesMessage(userId), {
      parse_mode: "HTML",
      reply_markup: sourcesMainKeyboard(),
    });
  });

  bot.command("interests", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);
    clearPendingState(userId);

    await ctx.reply(buildInterestsMessage(userId), {
      parse_mode: "HTML",
      reply_markup: interestsMainKeyboard(userId),
    });
  });

  bot.command("schedule", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);
    clearPendingState(userId);

    await ctx.reply(buildScheduleMessage(userId), {
      parse_mode: "HTML",
      reply_markup: buildScheduleKeyboard(),
    });
  });

  bot.command("analytics", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);
    clearPendingState(userId);

    const logs = loadAnalytics(userId);

    if (logs.length === 0) {
      await ctx.reply("📊 Аналитика пуста — у вас ещё не было генераций.");
      return;
    }

    const last = logs.slice(0, CONFIG.ANALYTICS_DISPLAY_LIMIT);
    const totalTokensAll = logs.reduce((s, l) => s + l.totalTokens, 0);

    let msg = `<b>📊 Ваша аналитика</b>\n\n`;
    msg += `Всего генераций: <b>${logs.length}</b>\n`;
    msg += `Токенов потрачено: <b>${totalTokensAll.toLocaleString("ru-RU")}</b>\n`;
    msg += `Среднее за запуск: <b>${Math.round(totalTokensAll / logs.length).toLocaleString("ru-RU")}</b>\n\n`;
    msg += `<b>Последние ${last.length}:</b>\n\n`;

    for (const l of last) {
      const tag = l.type === "latest" ? "⚡" : "🗞";
      msg += `${tag} <b>${l.timestamp}</b>\n`;
      msg += `   ${l.postsProcessed || "?"} постов → ${l.factsExtracted || "?"} фактов | ${l.totalTokens.toLocaleString("ru-RU")} tok\n\n`;
    }

    await sendLongHtmlMessage(bot, ctx.chat.id, msg);
  });

  bot.command("users", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId || userId !== CONFIG.OWNER_ID) return;

    const users = loadUsersSummary();
    if (users.length === 0) {
      await ctx.reply("👥 Пользователей в базе пока нет.");
      return;
    }

    const totalUsers = users.length;
    const totalAllTokens = users.reduce((s, u) => s + u.totalTokens, 0);
    const totalAllDigests = users.reduce((s, u) => s + u.totalDigests, 0);

    let msg = `👥 <b>Пользователи бота</b>\n\n`;
    msg += `Всего пользователей: <b>${totalUsers}</b>\n`;
    msg += `Всего дайджестов: <b>${totalAllDigests}</b>\n`;
    msg += `Всего токенов: <b>${totalAllTokens.toLocaleString("ru-RU")}</b>\n\n`;
    msg += `<b>Список пользователей:</b>\n\n`;

    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const isOwner = u.userId === CONFIG.OWNER_ID ? " 👑 <i>(Владелец)</i>" : "";
      msg += `${i + 1}. 👤 <b>ID:</b> <code>${u.userId}</code>${isOwner}\n`;
      msg += `   📊 Дайджестов: <b>${u.totalDigests}</b>\n`;
      msg += `   🪙 Токенов: <b>${u.totalTokens.toLocaleString("ru-RU")}</b>\n`;
      msg += `   📋 Источников: <b>${u.sourcesCount}</b>\n`;
      msg += `   🕒 Последняя генерация: <b>${u.lastGeneratedAt || "нет"}</b>\n\n`;
    }

    await sendLongHtmlMessage(bot, ctx.chat.id, msg);
  });
}
