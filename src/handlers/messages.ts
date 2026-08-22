import { Bot } from "grammy";
import { TelegramClient } from "telegram";
import { resolveSourceInput } from "../services/fetcher";
import { ensureUser, saveSchedule } from "../storage";
import { pendingAdds, userWaitingMap, pendingInterestAdds } from "./state";
import {
  buildPendingMessage,
  confirmKeyboard,
  buildPendingInterestsMessage,
  confirmInterestsKeyboard,
  buildScheduleMessage,
  buildScheduleKeyboard,
} from "./ui";

export function registerMessageHandlers(bot: Bot, tgClient: TelegramClient | null) {
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from?.id;
    const text = ctx.msg?.text?.trim();
    if (!userId || !text) return next();
    if (text.startsWith("/")) return next();

    ensureUser(userId);

    const pendingSource = pendingAdds.get(userId);
    if (pendingSource) {
      const rawItems = text.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
      let added = 0;

      for (const item of rawItems) {
        const parsed = await resolveSourceInput(item);
        if (!parsed) continue;
        if (parsed.type === "rss" && !pendingSource.rss.includes(parsed.value)) {
          pendingSource.rss.push(parsed.value);
          added++;
        } else if (parsed.type === "telegram" && !pendingSource.telegram.includes(parsed.value)) {
          pendingSource.telegram.push(parsed.value);
          added++;
        }
      }

      if (added === 0) {
        await ctx.reply("⚠️ Не удалось распознать источники или они уже в списке.");
        return;
      }

      if (pendingSource.messageId) {
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            pendingSource.messageId,
            buildPendingMessage(pendingSource),
            { parse_mode: "HTML", reply_markup: confirmKeyboard },
          );
        } catch {
          const sent = await ctx.reply(buildPendingMessage(pendingSource), {
            parse_mode: "HTML",
            reply_markup: confirmKeyboard,
          });
          pendingSource.messageId = sent.message_id;
        }
      }

      try { await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id); } catch {}
      return;
    }

    const pendingInterest = pendingInterestAdds.get(userId);
    if (pendingInterest) {
      const newTags = text.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
      let added = 0;

      for (const tag of newTags) {
        const normalized = tag.toLowerCase();
        if (!pendingInterest.tags.some((t) => t.toLowerCase() === normalized)) {
          pendingInterest.tags.push(tag);
          added++;
        }
      }

      if (added === 0) {
        await ctx.reply("⚠️ Теги уже в списке или не распознаны.");
        return;
      }

      if (pendingInterest.messageId) {
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            pendingInterest.messageId,
            buildPendingInterestsMessage(pendingInterest.tags),
            { parse_mode: "HTML", reply_markup: confirmInterestsKeyboard },
          );
        } catch {
          const sent = await ctx.reply(buildPendingInterestsMessage(pendingInterest.tags), {
            parse_mode: "HTML",
            reply_markup: confirmInterestsKeyboard,
          });
          pendingInterest.messageId = sent.message_id;
        }
      }

      try { await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id); } catch {}
      return;
    }

    const userWaiting = userWaitingMap.get(userId);
    if (userWaiting && userWaiting.mode === "schedule") {
      const nums = text
        .split(/[\n,\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n >= 0 && n <= 23);

      if (nums.length === 0) {
        await ctx.reply("⚠️ Укажите корректные часы от 0 до 23 (например: 9, 21)");
        return;
      }

      saveSchedule(userId, [...new Set(nums)].sort((a, b) => a - b));
      userWaitingMap.delete(userId);

      if (userWaiting.messageId) {
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            userWaiting.messageId,
            buildScheduleMessage(userId),
            { parse_mode: "HTML", reply_markup: buildScheduleKeyboard() },
          );
        } catch {}
      }
      try { await ctx.api.deleteMessage(ctx.chat.id, ctx.msg.message_id); } catch {}
      return;
    }

    return next();
  });
}
