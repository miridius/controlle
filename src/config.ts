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

export interface CrewChannel {
  chat_id: number;
  session: string;
  agent_log?: boolean;
}

export interface GatewayConfig {
  mayor_dm: {
    chat_id: number;
    session: string;
    agent_log?: boolean;
  };
  escalations: {
    chat_id: number;
  };
  mail_inbox: {
    chat_id: number;
  };
  crew: Record<string, CrewChannel>;
}

const configPath = join(import.meta.dir, "..", "gateway.config.json");
export const gateway: GatewayConfig = JSON.parse(
  readFileSync(configPath, "utf-8"),
);

// --- Lookup helpers ---

export type ChannelType = "mayor_dm" | "escalations" | "mail_inbox" | "crew";

export interface ResolvedChannel {
  type: ChannelType;
  crewName?: string;
  session?: string;
  chatId: number;
}

const chatIdMap = new Map<number, ResolvedChannel>();

function buildChatIdMap(): void {
  if (gateway.mayor_dm.chat_id) {
    chatIdMap.set(gateway.mayor_dm.chat_id, {
      type: "mayor_dm",
      session: gateway.mayor_dm.session,
      chatId: gateway.mayor_dm.chat_id,
    });
  }
  if (gateway.escalations.chat_id) {
    chatIdMap.set(gateway.escalations.chat_id, {
      type: "escalations",
      chatId: gateway.escalations.chat_id,
    });
  }
  if (gateway.mail_inbox.chat_id) {
    chatIdMap.set(gateway.mail_inbox.chat_id, {
      type: "mail_inbox",
      chatId: gateway.mail_inbox.chat_id,
    });
  }
  for (const [name, ch] of Object.entries(gateway.crew)) {
    if (ch.chat_id) {
      chatIdMap.set(ch.chat_id, {
        type: "crew",
        crewName: name,
        session: ch.session,
        chatId: ch.chat_id,
      });
    }
  }
}

buildChatIdMap();

export function resolveChannel(chatId: number): ResolvedChannel | undefined {
  return chatIdMap.get(chatId);
}

/** Get all channels that have agent_log streaming enabled */
export function agentLogChannels(): Array<{
  chatId: number;
  session: string;
  label: string;
}> {
  const results: Array<{ chatId: number; session: string; label: string }> = [];
  if (gateway.mayor_dm.agent_log) {
    results.push({
      chatId: gateway.mayor_dm.chat_id,
      session: gateway.mayor_dm.session,
      label: "mayor",
    });
  }
  for (const [name, ch] of Object.entries(gateway.crew)) {
    if (ch.agent_log) {
      results.push({
        chatId: ch.chat_id,
        session: ch.session,
        label: `crew/${name}`,
      });
    }
  }
  return results;
}
