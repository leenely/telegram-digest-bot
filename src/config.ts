import * as path from "path";

const root = path.resolve(__dirname, "..");

export const CONFIG = {
  OWNER_ID: Number(process.env.YOUR_CHAT_ID),
  ALLOW_ONLY_OWNER: process.env.ALLOW_ONLY_OWNER === "true",
  DEBUG_LOGGING: process.env.DEBUG_LOGGING === "true",
  TIMEZONE: process.env.TIMEZONE!,

  MAIN_HOURS_WINDOW: Number(process.env.MAIN_HOURS_WINDOW),
  LATEST_HOURS_WINDOW: Number(process.env.LATEST_HOURS_WINDOW),

  MAX_TG_MESSAGES_PER_CHANNEL: Number(process.env.MAX_TG_MESSAGES_PER_CHANNEL),
  MAX_POST_CHARS: Number(process.env.MAX_POST_CHARS),
  MAX_EXTRACTION_TOKENS: Number(process.env.MAX_EXTRACTION_TOKENS),
  MAX_EDITORIAL_TOKENS: Number(process.env.MAX_EDITORIAL_TOKENS),
  EXTRACTION_CHUNK_SIZE: Number(process.env.EXTRACTION_CHUNK_SIZE),

  ANALYTICS_DISPLAY_LIMIT: Number(process.env.ANALYTICS_DISPLAY_LIMIT),
  CONCURRENT_DIGESTS_LIMIT: Number(process.env.CONCURRENT_DIGESTS_LIMIT),

  DB_PATH: path.resolve(root, process.env.DB_PATH!),
  PROMPTS_PATH: path.resolve(root, process.env.PROMPTS_PATH!),
  LOGS_PATH: path.resolve(root, process.env.LOGS_PATH || "logs"),
};
