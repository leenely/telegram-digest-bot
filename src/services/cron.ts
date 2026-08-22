import cron from "node-cron";
import { Bot } from "grammy";
import { TelegramClient } from "telegram";
import { CONFIG } from "../config";
import { log, logError } from "../logger";
import { loadSources, getUsersForScheduleHour } from "../storage";
import { fetchRssNews, fetchTelegramNews } from "./fetcher";
import { generateDigest } from "./llm";
import { editOrSendLongHtml, sendLongHtmlMessage } from "../utils";

let pregenCronTask: cron.ScheduledTask | null = null;
let deliveryCronTask: cron.ScheduledTask | null = null;

const preparedDigests = new Map<number, string>();

export async function collectAndGenerate(
  tgClient: TelegramClient,
  userId: number,
  hoursWindow: number,
  type: "main" | "latest",
): Promise<string> {
  const sources = loadSources(userId);

  if (sources.rss.length === 0 && sources.telegram.length === 0) {
    return "У вас пока не добавлено ни одного источника. Добавьте каналы или RSS через /sources.";
  }

  const [rssRes, tgRes] = await Promise.all([
    fetchRssNews(sources.rss, hoursWindow),
    fetchTelegramNews(tgClient, sources.telegram, hoursWindow),
  ]);

  const allNews = [...rssRes.news, ...tgRes.news];
  const allLogs = [...rssRes.logs, ...tgRes.logs];

  log(
    `Collected ${allNews.length} posts (RSS: ${rssRes.count}, TG: ${tgRes.count})`,
    `digest:${userId}`,
  );

  return generateDigest(
    userId,
    allNews,
    allLogs,
    rssRes.count,
    tgRes.count,
    type,
  );
}

export async function runDigest(
  bot: Bot,
  tgClient: TelegramClient,
  userId: number,
  hoursWindow: number,
  type: "main" | "latest",
  placeholderMessageId: number | null = null,
) {
  log(`${type} digest started`, `digest:${userId}`);

  const digest = await collectAndGenerate(tgClient, userId, hoursWindow, type);
  const nowStr = new Date().toLocaleString("ru-RU", {
    timeZone: CONFIG.TIMEZONE,
  });
  const header =
    type === "main"
      ? `⚡ <b>Дайджест (${nowStr}):</b>\n\n`
      : `⚡ <b>Дайджест за последний час (${nowStr}):</b>\n\n`;

  await editOrSendLongHtml(bot, userId, placeholderMessageId, header + digest);
  log(`${type} digest done`, `digest:${userId}`);
}

export function setupCronSchedule(bot: Bot, tgClient: TelegramClient) {
  if (pregenCronTask) {
    pregenCronTask.stop();
    pregenCronTask = null;
  }
  if (deliveryCronTask) {
    deliveryCronTask.stop();
    deliveryCronTask = null;
  }

  log(
    `Cron scheduler started (pregen at XX:55, delivery at XX:00, tz: ${CONFIG.TIMEZONE})`,
    "cron",
  );

  pregenCronTask = cron.schedule(
    "55 * * * *",
    async () => {
      try {
        const now = new Date();
        const hourFormatter = new Intl.DateTimeFormat("en-US", {
          timeZone: CONFIG.TIMEZONE,
          hour: "numeric",
          hourCycle: "h23",
        });
        const currentHour = Number(hourFormatter.format(now));
        const targetHour = (currentHour + 1) % 24;

        let userIds = getUsersForScheduleHour(targetHour);
        if (CONFIG.ALLOW_ONLY_OWNER && CONFIG.OWNER_ID) {
          userIds = userIds.filter((id) => id === CONFIG.OWNER_ID);
        }

        if (userIds.length === 0) {
          log(`No users scheduled for ${targetHour}:00`, "cron");
          return;
        }

        log(
          `Pre-generating for ${userIds.length} users (target: ${targetHour}:00)`,
          "cron",
        );

        const limit = CONFIG.CONCURRENT_DIGESTS_LIMIT || 3;
        for (let i = 0; i < userIds.length; i += limit) {
          const batch = userIds.slice(i, i + limit);
          await Promise.all(
            batch.map(async (uid) => {
              try {
                const digest = await collectAndGenerate(
                  tgClient,
                  uid,
                  CONFIG.MAIN_HOURS_WINDOW,
                  "main",
                );
                preparedDigests.set(uid, digest);
              } catch (e) {
                logError(`Pre-generation failed for user ${uid}`, e);
              }
            }),
          );
        }

        log(
          `Pre-generation done (${preparedDigests.size} ready for ${targetHour}:00)`,
          "cron",
        );
      } catch (e) {
        logError("Pre-generation cron failed", e);
      }
    },
    { timezone: CONFIG.TIMEZONE },
  );

  deliveryCronTask = cron.schedule(
    "0 * * * *",
    async () => {
      if (preparedDigests.size === 0) return;

      log(`Delivering ${preparedDigests.size} digests`, "cron");
      const nowStr = new Date().toLocaleString("ru-RU", {
        timeZone: CONFIG.TIMEZONE,
      });
      const header = `⚡ <b>Дайджест (${nowStr}):</b>\n\n`;

      const entries = Array.from(preparedDigests.entries());
      preparedDigests.clear();

      for (const [uid, digest] of entries) {
        try {
          await sendLongHtmlMessage(bot, uid, header + digest);
          log(`Delivered to user ${uid}`, "cron");
        } catch (e) {
          logError(`Delivery failed for user ${uid}`, e);
        }
      }
    },
    { timezone: CONFIG.TIMEZONE },
  );
}
