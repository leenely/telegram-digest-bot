export interface Sources {
  rss: string[];
  telegram: string[];
}

export interface UserSettings {
  interests: string[];
  schedule_hours: number[];
}

export interface RunLog {
  id: string;
  timestamp: string;
  type: "main" | "latest";
  rssCount: number;
  tgCount: number;
  rawChars: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  factsExtracted: number;
  postsProcessed: number;
}

export interface Prompts {
  extraction_system: string;
  system: string;
  user_prefix: string;
}

export interface NewsItem {
  source: string;
  link: string;
  text: string;
  isRss: boolean;
}

export interface DigestBlock {
  category: string;
  body: string;
  source_name: string;
  source_link: string;
}

export interface ExtractedFact {
  text: string;
  source_name: string;
  source_link: string;
}

export interface PendingAdd {
  rss: string[];
  telegram: string[];
  messageId: number | null;
}

export type WaitingMode = "interests" | "schedule";

export interface UserWaitingState {
  mode: WaitingMode;
  messageId?: number;
}

export interface UserSummary {
  userId: number;
  createdAt: string;
  totalDigests: number;
  totalTokens: number;
  lastGeneratedAt: string | null;
  sourcesCount: number;
}
