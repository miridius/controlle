/**
 * Outbound: GT → Telegram message sending
 *
 * Provides a send() function used by:
 * - Escalation routing (gt escalate → escalations group)
 * - Mail forwarding (gt mail send --human → mail inbox group)
 * - Agent-log streaming (agent output → DM/crew groups)
 *
 * Also provides a CLI interface for use as a gt hook/script:
 *   bun run src/outbound.ts <chat_id> <text>
 *   echo "text" | bun run src/outbound.ts <chat_id> --stdin
 */
import type { Api } from "grammy";
import { log } from "./log";
import { trackEscalation } from "./channels/escalations";
import { trackMailMessage } from "./channels/mail-inbox";

let botApi: Api | null = null;

export function setApi(api: Api): void {
  botApi = api;
}

export interface SendOptions {
  /** Channel label for logging */
  channel: string;
  /** If this is an escalation, track the mapping */
  escalationId?: string;
  /** If this is a mail message, track the mapping */
  mailId?: string;
  /** Telegram parse mode */
  parseMode?: "HTML" | "Markdown" | "MarkdownV2";
  /** Disable link previews */
  disablePreview?: boolean;
}

/**
 * Send a message to a Telegram chat via the bot API.
 * Returns the Telegram message_id for tracking.
 */
export async function send(
  chatId: number,
  text: string,
  opts: SendOptions = { channel: "unknown" },
): Promise<number> {
  if (!botApi) {
    throw new Error("Bot API not initialized. Call setApi() first.");
  }

  const msg = await botApi.sendMessage(chatId, text, {
    parse_mode: opts.parseMode,
    link_preview_options: opts.disablePreview
      ? { is_disabled: true }
      : undefined,
  });

  await log(opts.channel, "out", "bot", text.slice(0, 200));

  if (opts.escalationId) {
    trackEscalation(msg.message_id, opts.escalationId);
  }
  if (opts.mailId) {
    trackMailMessage(msg.message_id, opts.mailId);
  }

  return msg.message_id;
}

/**
 * Send an escalation to the escalations group.
 */
export async function sendEscalation(
  chatId: number,
  escalationId: string,
  severity: string,
  description: string,
  source?: string,
): Promise<number> {
  const icon =
    severity === "critical"
      ? "🔴"
      : severity === "high"
        ? "🟠"
        : severity === "medium"
          ? "🟡"
          : "🔵";

  const text = [
    `${icon} <b>Escalation [${severity.toUpperCase()}]</b>`,
    `<b>ID:</b> <code>${escalationId}</code>`,
    source ? `<b>Source:</b> ${source}` : null,
    "",
    description,
    "",
    "React 👍 to ack, ✅ to resolve",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return send(chatId, text, {
    channel: "escalations",
    escalationId,
    parseMode: "HTML",
  });
}

/**
 * Send a mail message to the mail inbox group.
 */
export async function sendMailMessage(
  chatId: number,
  mailId: string,
  from: string,
  subject: string,
  body: string,
): Promise<number> {
  const text = [
    `📬 <b>Mail from ${escapeHtml(from)}</b>`,
    `<b>Subject:</b> ${escapeHtml(subject)}`,
    `<b>ID:</b> <code>${mailId}</code>`,
    "",
    escapeHtml(body),
    "",
    "Reply to this message to respond.",
  ].join("\n");

  return send(chatId, text, {
    channel: "mail_inbox",
    mailId,
    parseMode: "HTML",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
