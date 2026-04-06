/**
 * Channel 2: Escalations Group
 *
 * Outbound: gt escalate triggers → message posted to group (via outbound send)
 * Inbound:  emoji reactions to ack (thumbs up) or resolve (checkmark)
 *
 * The bot tracks message_id → escalation_id mappings for reaction handling.
 */
import type { Context } from "grammy";
import { exec } from "../exec";
import { log } from "../log";
import { persistEscalationMapping, lookupEscalationMapping } from "../msg-map";

/** In-memory cache: Telegram message_id → GT escalation bead ID */
const msgToEscalation = new Map<number, string>();

export function trackEscalation(
  telegramMsgId: number,
  escalationId: string,
): void {
  msgToEscalation.set(telegramMsgId, escalationId);
  persistEscalationMapping(telegramMsgId, escalationId);
}

export async function handleEscalationReaction(ctx: Context): Promise<void> {
  const reaction = ctx.messageReaction;
  if (!reaction) return;

  const msgId = reaction.message_id;
  const escalationId = msgToEscalation.get(msgId) ?? lookupEscalationMapping(msgId);
  if (!escalationId) return;

  const newEmojis = reaction.new_reaction
    .filter((r) => r.type === "emoji")
    .map((r) => (r as { type: "emoji"; emoji: string }).emoji);

  const from =
    ctx.from?.username || ctx.from?.first_name || "human";

  if (newEmojis.includes("👍")) {
    await log("escalations", "in", from, `ack ${escalationId}`);
    try {
      await exec("gt", ["escalate", "ack", escalationId]);
    } catch (err) {
      console.error(`Failed to ack escalation ${escalationId}:`, err);
    }
  }

  if (newEmojis.includes("✅")) {
    await log("escalations", "in", from, `close ${escalationId}`);
    try {
      await exec("gt", [
        "escalate",
        "close",
        escalationId,
        "--reason",
        `Resolved via Telegram by ${from}`,
      ]);
    } catch (err) {
      console.error(`Failed to close escalation ${escalationId}:`, err);
    }
  }
}
