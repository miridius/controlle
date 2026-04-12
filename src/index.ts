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
 * Uses flock-based locking to prevent duplicate bot instances (409 Conflict).
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { createBot } from "./telegram";
import { startAgentLogWatcher, stopAgentLogWatcher } from "./agent-log-watcher";
import { reportError } from "./error-handler";

// --- Single-instance lock via PID file ---
// Prevents watch mode or manual restarts from spawning duplicate bot processes
// which cause 409 Conflict errors from Telegram's API.
const RUNTIME_DIR = process.env.RUNTIME_DIR || join(dirname(import.meta.dir), ".runtime");
const LOCK_FILE = join(RUNTIME_DIR, "controlle.lock");

function acquireLock(): boolean {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    try {
      const existing = readFileSync(LOCK_FILE, "utf-8").trim();
      if (existing) {
        const pid = parseInt(existing, 10);
        if (!isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 0); // Check if process is alive (signal 0)
            return false; // Another instance is running
          } catch {
            // Process is dead, stale lock — take over
          }
        }
      }
    } catch {
      // Lock file doesn't exist or is unreadable — safe to take it
    }
    writeFileSync(LOCK_FILE, String(process.pid), "utf-8");
    return true;
  } catch (err) {
    console.error("[gateway] Failed to acquire lock:", err);
    return false;
  }
}

function releaseLock(): void {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // best-effort
  }
}

if (!acquireLock()) {
  console.error(
    "[gateway] Another instance is already running. Exiting to prevent 409 Conflict errors.",
  );
  process.exit(1);
}

/** Registered cleanup functions called on shutdown */
const shutdownCallbacks: (() => void)[] = [releaseLock];

function shutdown(): void {
  for (const cb of shutdownCallbacks) {
    try { cb(); } catch { /* best-effort */ }
  }
  process.exit(0);
}

process.on("exit", releaseLock);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- Uncaught exception / unhandled rejection handlers ---
process.on("uncaughtException", (err) => {
  reportError("uncaught-exception", err, "critical");
});
process.on("unhandledRejection", (reason) => {
  reportError("unhandled-rejection", reason, "critical");
});

const bot = createBot();

// Start agent-log watchers for outbound streaming
startAgentLogWatcher();
shutdownCallbacks.push(stopAgentLogWatcher);

// Start bot in long polling mode
console.log("[gateway] Starting Gas Town Telegram gateway...");
bot.start({
  onStart: () => console.log("[gateway] Bot is running."),
});
