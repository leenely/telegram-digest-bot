import * as fs from "fs";
import * as path from "path";
import { CONFIG } from "./config";

function timestamp(): string {
  return new Date().toLocaleTimeString("ru-RU", { timeZone: CONFIG.TIMEZONE });
}

export function log(message: string, scope?: string) {
  const prefix = scope ? `${scope}: ` : "";
  console.log(`[${timestamp()}] ${prefix}${message}`);
}

export function logDebug(message: string, scope?: string) {
  if (!CONFIG.DEBUG_LOGGING) return;
  const prefix = scope ? `${scope}: ` : "";
  console.log(`[${timestamp()}] [DEBUG] ${prefix}${message}`);
}

export function logError(message: string, error?: unknown) {
  console.error(`[${timestamp()}] ERROR ${message}`, error ?? "");
}

export function dumpToFile(filename: string, content: string) {
  if (!CONFIG.DEBUG_LOGGING) return;
  try {
    if (!fs.existsSync(CONFIG.LOGS_PATH)) {
      fs.mkdirSync(CONFIG.LOGS_PATH, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filepath = path.join(CONFIG.LOGS_PATH, `${ts}_${filename}.txt`);
    fs.writeFileSync(filepath, content, "utf-8");
    logDebug(`Dumped to ${filepath}`, "debug");
  } catch (e) {
    logError("Failed to dump file", e);
  }
}
