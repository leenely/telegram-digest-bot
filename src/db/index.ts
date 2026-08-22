import { Database } from "bun:sqlite";
import { CONFIG } from "../config";
import { log } from "../logger";

export const db = new Database(CONFIG.DB_PATH, { create: true });

export function initDatabase() {
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, type, value)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS interests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, tag)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      hour INTEGER NOT NULL,
      UNIQUE(user_id, hour)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      rss_count INTEGER,
      tg_count INTEGER,
      raw_chars INTEGER,
      model TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      facts_extracted INTEGER,
      posts_processed INTEGER
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_value TEXT NOT NULL,
      link TEXT NOT NULL,
      text TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      fetched_at INTEGER NOT NULL,
      UNIQUE(source_type, source_value, link)
    );
  `);

  log("Database initialized", "db");
}
