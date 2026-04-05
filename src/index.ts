/**
 * Gas Town Telegram Gateway — Entry point
 *
 * Four-channel gateway bridging Telegram ↔ Gas Town:
 *   1. Bot DM → Mayor direct line
 *   2. Escalations group → alert routing
 *   3. Mail inbox group → human mail replies
 *   4. Crew chat groups → crew member nudges
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
