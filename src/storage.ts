import * as fs from "fs";
import { db } from "./db";
import { CONFIG } from "./config";
import { logError } from "./logger";
import { Sources, UserSettings, RunLog, Prompts } from "./types";

export function ensureUser(userId: number) {
  try {
    const exists = db.query("SELECT id FROM users WHERE id = ?").get(userId);
    if (!exists) {
      db.run("INSERT OR IGNORE INTO users (id) VALUES (?)", [userId]);
      db.run("INSERT OR IGNORE INTO schedules (user_id, hour) VALUES (?, 9)", [userId]);
      db.run("INSERT OR IGNORE INTO schedules (user_id, hour) VALUES (?, 21)", [userId]);
    }
  } catch (e) {
    logError(`ensureUser(${userId})`, e);
  }
}

export function loadSources(userId: number): Sources {
  ensureUser(userId);
  try {
    const rows = db.query<{ type: string; value: string }, [number]>(
      "SELECT type, value FROM sources WHERE user_id = ? ORDER BY id ASC",
    ).all(userId);

    const rss: string[] = [];
    const telegram: string[] = [];

    for (const r of rows) {
      if (r.type === "rss") rss.push(r.value);
      else if (r.type === "telegram") telegram.push(r.value);
    }

    return { rss, telegram };
  } catch (e) {
    logError(`loadSources(${userId})`, e);
    return { rss: [], telegram: [] };
  }
}

export function addSources(
  userId: number,
  rss: string[],
  telegram: string[],
): { addedRss: number; addedTg: number } {
  ensureUser(userId);
  let addedRss = 0;
  let addedTg = 0;

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO sources (user_id, type, value) VALUES (?, ?, ?)",
  );

  const tx = db.transaction(() => {
    for (const r of rss) {
      const res = insertStmt.run(userId, "rss", r);
      if (res.changes > 0) addedRss++;
    }
    for (const t of telegram) {
      const res = insertStmt.run(userId, "telegram", t);
      if (res.changes > 0) addedTg++;
    }
  });

  try {
    tx();
  } catch (e) {
    logError(`addSources(${userId})`, e);
  }

  return { addedRss, addedTg };
}

export function removeRssSource(userId: number, url: string) {
  try {
    db.run("DELETE FROM sources WHERE user_id = ? AND type = 'rss' AND value = ?", [userId, url]);
  } catch (e) {
    logError(`removeRssSource(${userId})`, e);
  }
}

export function removeTelegramSource(userId: number, channel: string) {
  try {
    db.run("DELETE FROM sources WHERE user_id = ? AND type = 'telegram' AND value = ?", [userId, channel]);
  } catch (e) {
    logError(`removeTelegramSource(${userId})`, e);
  }
}

export function loadSettings(userId: number): UserSettings {
  ensureUser(userId);
  try {
    const interestRows = db.query<{ tag: string }, [number]>(
      "SELECT tag FROM interests WHERE user_id = ? ORDER BY id ASC",
    ).all(userId);

    const scheduleRows = db.query<{ hour: number }, [number]>(
      "SELECT hour FROM schedules WHERE user_id = ? ORDER BY hour ASC",
    ).all(userId);

    const interests = interestRows.map((r) => r.tag);
    const schedule_hours = scheduleRows.map((r) => r.hour);

    return {
      interests,
      schedule_hours: schedule_hours.length > 0 ? schedule_hours : [9, 21],
    };
  } catch (e) {
    logError(`loadSettings(${userId})`, e);
    return { interests: [], schedule_hours: [9, 21] };
  }
}

export function addInterests(userId: number, tags: string[]): number {
  ensureUser(userId);
  let added = 0;
  const insertStmt = db.prepare("INSERT OR IGNORE INTO interests (user_id, tag) VALUES (?, ?)");

  const tx = db.transaction(() => {
    for (const tag of tags) {
      const res = insertStmt.run(userId, tag.trim());
      if (res.changes > 0) added++;
    }
  });

  try {
    tx();
  } catch (e) {
    logError(`addInterests(${userId})`, e);
  }

  return added;
}

export function removeInterest(userId: number, tag: string) {
  try {
    db.run("DELETE FROM interests WHERE user_id = ? AND tag = ?", [userId, tag]);
  } catch (e) {
    logError(`removeInterest(${userId})`, e);
  }
}

export function clearInterests(userId: number) {
  try {
    db.run("DELETE FROM interests WHERE user_id = ?", [userId]);
  } catch (e) {
    logError(`clearInterests(${userId})`, e);
  }
}

