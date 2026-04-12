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
 * Uses PID + mtime locking to prevent duplicate bot instances (409 Conflict).
 * Stale locks (> 5 min) are automatically reclaimed to handle SIGKILL/OOM/Docker restarts.
 */
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { createBot } from "./telegram";
import { startAgentLogWatcher, stopAgentLogWatcher } from "./agent-log-watcher";
import { reportError } from "./error-handler";

// --- Single-instance lock via PID file ---
// Prevents watch mode or manual restarts from spawning duplicate bot processes
// which cause 409 Conflict errors from Telegram's API.
const RUNTIME_DIR = process.env.RUNTIME_DIR || join(dirname(import.meta.dir), ".runtime");
const LOCK_FILE = join(RUNTIME_DIR, "controlle.lock");

// Lock staleness threshold: if the lock file is older than this, assume the
// holder is gone (PID may have been reused by an unrelated process after a
// Docker restart or OOM kill). 5 minutes is conservative — the bot writes the
// lock once at startup and never touches it again, so any mtime is from the
// original acquirer.
const STALE_LOCK_MS = 5 * 60 * 1000;

function isLockStale(): boolean {
  try {
    const st = statSync(LOCK_FILE);
    return Date.now() - st.mtimeMs > STALE_LOCK_MS;
  } catch {
    return true; // Can't stat → treat as stale / nonexistent
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(): boolean {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true });
    try {
      const existing = readFileSync(LOCK_FILE, "utf-8").trim();
      if (existing) {
        const pid = parseInt(existing, 10);
        if (!isNaN(pid) && pid !== process.pid) {
          const alive = isPidAlive(pid);
          const stale = isLockStale();

          if (stale) {
            // Lock is old — previous holder likely died (SIGKILL, OOM, Docker
            // restart). Even if the PID is technically alive it's probably a
            // different process that reused the number.
            console.warn(
              `[gateway] Stale lock found (pid=${pid}, alive=${alive}). Taking over.`,
            );
          } else if (alive) {
            // Lock is fresh and the PID is still running — legitimate duplicate.
            return false;
          } else {
            // Lock is recent but PID is dead — crashed moments ago.
            console.warn(
              `[gateway] Dead process lock (pid=${pid}). Taking over.`,
            );
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
