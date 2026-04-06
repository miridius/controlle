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

export async function handleAgentInbound(
  ctx: Context,
  label: string,
  session: string,
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const from = ctx.from?.username || ctx.from?.first_name || "human";
  await log(label, "in", from, text);

  const wrapped = `<telegram><message from="${escapeXml(from)}">${escapeXml(text)}</message></telegram>`;

  try {
    await exec("gt", ["nudge", session, "--stdin"], { stdin: wrapped });
    await ctx.react("👍");
  } catch (err) {
    reportError(label, err);
    await ctx.reply(`Failed to deliver message to ${label}.`, {
      message_thread_id: ctx.message?.message_thread_id,
    });
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
