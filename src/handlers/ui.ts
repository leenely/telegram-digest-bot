import { InlineKeyboard } from "grammy";
import { loadSettings, loadSources } from "../storage";
import { PendingAdd } from "../types";

export function buildSourcesMessage(userId: number): string {
  const sources = loadSources(userId);
  let msg = "<b>📋 Ваши источники</b>\n\n";

  if (sources.rss.length > 0) {
    msg += "<b>🌐 RSS / YouTube:</b>\n";
    msg += sources.rss.map((s, i) => `${i + 1}. <code>${s}</code>`).join("\n");
    msg += "\n\n";
  }

  if (sources.telegram.length > 0) {
    msg += "<b>💬 Telegram:</b>\n";
    msg += sources.telegram.map((s, i) => `${(sources.rss.length || 0) + i + 1}. @${s}`).join("\n");
    msg += "\n\n";
  }

  if (sources.rss.length === 0 && sources.telegram.length === 0) {
    msg += "<i>Пусто. Добавьте каналы или RSS кнопкой ниже.</i>\n\n";
  }

  msg += `<i>Всего: ${sources.rss.length + sources.telegram.length}</i>`;
  return msg;
}

export function sourcesMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Добавить", "src_add")
    .text("🗑 Удалить", "src_delete_mode");
}

export function buildDeleteKeyboard(userId: number): InlineKeyboard {
  const sources = loadSources(userId);
  const kb = new InlineKeyboard();

  sources.rss.forEach((r, idx) => {
    const short = r.length > 25 ? r.slice(0, 22) + "..." : r;
    kb.text(`❌ 🌐 ${short}`, `src_del_r:${idx}`);
    kb.row();
  });

  sources.telegram.forEach((t, idx) => {
    kb.text(`❌ 💬 @${t}`, `src_del_t:${idx}`);
    kb.row();
  });

  kb.text("← Назад", "src_back");
  return kb;
}

export function buildPendingMessage(pending: PendingAdd): string {
  const all = [
    ...pending.rss.map((r, i) => `${i + 1}. 🌐 <code>${r}</code>`),
    ...pending.telegram.map((t, i) => `${pending.rss.length + i + 1}. 💬 @${t}`),
  ];

  if (all.length === 0) {
    return "<b>➕ Добавление источников</b>\n\nОтправьте ссылки на каналы или RSS.\nМожно несколько за раз или по одному.\n\n<i>Поддерживается: @channel, https://t.me/channel, RSS, YouTube</i>";
  }

  return `<b>➕ Добавление источников</b>\n\nНакоплено:\n${all.join("\n")}\n\n<i>Отправьте ещё или нажмите кнопку ниже.</i>`;
}

export const confirmKeyboard = new InlineKeyboard()
  .text("✅ Завершить добавление", "confirm_add")
  .text("✖ Отмена", "src_back");

export function buildInterestsMessage(userId: number): string {
  const settings = loadSettings(userId);
  let msg = "<b>🎯 Ваши интересы (теги)</b>\n\n";
  if (settings.interests.length > 0) {
    msg += settings.interests.map((t, i) => `${i + 1}. <code>${t}</code>`).join("\n");
    msg += "\n\n";
  } else {
    msg += "<i>Теги пока не заданы.</i>\n\n";
  }
  msg += "<i>Система учитывает теги при ранжировании новостей.</i>";
  return msg;
}

export function interestsMainKeyboard(userId: number): InlineKeyboard {
  const settings = loadSettings(userId);
  const kb = new InlineKeyboard().text("➕ Добавить", "int_add");
  if (settings.interests.length > 0) {
    kb.text("🗑 Удалить", "int_delete_mode");
  }
  return kb;
}

export function buildInterestsDeleteKeyboard(userId: number): InlineKeyboard {
  const settings = loadSettings(userId);
  const kb = new InlineKeyboard();

  settings.interests.forEach((tag, idx) => {
    kb.text(`❌ ${tag}`, `int_del:${idx}`);
    kb.row();
  });

  kb.text("← Назад", "int_back");
  return kb;
}

export function buildPendingInterestsMessage(tags: string[]): string {
  if (tags.length === 0) {
    return "<b>➕ Добавление тегов</b>\n\nОтправьте теги через запятую или по одному.\nНапример: <code>спорт, технологии, саморазвитие</code>";
  }
  return `<b>➕ Добавление тегов</b>\n\nНакоплено:\n${tags.map((t, i) => `${i + 1}. <code>${t}</code>`).join("\n")}\n\n<i>Отправьте ещё или нажмите кнопку ниже.</i>`;
}

export const confirmInterestsKeyboard = new InlineKeyboard()
  .text("✅ Сохранить теги", "int_confirm")
  .text("✖ Отмена", "int_back");

export function buildScheduleMessage(userId: number): string {
  const settings = loadSettings(userId);
  const hours = settings.schedule_hours.map((h) => `${h.toString().padStart(2, "0")}:00`);
  let msg = "<b>⏰ Ваше время рассылки дайджеста</b>\n\n";
  msg += `Текущие часы рассылки:\n<b>${hours.join(", ") || "Отключено"}</b>`;
  return msg;
}

export function buildScheduleKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("✏ Изменить время", "schedule_edit");
}
