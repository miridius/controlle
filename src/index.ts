/**
 * Gas Town Telegram Gateway — Entry point
 *
 * Single-supergroup gateway bridging Telegram ↔ Gas Town via forum topics:
 *   1. Mayor topic → Mayor direct line (nudges)
 *   2. Escalations topic → alert routing (reactions to ack/resolve)
 *   3. Mail inbox topic → human mail replies
 *   4. Crew topics → crew member nudges (one topic per crew member)
 *
 * Runs in long polling mode (production-ready for single-instance deployment).
 */
import { createBot } from "./telegram";
import { startAgentLogWatcher } from "./agent-log-watcher";

const bot = createBot();

// Start agent-log watchers for outbound streaming
startAgentLogWatcher();

// Start bot in long polling mode
console.log("[gateway] Starting Gas Town Telegram gateway...");
bot.start({
  onStart: () => console.log("[gateway] Bot is running."),
});
