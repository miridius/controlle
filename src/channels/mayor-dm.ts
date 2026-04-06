/**
 * Mayor Topic — Mayor Direct Line
 *
 * Inbound:  human types message in Mayor topic → gt nudge mayor "text"
 * Outbound: mayor agent-log → streamed to topic (handled by agent-log watcher)
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";
import { gateway } from "../config";
import { reportError } from "../error-handler";

export async function handleMayorInbound(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const from = ctx.from?.username || ctx.from?.first_name || "human";
  await log("mayor", "in", from, text);

  const session = gateway.topics.mayor.session;
  const wrapped = `<telegram><message from="${escapeXml(from)}">${escapeXml(text)}</message></telegram>`;

  try {
    await exec("gt", ["nudge", session, "--stdin"], { stdin: wrapped });
    await ctx.react("👍");
  } catch (err) {
    reportError("mayor-dm", err);
    await ctx.reply("Failed to deliver message to mayor.", {
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
