import { Bot } from "grammy";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { CONFIG } from "./src/config";
import { log, logError } from "./src/logger";
import { initDatabase } from "./src/db";
import { setupCronSchedule } from "./src/services/cron";
import { registerCommands } from "./src/handlers/commands";
import { registerCallbacks } from "./src/handlers/callbacks";
import { registerMessageHandlers } from "./src/handlers/messages";

initDatabase();

function isBotConfigured(): boolean {
  return Boolean(
    CONFIG.OWNER_ID &&
    process.env.TG_STRING_SESSION &&
    process.env.TG_API_ID &&
    process.env.TG_API_HASH &&
    process.env.AI_API_KEY
  );
}

const tgClient: TelegramClient | null =
  process.env.TG_API_ID && process.env.TG_API_HASH
    ? new TelegramClient(
        new StringSession(process.env.TG_STRING_SESSION || ""),
        Number(process.env.TG_API_ID),
        process.env.TG_API_HASH,
        { connectionRetries: 5 },
      )
    : null;

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

bot.catch((err) => logError("Unhandled bot error", err.error));

bot.use(async (ctx, next) => {
  if (!isBotConfigured()) {
    const text = ctx.msg?.text?.trim();
    if (text === "/start") return next();

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Бот ещё не настроен. Отправьте /start для инструкции.",
        show_alert: true,
      });
    } else if (ctx.message) {
      await ctx.reply("⚠️ Бот находится в режиме первоначальной настройки.\n\nОтправьте команду /start, чтобы получить ваш Chat ID и инструкцию.");
    }
    return;
  }

  if (CONFIG.ALLOW_ONLY_OWNER && CONFIG.OWNER_ID) {
    const userId = ctx.from?.id;
    if (userId !== CONFIG.OWNER_ID) {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: "⛔ Бот находится в приватном режиме. Доступ есть только у владельца.",
          show_alert: true,
        });
      } else if (ctx.message) {
        await ctx.reply("⛔ Бот находится в приватном режиме. Доступ есть только у владельца.");
      }
      return;
    }
  }

  await next();
});

registerCommands(bot, tgClient);
registerCallbacks(bot, tgClient);
registerMessageHandlers(bot, tgClient);

async function start() {
  const configured = isBotConfigured();

  if (configured && tgClient) {
    try {
      await tgClient.connect();
      log("Telegram client connected", "init");
    } catch (e) {
      logError("Telegram client connection failed", e);
    }
  } else {
    log("Setup mode — send /start to the bot", "init");
  }

  if (configured) {
    if (CONFIG.ALLOW_ONLY_OWNER && CONFIG.OWNER_ID) {
      log(`Private mode, owner: ${CONFIG.OWNER_ID}`, "init");
    } else {
      log("Public mode", "init");
    }

    await bot.api.setMyCommands([
      { command: "digest", description: "Полный дайджест" },
      { command: "latest", description: "Последние новости (1ч)" },
      { command: "sources", description: "Источники (добавление/удаление)" },
      { command: "interests", description: "Настройка интересов (теги)" },
      { command: "schedule", description: "Время рассылки" },
      { command: "analytics", description: "Статистика" },
    ]);

    setupCronSchedule(bot, tgClient);
  } else {
    await bot.api.setMyCommands([
      { command: "start", description: "Инструкция по настройке и Chat ID" },
    ]);
  }

  bot.start();
  log("Bot started", "init");
}

start();
