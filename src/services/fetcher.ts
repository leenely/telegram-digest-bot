import Parser from "rss-parser";
import { TelegramClient } from "telegram";
import { CONFIG } from "../config";
import { logError } from "../logger";
import { NewsItem } from "../types";

const parser = new Parser();

export async function resolveSourceInput(
  input: string,
): Promise<{ type: "rss" | "telegram"; value: string } | null> {
  let str = input.trim();
  if (!str) return null;

  if (str.includes("youtube.com") || str.includes("youtu.be")) {
    if (str.includes("youtube.com/feeds/videos.xml")) {
      return { type: "rss", value: str };
    }
    try {
      const res = await fetch(str, { headers: { "User-Agent": "Mozilla/5.0" } });
      const html = await res.text();
      const match =
        html.match(/channel_id=([a-zA-Z0-9_-]+)/) ||
        html.match(/"channelId":"([a-zA-Z0-9_-]+)"/);
      if (match?.[1]) {
        return { type: "rss", value: `https://www.youtube.com/feeds/videos.xml?channel_id=${match[1]}` };
      }
    } catch (e) {
      logError(`YouTube channel resolve failed: ${str}`, e);
    }
  }

  if (str.includes("t.me/")) {
    let clean = str.replace(/^https?:\/\//i, "").replace(/^t\.me\//i, "");
    if (clean.startsWith("s/")) clean = clean.replace(/^s\//, "");
    clean = clean.split("/")[0].replace("@", "").trim();
    if (clean) return { type: "telegram", value: clean };
  }

  if (str.startsWith("http://") || str.startsWith("https://")) {
    return { type: "rss", value: str };
  }

  const cleanTg = str.replace("@", "").trim();
  if (cleanTg) return { type: "telegram", value: cleanTg };

  return null;
}

export async function fetchRssNews(
  rssUrls: string[],
  hoursWindow: number,
): Promise<{ news: NewsItem[]; logs: string[]; count: number }> {
  const news: NewsItem[] = [];
  const logs: string[] = [];
  let totalCount = 0;
  const timeThreshold = Date.now() - hoursWindow * 60 * 60 * 1000;

  for (const url of rssUrls) {
    try {
      let feed: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          feed = await parser.parseURL(url);
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
      if (!feed) continue;

      const sourceName = feed.title?.trim() || url;
      let count = 0;

      feed.items.forEach((item: any) => {
        const rawDate = item.isoDate || item.pubDate || item.date;
        const pubDate = rawDate ? new Date(rawDate).getTime() : 0;
        if (!isNaN(pubDate) && pubDate > timeThreshold && item.title) {
          const snippet = (item.contentSnippet || "").replace(/\s+/g, " ").trim();
          news.push({
            source: sourceName,
            link: item.link || url,
            text: snippet ? `${item.title}: ${snippet}` : item.title,
            isRss: true,
          });
          count++;
        }
      });

      totalCount += count;
      logs.push(`RSS "${sourceName}": ${count}`);
    } catch (e) {
      logError(`RSS fetch failed: ${url}`, e);
    }
  }
  return { news, logs, count: totalCount };
}

export async function fetchTelegramNews(
  tgClient: TelegramClient | null,
  channels: string[],
  hoursWindow: number,
): Promise<{ news: NewsItem[]; logs: string[]; count: number }> {
  if (channels.length === 0) return { news: [], logs: [], count: 0 };

  if (!tgClient || !process.env.TG_STRING_SESSION) {
    return { news: [], logs: ["TG: session not configured"], count: 0 };
  }

  const news: NewsItem[] = [];
  const logs: string[] = [];
  let totalCount = 0;
  const threshold = Math.floor((Date.now() - hoursWindow * 60 * 60 * 1000) / 1000);

  for (let attempt = 1; !tgClient.connected && attempt <= 3; attempt++) {
    try {
      await tgClient.connect();
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  for (const channel of channels) {
    const ch = channel.replace("@", "").trim();
    try {
      let messages: any[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          messages = await tgClient.getMessages(ch, { limit: CONFIG.MAX_TG_MESSAGES_PER_CHANNEL });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }

      let count = 0;
      for (const msg of messages) {
        if (msg.date > threshold && msg.message) {
          const text = msg.message.slice(0, CONFIG.MAX_POST_CHARS).replace(/\s+/g, " ").trim();
          if (text.length < 20) continue;
          news.push({
            source: `@${ch}`,
            link: msg.id ? `https://t.me/${ch}/${msg.id}` : "",
            text,
            isRss: false,
          });
          count++;
        }
      }

      totalCount += count;
      logs.push(`TG @${ch}: ${count}`);
    } catch (e) {
      logError(`TG fetch failed: @${ch}`, e);
    }
  }
  return { news, logs, count: totalCount };
}
