import OpenAI from "openai";
import { CONFIG } from "../config";
import { log, logDebug, logError, dumpToFile } from "../logger";
import { loadPrompts, loadSettings, saveAnalyticsLog } from "../storage";
import { sanitizeHtmlForTelegram, markdownToTelegramHtml } from "../utils";
import { DigestBlock, ExtractedFact, NewsItem } from "../types";

const openai = new OpenAI({
  apiKey: process.env.AI_API_KEY,
  baseURL: process.env.AI_BASE_URL || "https://api.openai.com/v1",
});

function formatNewsItemsForLLM(items: NewsItem[]): string {
  return items
    .map((item) => `[source: ${item.source}] [link: ${item.link}]\n${item.text}`)
    .join("\n---\n");
}

function formatFactsForLLM(facts: ExtractedFact[]): string {
  return facts
    .map((f) => `[source: ${f.source_name}] [link: ${f.source_link}]\n${f.text}`)
    .join("\n---\n");
}

function formatDigestBlocks(blocks: DigestBlock[]): string {
  const grouped = new Map<string, DigestBlock[]>();
  for (const b of blocks) {
    if (!grouped.has(b.category)) grouped.set(b.category, []);
    grouped.get(b.category)!.push(b);
  }

  const parts: string[] = [];
  for (const [category, items] of grouped) {
    let section = `<b>${category}</b>\n`;
    for (const item of items) {
      const body = item.body?.trim();
      if (!body) continue;
      let entry = `• ${body}`;
      if (item.source_link) {
        entry += `\n  <a href="${item.source_link}">${item.source_name || "Источник"}</a>`;
      } else if (item.source_name) {
        entry += `\n  ${item.source_name}`;
      }
      section += `\n${entry}\n`;
    }
    parts.push(section);
  }
  return parts.join("\n");
}

function parseLlmJson<T>(raw: string): T | null {
  try {
    let cleaned = raw.trim();
    const m = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) cleaned = m[1].trim();
    return JSON.parse(cleaned);
  } catch (e) {
    logError("Failed to parse LLM JSON response", e);
  }
  return null;
}

function normalizeFact(item: any): ExtractedFact | null {
  const text = item.text || item.summary || item.content || item.body;
  const source_name = item.source_name || item.source || "";
  const source_link = item.source_link || item.link || item.url || "";
  if (!text) return null;
  return { text, source_name, source_link };
}

function parseExtractedFacts(raw: string): ExtractedFact[] {
  const parsed = parseLlmJson<any>(raw);
  if (!parsed) return [];

  let items: any[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed.facts && Array.isArray(parsed.facts)) {
    items = parsed.facts;
  } else {
    return [];
  }

  return items.map(normalizeFact).filter((f): f is ExtractedFact => f !== null);
}

function normalizeBlock(item: any): DigestBlock | null {
  const body = item.body || item.text || item.content || item.summary;
  const category = item.category || item.topic || "📰 Другое";
  const source_name = item.source_name || item.source || "";
  const source_link = item.source_link || item.link || item.url || "";
  if (!body) return null;
  return { category, body, source_name, source_link };
}

function parseDigestBlocks(raw: string): DigestBlock[] {
  const parsed = parseLlmJson<any>(raw);
  if (!parsed) return [];

  let items: any[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed.blocks && Array.isArray(parsed.blocks)) {
    items = parsed.blocks;
  } else {
    return [];
  }

  return items.map(normalizeBlock).filter((b): b is DigestBlock => b !== null);
}

async function extractFactsFromChunk(
  items: NewsItem[],
  modelName: string,
  extractionPrompt: string,
): Promise<{ facts: ExtractedFact[]; promptTokens: number; completionTokens: number }> {
  try {
    const userContent = formatNewsItemsForLLM(items);
    dumpToFile(`extraction_input_${items.length}posts`, userContent);

    const response = await openai.chat.completions.create({
      model: modelName,
      max_tokens: CONFIG.MAX_EXTRACTION_TOKENS,
      messages: [
        { role: "system", content: extractionPrompt },
        { role: "user", content: userContent },
      ],
    });
    const rawOutput = response.choices[0].message?.content || "";
    const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0 };

    dumpToFile(`extraction_output_${items.length}posts`, rawOutput);
    logDebug(`Extraction raw (first 200 chars): ${rawOutput.substring(0, 200)}`, "llm");

    const parsed = parseLlmJson<{ facts: ExtractedFact[] }>(rawOutput);
    if (parsed?.facts && Array.isArray(parsed.facts)) {
      logDebug(`Extraction parsed: ${parsed.facts.length} facts`, "llm");
      return { facts: parsed.facts, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
    }
  } catch (e) {
    logError("Chunk extraction failed", e);
  }
  return { facts: [], promptTokens: 0, completionTokens: 0 };
}