export function saveSchedule(userId: number, hours: number[]) {
  ensureUser(userId);
  const insertStmt = db.prepare("INSERT OR IGNORE INTO schedules (user_id, hour) VALUES (?, ?)");

  const tx = db.transaction(() => {
    db.run("DELETE FROM schedules WHERE user_id = ?", [userId]);
    for (const h of hours) {
      if (h >= 0 && h <= 23) {
        insertStmt.run(userId, h);
      }
    }
  });

  try {
    tx();
  } catch (e) {
    logError(`saveSchedule(${userId})`, e);
  }
}

export function getUsersForScheduleHour(hour: number): number[] {
  try {
    const rows = db.query<{ user_id: number }, [number]>(
      "SELECT DISTINCT user_id FROM schedules WHERE hour = ?",
    ).all(hour);
    return rows.map((r) => r.user_id);
  } catch (e) {
    logError(`getUsersForScheduleHour(${hour})`, e);
    return [];
  }
}

export function loadAnalytics(userId: number): RunLog[] {
  ensureUser(userId);
  try {
    const rows = db.query<any, [number]>(
      "SELECT * FROM analytics WHERE user_id = ? ORDER BY rowid DESC LIMIT 50",
    ).all(userId);

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      type: r.type as "main" | "latest",
      rssCount: r.rss_count,
      tgCount: r.tg_count,
      rawChars: r.raw_chars,
      model: r.model,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
      factsExtracted: r.facts_extracted,
      postsProcessed: r.posts_processed,
    }));
  } catch (e) {
    logError(`loadAnalytics(${userId})`, e);
    return [];
  }
}

export function loadUsersSummary(): import("./types").UserSummary[] {
  try {
    const rows = db.query<any, []>(`
      SELECT 
        u.id as user_id,
        u.created_at,
        COUNT(a.id) as total_digests,
        COALESCE(SUM(a.total_tokens), 0) as total_tokens,
        (
          SELECT a2.timestamp 
          FROM analytics a2 
          WHERE a2.user_id = u.id 
          ORDER BY a2.rowid DESC 
          LIMIT 1
        ) as last_generated_at,
        (SELECT COUNT(*) FROM sources WHERE user_id = u.id) as sources_count
      FROM users u
      LEFT JOIN analytics a ON u.id = a.user_id
      GROUP BY u.id
      ORDER BY total_digests DESC, u.created_at DESC;
    `).all();

    return rows.map((r) => ({
      userId: r.user_id,
      createdAt: r.created_at,
      totalDigests: r.total_digests,
      totalTokens: r.total_tokens,
      lastGeneratedAt: r.last_generated_at,
      sourcesCount: r.sources_count,
    }));
  } catch (e) {
    logError("loadUsersSummary", e);
    return [];
  }
}

export function saveAnalyticsLog(userId: number, entry: RunLog) {
  ensureUser(userId);
  try {
    db.run(
      `
      INSERT OR REPLACE INTO analytics (
        id, user_id, timestamp, type, rss_count, tg_count, raw_chars,
        model, prompt_tokens, completion_tokens, total_tokens, facts_extracted, posts_processed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        entry.id,
        userId,
        entry.timestamp,
        entry.type,
        entry.rssCount,
        entry.tgCount,
        entry.rawChars,
        entry.model,
        entry.promptTokens,
        entry.completionTokens,
        entry.totalTokens,
        entry.factsExtracted,
        entry.postsProcessed,
      ],
    );
  } catch (e) {
    logError(`saveAnalyticsLog(${userId})`, e);
  }
}

let cachedPrompts: Prompts | null = null;

export function loadPrompts(): Prompts {
  if (cachedPrompts) return cachedPrompts;

  try {
    if (fs.existsSync(CONFIG.PROMPTS_PATH)) {
      const data = fs.readFileSync(CONFIG.PROMPTS_PATH, "utf-8").trim();
      if (data) {
        cachedPrompts = JSON.parse(data);
        return cachedPrompts!;
      }
    }
  } catch (e) {
    logError("Failed to read prompts.json", e);
  }

  cachedPrompts = {
    extraction_system: "Ты — первичный фильтр новостей. Извлеки факты в JSON.",
    system: "Ты — главный редактор новостей. Сформируй дайджест.",
    user_prefix: "Вот новости:\n\n",
  };
  return cachedPrompts;
}
