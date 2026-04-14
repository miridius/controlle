/**
 * Agent Topic — Generic handler for any agent with a session
 *
 * Inbound:  human types message in agent topic → gt nudge <session> "text"
 * Outbound: agent-log → streamed to topic (handled by agent-log watcher)
 *
 * For crew topics with a `rig` configured, auto-starts the crew session
 * if the tmux session is not running before delivering the nudge.
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";
import { reportError } from "../error-handler";

export const retryConfig = { attempts: 3, delayMs: 2000 };

/** Check if a tmux session exists */
async function isSessionAlive(session: string): Promise<boolean> {
  try {
    await exec("tmux", ["has-session", "-t", session], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Start a crew session if not running. Returns true if session was started. */
async function ensureCrewSession(
  label: string,
  session: string,
  rig: string,
): Promise<boolean> {
  if (await isSessionAlive(session)) return false;

  // Extract crew name from label (e.g., "crew/sam" → "sam")
  const crewName = label.replace(/^crew\//, "");
  console.log(
    `[gateway] Session ${session} not running, starting crew ${crewName} in ${rig}`,
  );

  try {
    await exec("gt", ["crew", "start", rig, crewName, "--resume"], {
      timeout: 30_000,
    });
    console.log(`[gateway] Started crew session ${session}`);
    return true;
  } catch (err) {
    console.error(`[gateway] Failed to start crew session ${session}:`, err);
    throw err;
  }
}

export async function handleAgentInbound(
  ctx: Context,
  label: string,
  session: string,
  rig?: string,
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

  // REQ-19: Immediate visual feedback on receipt
  await ctx.react("👀");

  try {
    // Auto-start crew session if not running
    if (rig) {
      await ensureCrewSession(label, session, rig);
    }

    // Timeout must exceed `gt nudge`'s default wait-idle max (60s) so Node
    // doesn't SIGTERM the child while gt is still waiting for the agent to
    // idle. See co-gbh: a 30s default caused false "delivery failed" warnings
    // when the agent was busy for >30s on a tool call.
    await execWithRetry("gt", ["nudge", session, "--stdin"], {
      stdin: wrapped,
      timeout: 90_000,
    });
    await ctx.react("👍");
  } catch (err) {
    // REQ-19: Replace pending reaction with failure indicator
    await ctx.react("😢");
    await ctx.reply("⚠️ Message delivery failed. The agent may be unreachable.", {
      reply_parameters: { message_id: msgId! },
    });
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
