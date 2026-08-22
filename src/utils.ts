import { Bot } from "grammy";

export function markdownToTelegramHtml(text: string): string {
  let result = text;

  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");

  result = result.replace(/^\s*[-*]\s+/gm, "• ");

  return result;
}

export function sanitizeHtmlForTelegram(html: string): string {
  let clean = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/\n{3,}/g, "\n\n");

  clean = clean.replace(/<[^>]*$/, "");

  for (const tag of ["b", "i", "code"]) {
    const open = (clean.match(new RegExp(`<${tag}[^>]*>`, "gi")) || []).length;
    const close = (clean.match(new RegExp(`</${tag}>`, "gi")) || []).length;
    let missing = open - close;
    while (missing-- > 0) clean += `</${tag}>`;
  }

  return clean;
}

export async function sendLongHtmlMessage(bot: Bot, chatId: number | string, text: string) {
  const cleanText = sanitizeHtmlForTelegram(text);
  const opts = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

  if (cleanText.length <= 4000) {
    await bot.api.sendMessage(chatId, cleanText, opts);
    return;
  }

  const paragraphs = cleanText.split("\n");
  let chunk = "";

  for (const p of paragraphs) {
    if ((chunk + "\n" + p).length > 4000) {
      await bot.api.sendMessage(chatId, chunk, opts);
      chunk = p;
    } else {
      chunk = chunk ? `${chunk}\n${p}` : p;
    }
  }
  if (chunk) await bot.api.sendMessage(chatId, chunk, opts);
}

export async function editOrSendLongHtml(
  bot: Bot,
  chatId: number | string,
  editMessageId: number | null,
  text: string,
) {
  const cleanText = sanitizeHtmlForTelegram(text);
  const opts = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };

  if (editMessageId && cleanText.length <= 4000) {
    try {
      await bot.api.editMessageText(chatId, editMessageId, cleanText, opts);
      return;
    } catch {}
  }

  if (editMessageId) {
    try { await bot.api.deleteMessage(chatId, editMessageId); } catch {}
  }

  await sendLongHtmlMessage(bot, chatId, cleanText);
}
