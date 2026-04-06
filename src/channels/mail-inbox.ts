/**
 * Mail Inbox Topic
 *
 * Outbound: gt mail send --human → forwarded to topic (via outbound send)
 * Inbound:  human uses Telegram reply-to → bot maps telegram_msg_id → gt_mail_msg_id → gt mail reply
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";
import { persistMailMapping, lookupMailMapping } from "../msg-map";

/** In-memory cache: Telegram message_id → GT mail message ID */
const msgToMailId = new Map<number, string>();

export function trackMailMessage(
  telegramMsgId: number,
  mailId: string,
): void {
  msgToMailId.set(telegramMsgId, mailId);
  persistMailMapping(telegramMsgId, mailId);
}

export async function handleMailInboxInbound(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const from = ctx.from?.username || ctx.from?.first_name || "human";
  const replyTo = ctx.message?.reply_to_message?.message_id;
  const threadId = ctx.message?.message_thread_id;

  if (!replyTo) {
    await ctx.reply(
      "Reply to a specific message to respond. Standalone messages are not routed.",
      { message_thread_id: threadId },
    );
    return;
  }

  const mailId = msgToMailId.get(replyTo) ?? lookupMailMapping(replyTo);
  if (!mailId) {
    await ctx.reply(
      "Could not find the original mail message. It may be too old.",
      { message_thread_id: threadId },
    );
    return;
  }

  await log("mail_inbox", "in", from, `reply to ${mailId}: ${text}`);

  try {
    await exec("gt", ["mail", "reply", mailId, "--stdin"], { stdin: text });
    await ctx.react("👍");
  } catch (err) {
    console.error(`Failed to reply to mail ${mailId}:`, err);
    await ctx.reply(`Failed to send reply to mail ${mailId}.`, {
      message_thread_id: threadId,
    });
  }
}