export async function generateDigest(
  userId: number,
  allNews: NewsItem[],
  sourceDetails: string[],
  rssCount: number,
  tgCount: number,
  type: "main" | "latest",
): Promise<string> {
  const scope = `llm:${userId}`;
  const modelName = process.env.AI_MODEL || "gpt-4o-mini";
  const nowStr = new Date().toLocaleString("ru-RU", { timeZone: CONFIG.TIMEZONE });

  if (allNews.length === 0) {
    saveAnalyticsLog(userId, {
      id: Date.now().toString(),
      timestamp: nowStr,
      type,
      rssCount: 0,
      tgCount: 0,
      rawChars: 0,
      model: modelName,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      factsExtracted: 0,
      postsProcessed: 0,
    });
    return type === "latest"
      ? "За последний час новых событий не обнаружено."
      : "Свежих новостей не найдено.";
  }

  const prompts = loadPrompts();
  const rawChars = allNews.reduce((s, i) => s + i.text.length, 0);

  const rssItems = allNews.filter((i) => i.isRss);
  const tgItems = allNews.filter((i) => !i.isRss);

  const rssFacts: ExtractedFact[] = rssItems.map((i) => ({
    text: `[RSS] ${i.text}`,
    source_name: i.source,
    source_link: i.link,
  }));

  if (rssFacts.length > 0) log(`RSS bypass: ${rssFacts.length} items`, scope);

  let extPrompt = 0, extCompl = 0;
  let extractedFacts: ExtractedFact[] = [];

  if (tgItems.length > 0) {
    log(`Extracting from ${tgItems.length} TG posts`, scope);
    const chunks: NewsItem[][] = [];
    for (let i = 0; i < tgItems.length; i += CONFIG.EXTRACTION_CHUNK_SIZE) {
      chunks.push(tgItems.slice(i, i + CONFIG.EXTRACTION_CHUNK_SIZE));
    }

    const results = await Promise.all(
      chunks.map((chunk) => extractFactsFromChunk(chunk, modelName, prompts.extraction_system)),
    );

    extractedFacts = results.flatMap((r) => r.facts);
    extPrompt = results.reduce((s, r) => s + r.promptTokens, 0);
    extCompl = results.reduce((s, r) => s + r.completionTokens, 0);
    log(`Extracted ${extractedFacts.length} facts (${extPrompt + extCompl} tokens)`, scope);
  }

  const allFacts = [...rssFacts, ...extractedFacts];
  if (allFacts.length === 0) {
    saveAnalyticsLog(userId, {
      id: Date.now().toString(),
      timestamp: nowStr,
      type,
      rssCount,
      tgCount,
      rawChars,
      model: modelName,
      promptTokens: extPrompt,
      completionTokens: extCompl,
      totalTokens: extPrompt + extCompl,
      factsExtracted: 0,
      postsProcessed: allNews.length,
    });
    return type === "latest"
      ? "За последний час значимых событий нет."
      : "Значимых новостей не найдено.";
  }

  const settings = loadSettings(userId);
  let systemPrompt = prompts.system;
  if (settings.interests.length > 0) {
    systemPrompt += `\n\nУМЕРЕННОЕ ПРЕДПОЧТЕНИЕ ТЕМАМ: При отборе, ранжировании и группировке отдавай умеренное предпочтение следующим темам (если они присутствуют во входных фактах): ${settings.interests.join(", ")}. ВАЖНО: НИГДЕ в тексте дайджеста не упоминай эти предпочтения и не пиши «по вашему запросу», «специально для вас» и т.п. Оформляй новости как обычно.`;
  }

  const factsText = formatFactsForLLM(allFacts);
  log(`Editing ${allFacts.length} facts into digest`, scope);
  dumpToFile(`editorial_input_u${userId}`, `${prompts.user_prefix}${factsText}`);
  logDebug(`System prompt length: ${systemPrompt.length} chars`, scope);

  const response = await openai.chat.completions.create({
    model: modelName,
    max_tokens: CONFIG.MAX_EDITORIAL_TOKENS,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${prompts.user_prefix}${factsText}` },
    ],
  });

  const llmOutput = response.choices[0].message?.content || "";
  const edUsage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  dumpToFile(`editorial_output_u${userId}`, llmOutput);
  logDebug(`Editorial raw (first 300 chars): ${llmOutput.substring(0, 300)}`, scope);

  const totalPrompt = extPrompt + edUsage.prompt_tokens;
  const totalCompl = extCompl + edUsage.completion_tokens;
  const totalTokens = totalPrompt + totalCompl;

  saveAnalyticsLog(userId, {
    id: Date.now().toString(),
    timestamp: new Date().toLocaleString("ru-RU", { timeZone: CONFIG.TIMEZONE }),
    type,
    rssCount,
    tgCount,
    rawChars,
    model: modelName,
    promptTokens: totalPrompt,
    completionTokens: totalCompl,
    totalTokens,
    factsExtracted: allFacts.length,
    postsProcessed: allNews.length,
  });

  log(`Done: ${totalTokens} tokens, ${allNews.length} posts, ${allFacts.length} facts`, scope);

  const parsed = parseLlmJson<{ blocks: DigestBlock[] }>(llmOutput);
  let digestText: string;

  if (parsed?.blocks && parsed.blocks.length > 0) {
    digestText = formatDigestBlocks(parsed.blocks);
  } else {
    log("LLM returned non-JSON, converting markdown fallback", scope);
    digestText = sanitizeHtmlForTelegram(markdownToTelegramHtml(llmOutput));
  }

  digestText += `\n\n---\n📊 <i>${totalTokens} токенов (${allNews.length} постов → ${allFacts.length} фактов)</i>`;
  return digestText;
}
