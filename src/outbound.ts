/**
 * Outbound: GT → Telegram message sending
 *
 * All messages go to the single supergroup, targeted to the correct
 * forum topic via message_thread_id.
 */
import { type Api, GrammyError } from "grammy";
import { log } from "./log";
import { trackEscalation } from "./channels/escalations";
import { trackMailMessage } from "./channels/mail-inbox";
import { supergroupChatId } from "./config";
import { gfmToTelegramHtml, truncateHtml } from "./markdown";
import { escapeHtml, severityIcon } from "./utils";
import { telegramLimiter } from "./rate-limiter";
import { recordOutbound } from "./health";

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

export interface SendResult {
  messageId: number;
  entities?: Array<{ type: string }>;
}

/**
 * Send a message to a forum topic in the supergroup.
 * Returns the Telegram message_id and entity info for observability.
 */
export async function send(
  threadId: number,
  text: string,
  opts: SendOptions = { channel: "unknown" },
): Promise<SendResult> {
  if (!botApi) {
    throw new Error("Bot API not initialized. Call setApi() first.");
  }

  const chatId = supergroupChatId();

  const msg = await telegramLimiter.schedule(async () => {
    try {
      return await botApi!.sendMessage(chatId, text, {
        message_thread_id: threadId,
        parse_mode: opts.parseMode,
        link_preview_options: opts.disablePreview
          ? { is_disabled: true }
          : undefined,
      });
    } catch (err) {
      if (
        err instanceof GrammyError &&
        err.error_code === 429
      ) {
        const retryAfter =
          (err.payload as Record<string, unknown>)?.retry_after;
        if (typeof retryAfter === "number") {
          telegramLimiter.notifyRetryAfter(retryAfter);
        }
      }
      throw err;
    }
  });

  recordOutbound();
  await log(opts.channel, "out", "bot", text.slice(0, 200));

  if (opts.escalationId) {
    trackEscalation(msg.message_id, opts.escalationId);
  }
  if (opts.mailId) {
    trackMailMessage(msg.message_id, opts.mailId);
  }

  const entities = msg.entities?.map((e: { type: string }) => ({ type: e.type }));
  return { messageId: msg.message_id, entities };
}

/**
 * Send an escalation to the escalations topic.
 */
export async function sendEscalation(
  threadId: number,
  escalationId: string,
  severity: string,
  description: string,
  source?: string,
): Promise<number> {
  const icon = severityIcon(severity);

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

  const result = await send(threadId, text, {
    channel: "escalations",
    escalationId,
    parseMode: "HTML",
  });
  return result.messageId;
}

/**
 * Send a mail message to the mail inbox topic.
 */
export async function sendMailMessage(
  threadId: number,
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

  const result = await send(threadId, text, {
    channel: "mail_inbox",
    mailId,
    parseMode: "HTML",
  });
  return result.messageId;
}

/**
 * Escape special characters for Telegram MarkdownV2 parse mode.
 * Characters that must be escaped: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
export function escapeMarkdownV2(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

/**
 * Send a message with HTML formatting (converted from GFM), falling back
 * to plain text if Telegram rejects it (400 error).
 */
export async function sendWithMarkdownFallback(
  threadId: number,
  text: string,
  opts: SendOptions = { channel: "unknown" },
): Promise<number> {
  const html = truncateHtml(gfmToTelegramHtml(text));
  try {
    const result = await send(threadId, html, {
      ...opts,
      parseMode: "HTML",
    });
    const entitySummary = formatEntitySummary(result.entities);
    console.log(
      `[agent-log] Sent to ${opts.channel}: 200 OK, msg_id=${result.messageId}${entitySummary}`,
    );
    return result.messageId;
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 400) {
      console.log(
        `[agent-log] HTML rejected for ${opts.channel}, falling back to plain text`,
      );
      const result = await send(threadId, text, { ...opts, parseMode: undefined });
      const entitySummary = formatEntitySummary(result.entities);
      console.log(
        `[agent-log] Sent to ${opts.channel} (plain text): 200 OK, msg_id=${result.messageId}${entitySummary}`,
      );
      return result.messageId;
    }
    throw err;
  }
}

function formatEntitySummary(entities?: Array<{ type: string }>): string {
  if (!entities || entities.length === 0) return ", 0 entities";
  const types = [...new Set(entities.map((e) => e.type))];
  return `, ${entities.length} entities (${types.join(", ")})`;
}
