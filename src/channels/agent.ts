/**
 * Agent Topic — Generic handler for any agent with a session
 *
 * Inbound:  human types message in agent topic → gt nudge <session> "text"
 * Outbound: agent-log → streamed to topic (handled by agent-log watcher)
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";
import { reportError } from "../error-handler";

export const retryConfig = { attempts: 3, delayMs: 2000 };

export async function handleAgentInbound(
  ctx: Context,
  label: string,
  session: string,
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const from = ctx.from?.username || ctx.from?.first_name || "human";
  await log(label, "in", from, text);

  const msgId = ctx.message?.message_id;
  const threadId = ctx.message?.message_thread_id;

  // In forum topics, every message has reply_to pointing to the topic root.
  // Filter that out so only real replies show reply_to.
  const replyToMsg = ctx.message?.reply_to_message;
  const replyTo =
    replyToMsg && replyToMsg.message_id !== threadId
      ? replyToMsg.message_id
      : undefined;

  // Extract quote text (Telegram quote feature) and reply context
  const quote = (ctx.message as unknown as Record<string, unknown>)?.quote as
    | { text?: string }
    | undefined;
  const quoteText = quote?.text;
  const replyContext =
    replyTo && replyToMsg && "text" in replyToMsg
      ? (replyToMsg as { text?: string }).text
      : undefined;

  // Build nudge XML
  let wrapped = "<telegram>";
  let msgAttrs = `from="${escapeXml(from)}" msg_id="${msgId}"`;
  if (replyTo) msgAttrs += ` reply_to="${replyTo}"`;
  wrapped += `<message ${msgAttrs}>${escapeXml(text)}</message>`;
  if (quoteText) wrapped += `<quote>${escapeXml(quoteText)}</quote>`;
  if (replyContext)
    wrapped += `<reply-context>${escapeXml(replyContext)}</reply-context>`;
  wrapped += `<ack-cmd>bin/tg-ack ${msgId}</ack-cmd>`;
  wrapped += "</telegram>";

  try {
    await execWithRetry("gt", ["nudge", session, "--stdin"], {
      stdin: wrapped,
    });
    await ctx.react("👍");
  } catch (err) {
    // Silent failure: log via error handler (medium severity, console only).
    // If failures repeat (3x in 60s), auto-escalates to "high" which nudges
    // the responsible agent first, then falls back to Escalations topic.
    // Dave should NOT see individual nudge delivery failures.
    reportError(label, err);
  }
}

async function execWithRetry(
  cmd: string,
  args: string[],
  opts?: { stdin?: string; timeout?: number },
): Promise<string> {
  for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
    try {
      return await exec(cmd, args, opts);
    } catch (err) {
      if (attempt === retryConfig.attempts) throw err;
      await sleep(retryConfig.delayMs);
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error("retry exhausted");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
