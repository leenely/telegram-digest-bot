import { Bot, InlineKeyboard } from "grammy";
import { TelegramClient } from "telegram";
import { logError } from "../logger";
import {
  ensureUser,
  loadSources,
  addSources,
  removeRssSource,
  removeTelegramSource,
  loadSettings,
  addInterests,
  removeInterest,
} from "../storage";
import { pendingAdds, userWaitingMap, pendingInterestAdds } from "./state";
import { PendingAdd } from "../types";
import {
  buildSourcesMessage,
  sourcesMainKeyboard,
  buildDeleteKeyboard,
  buildPendingMessage,
  confirmKeyboard,
  buildInterestsMessage,
  interestsMainKeyboard,
  buildInterestsDeleteKeyboard,
  buildPendingInterestsMessage,
  confirmInterestsKeyboard,
  buildScheduleMessage,
  buildScheduleKeyboard,
} from "./ui";

export function registerCallbacks(bot: Bot, tgClient: TelegramClient | null) {
  bot.callbackQuery("src_add", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const pending: PendingAdd = { rss: [], telegram: [], messageId: null };
    pendingAdds.set(userId, pending);

    try {
      await ctx.editMessageText(buildPendingMessage(pending), {
        parse_mode: "HTML",
        reply_markup: confirmKeyboard,
      });
      pending.messageId = ctx.msg!.message_id;
    } catch {
      const sent = await ctx.reply(buildPendingMessage(pending), {
        parse_mode: "HTML",
        reply_markup: confirmKeyboard,
      });
      pending.messageId = sent.message_id;
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("src_delete_mode", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const sources = loadSources(userId);
    if (sources.rss.length === 0 && sources.telegram.length === 0) {
      await ctx.answerCallbackQuery({ text: "Нечего удалять — список пуст." });
      return;
    }

    try {
      await ctx.editMessageText(
        "<b>🗑 Удаление источников</b>\n\nНажмите на источник, чтобы удалить его:",
        { parse_mode: "HTML", reply_markup: buildDeleteKeyboard(userId) },
      );
    } catch (e) {
      logError("Failed to enter delete mode", e);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^src_del_r:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const idx = parseInt(ctx.match[1], 10);
    const sources = loadSources(userId);
    const deleted = sources.rss[idx];

    if (deleted) removeRssSource(userId, deleted);

    const updatedSources = loadSources(userId);

    if (updatedSources.rss.length === 0 && updatedSources.telegram.length === 0) {
      try {
        await ctx.editMessageText(buildSourcesMessage(userId), {
          parse_mode: "HTML",
          reply_markup: sourcesMainKeyboard(),
        });
      } catch (e) { logError("Failed to update sources view", e); }
    } else {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: buildDeleteKeyboard(userId) });
      } catch (e) { logError("Failed to update delete keyboard", e); }
    }

    const short = deleted && deleted.length > 25 ? deleted.slice(0, 22) + "..." : (deleted || "");
    await ctx.answerCallbackQuery({ text: `Удалён: ${short}` });
  });

  bot.callbackQuery(/^src_del_t:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const idx = parseInt(ctx.match[1], 10);
    const sources = loadSources(userId);
    const deleted = sources.telegram[idx];

    if (deleted) removeTelegramSource(userId, deleted);

    const updatedSources = loadSources(userId);

    if (updatedSources.rss.length === 0 && updatedSources.telegram.length === 0) {
      try {
        await ctx.editMessageText(buildSourcesMessage(userId), {
          parse_mode: "HTML",
          reply_markup: sourcesMainKeyboard(),
        });
      } catch (e) { logError("Failed to update sources view", e); }
    } else {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: buildDeleteKeyboard(userId) });
      } catch (e) { logError("Failed to update delete keyboard", e); }
    }

    await ctx.answerCallbackQuery({ text: `Удалён: @${deleted || ""}` });
  });

  bot.callbackQuery("src_back", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      ensureUser(userId);
      pendingAdds.delete(userId);
    }

    try {
      await ctx.editMessageText(buildSourcesMessage(userId || 0), {
        parse_mode: "HTML",
        reply_markup: sourcesMainKeyboard(),
      });
    } catch (e) { logError("Failed to return to sources menu", e); }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("confirm_add", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const pending = pendingAdds.get(userId);
    if (!pending || (pending.rss.length === 0 && pending.telegram.length === 0)) {
      await ctx.answerCallbackQuery({ text: "Нечего добавлять." });
      return;
    }

    const result = addSources(userId, pending.rss, pending.telegram);
    const addedTotal = result.addedRss + result.addedTg;
    pendingAdds.delete(userId);

    try {
      await ctx.editMessageText(buildSourcesMessage(userId), {
        parse_mode: "HTML",
        reply_markup: sourcesMainKeyboard(),
      });
    } catch (e) { logError("Failed to save sources", e); }

    await ctx.answerCallbackQuery({ text: `✅ Добавлено: ${addedTotal}` });
  });

  bot.callbackQuery("int_add", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const pending = { tags: [] as string[], messageId: null as number | null };
    pendingInterestAdds.set(userId, pending);

    try {
      await ctx.editMessageText(buildPendingInterestsMessage([]), {
        parse_mode: "HTML",
        reply_markup: confirmInterestsKeyboard,
      });
      pending.messageId = ctx.msg!.message_id;
    } catch {
      const sent = await ctx.reply(buildPendingInterestsMessage([]), {
        parse_mode: "HTML",
        reply_markup: confirmInterestsKeyboard,
      });
      pending.messageId = sent.message_id;
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("int_delete_mode", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const settings = loadSettings(userId);
    if (settings.interests.length === 0) {
      await ctx.answerCallbackQuery({ text: "Нечего удалять." });
      return;
    }

    try {
      await ctx.editMessageText(
        "<b>🗑 Удаление тегов</b>\n\nНажмите на тег, чтобы удалить его:",
        { parse_mode: "HTML", reply_markup: buildInterestsDeleteKeyboard(userId) },
      );
    } catch (e) {
      logError("Failed to enter tag delete mode", e);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^int_del:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const idx = parseInt(ctx.match[1], 10);
    const settings = loadSettings(userId);
    const deleted = settings.interests[idx];

    if (deleted) removeInterest(userId, deleted);

    const updatedSettings = loadSettings(userId);

    if (updatedSettings.interests.length === 0) {
      try {
        await ctx.editMessageText(buildInterestsMessage(userId), {
          parse_mode: "HTML",
          reply_markup: interestsMainKeyboard(userId),
        });
      } catch (e) { logError("Failed to update interests view", e); }
    } else {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: buildInterestsDeleteKeyboard(userId) });
      } catch (e) { logError("Failed to update tags keyboard", e); }
    }

    await ctx.answerCallbackQuery({ text: `Удалён: ${deleted || ""}` });
  });

  bot.callbackQuery("int_back", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      ensureUser(userId);
      pendingInterestAdds.delete(userId);
    }

    try {
      await ctx.editMessageText(buildInterestsMessage(userId || 0), {
        parse_mode: "HTML",
        reply_markup: interestsMainKeyboard(userId || 0),
      });
    } catch (e) { logError("Failed to return to interests menu", e); }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("int_confirm", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const pending = pendingInterestAdds.get(userId);
    if (!pending || pending.tags.length === 0) {
      await ctx.answerCallbackQuery({ text: "Нечего добавлять." });
      return;
    }

    const addedCount = addInterests(userId, pending.tags);
    pendingInterestAdds.delete(userId);

    try {
      await ctx.editMessageText(buildInterestsMessage(userId), {
        parse_mode: "HTML",
        reply_markup: interestsMainKeyboard(userId),
      });
    } catch (e) { logError("Failed to save tags", e); }

    await ctx.answerCallbackQuery({ text: `✅ Добавлено: ${addedCount}` });
  });

  bot.callbackQuery("schedule_edit", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    ensureUser(userId);

    const msgText =
      "<b>✏ Введите время рассылки</b>\n\nУкажите часы рассылки от 0 до 23 через запятую или пробел:\nНапример: <code>9, 21</code> или <code>8, 14, 20</code>";
    const kb = new InlineKeyboard().text("← Назад", "schedule_back");

    try {
      await ctx.editMessageText(msgText, { parse_mode: "HTML", reply_markup: kb });
      userWaitingMap.set(userId, { mode: "schedule", messageId: ctx.msg!.message_id });
    } catch (e) {
      logError("Failed to enter schedule edit", e);
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("schedule_back", async (ctx) => {
    const userId = ctx.from?.id;
    if (userId) {
      ensureUser(userId);
      userWaitingMap.delete(userId);
    }

    try {
      await ctx.editMessageText(buildScheduleMessage(userId || 0), {
        parse_mode: "HTML",
        reply_markup: buildScheduleKeyboard(),
      });
    } catch (e) {
      logError("Failed to return to schedule menu", e);
    }
    await ctx.answerCallbackQuery();
  });
}
