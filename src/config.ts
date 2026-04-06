import { readFileSync } from "node:fs";
import { join } from "node:path";

// --- Environment ---

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const env = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  logDir: process.env.LOG_DIR || "data",
} as const;

// --- Gateway config (static JSON) ---

export interface TopicChannel {
  thread_id: number;
  session?: string;
  agent_log?: boolean;
  /** Claude projects directory name (e.g. "-gt-controlle-crew-sam") for JSONL resolution */
  project_dir?: string;
}

export interface GatewayConfig {
  supergroup_chat_id: number;
  topics: Record<string, TopicChannel>;
}

const configPath = join(import.meta.dir, "..", "gateway.config.json");
export const gateway: GatewayConfig = JSON.parse(
  readFileSync(configPath, "utf-8"),
);

// --- Lookup helpers ---

/** Special topic names that have custom inbound handling */
const SPECIAL_TOPICS = new Set(["escalations", "mail_inbox"]);

export interface ResolvedChannel {
  /** Topic label from config key (e.g. "mayor", "crew/sam") */
  label: string;
  threadId: number;
  session?: string;
  /** True for escalations topic */
  isEscalations: boolean;
  /** True for mail_inbox topic */
  isMailInbox: boolean;
}

const threadIdMap = new Map<number, ResolvedChannel>();

function buildThreadIdMap(): void {
  for (const [label, ch] of Object.entries(gateway.topics)) {
    if (ch.thread_id) {
      threadIdMap.set(ch.thread_id, {
        label,
        threadId: ch.thread_id,
        session: ch.session,
        isEscalations: label === "escalations",
        isMailInbox: label === "mail_inbox",
      });
    }
  }
}

buildThreadIdMap();

/** Resolve a forum topic thread_id to a channel */
export function resolveChannel(threadId: number): ResolvedChannel | undefined {
  return threadIdMap.get(threadId);
}

/** Get the supergroup chat_id */
export function supergroupChatId(): number {
  return gateway.supergroup_chat_id;
}

/** Get all channels that have agent_log streaming enabled */
export function agentLogChannels(): Array<{
  threadId: number;
  session: string;
  projectDir: string | undefined;
  label: string;
}> {
  const results: Array<{
    threadId: number;
    session: string;
    projectDir: string | undefined;
    label: string;
  }> = [];
  for (const [label, ch] of Object.entries(gateway.topics)) {
    if (ch.agent_log && ch.session) {
      results.push({
        threadId: ch.thread_id,
        session: ch.session,
        projectDir: ch.project_dir,
        label,
      });
    }
  }
  return results;
}
