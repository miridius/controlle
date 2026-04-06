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
}

export interface GatewayConfig {
  supergroup_chat_id: number;
  topics: {
    mayor: TopicChannel & { session: string };
    escalations: TopicChannel;
    mail_inbox: TopicChannel;
    crew: Record<string, TopicChannel & { session: string }>;
  };
}

const configPath = join(import.meta.dir, "..", "gateway.config.json");
export const gateway: GatewayConfig = JSON.parse(
  readFileSync(configPath, "utf-8"),
);

// --- Lookup helpers ---

export type ChannelType = "mayor" | "escalations" | "mail_inbox" | "crew";

export interface ResolvedChannel {
  type: ChannelType;
  crewName?: string;
  session?: string;
  threadId: number;
}

const threadIdMap = new Map<number, ResolvedChannel>();

function buildThreadIdMap(): void {
  if (gateway.topics.mayor.thread_id) {
    threadIdMap.set(gateway.topics.mayor.thread_id, {
      type: "mayor",
      session: gateway.topics.mayor.session,
      threadId: gateway.topics.mayor.thread_id,
    });
  }
  if (gateway.topics.escalations.thread_id) {
    threadIdMap.set(gateway.topics.escalations.thread_id, {
      type: "escalations",
      threadId: gateway.topics.escalations.thread_id,
    });
  }
  if (gateway.topics.mail_inbox.thread_id) {
    threadIdMap.set(gateway.topics.mail_inbox.thread_id, {
      type: "mail_inbox",
      threadId: gateway.topics.mail_inbox.thread_id,
    });
  }
  for (const [name, ch] of Object.entries(gateway.topics.crew)) {
    if (ch.thread_id) {
      threadIdMap.set(ch.thread_id, {
        type: "crew",
        crewName: name,
        session: ch.session,
        threadId: ch.thread_id,
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
  label: string;
}> {
  const results: Array<{ threadId: number; session: string; label: string }> =
    [];
  if (gateway.topics.mayor.agent_log) {
    results.push({
      threadId: gateway.topics.mayor.thread_id,
      session: gateway.topics.mayor.session,
      label: "mayor",
    });
  }
  for (const [name, ch] of Object.entries(gateway.topics.crew)) {
    if (ch.agent_log) {
      results.push({
        threadId: ch.thread_id,
        session: ch.session,
        label: `crew/${name}`,
      });
    }
  }
  return results;
}
