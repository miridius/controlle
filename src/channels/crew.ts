/**
 * Channel 4: Crew Direct Chat Groups (one per crew member)
 *
 * Inbound:  human sends message → gt nudge <crew-session> "text"
 * Outbound: crew agent-log → streamed to group (handled by agent-log watcher)
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";

export async function handleCrewInbound(
  ctx: Context,
  crewName: string,
  session: string,
): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;

  const from = ctx.from?.username || ctx.from?.first_name || "human";
  await log(`crew/${crewName}`, "in", from, text);

  const wrapped = `<telegram><message from="${escapeXml(from)}">${escapeXml(text)}</message></telegram>`;

  try {
    await exec("gt", ["nudge", session, "--stdin"], { stdin: wrapped });
    await ctx.react("👍");
  } catch (err) {
    console.error(`Failed to nudge crew/${crewName}:`, err);
    await ctx.reply(`Failed to deliver message to crew/${crewName}.`);
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
