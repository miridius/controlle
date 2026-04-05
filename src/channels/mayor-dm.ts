/**
 * Channel 1: Bot DM — Mayor Direct Line
 *
 * Inbound:  human types message → gt nudge mayor "text"
 * Outbound: mayor agent-log → streamed to DM (handled by agent-log watcher)
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";
import { gateway } from "../config";

export async function handleMayorDmInbound(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const from = ctx.from?.username || ctx.from?.first_name || "human";
  await log("mayor_dm", "in", from, text);

  const session = gateway.mayor_dm.session;
  const wrapped = `<telegram><message from="${escapeXml(from)}">${escapeXml(text)}</message></telegram>`;

  try {
    await exec("gt", ["nudge", session, "--stdin"], { stdin: wrapped });
    await ctx.react("👍");
  } catch (err) {
    console.error("Failed to nudge mayor:", err);
    await ctx.reply("Failed to deliver message to mayor.");
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
