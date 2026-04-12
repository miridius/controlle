/**
 * Tests for single-instance lock logic in index.ts.
 *
 * We can't import the lock functions directly (they're module-scoped in
 * index.ts and the module has side effects), so we extract and test the
 * logic patterns: stale detection, PID checking, and the combined
 * acquire/release lifecycle.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  statSync,
  utimesSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `controlle-lock-test-${process.pid}`);
const TEST_LOCK = join(TEST_DIR, "controlle.lock");

// Mirror the constant from index.ts
const STALE_LOCK_MS = 5 * 60 * 1000;

// --- Helpers that mirror the functions in index.ts ---

function isLockStale(lockFile: string): boolean {
  try {
    const st = statSync(lockFile);
    return Date.now() - st.mtimeMs > STALE_LOCK_MS;
  } catch {
    return true;
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

function acquireLock(
  lockFile: string,
  runtimeDir: string,
): boolean {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    try {
      const existing = readFileSync(lockFile, "utf-8").trim();
      if (existing) {
        const pid = parseInt(existing, 10);
        if (!isNaN(pid) && pid !== process.pid) {
          const alive = isPidAlive(pid);
          const stale = isLockStale(lockFile);

          if (stale) {
            // Take over stale lock
          } else if (alive) {
            return false; // Legitimate duplicate
          } else {
            // Dead process, take over
          }
        }
      }
    } catch {
      // Lock file doesn't exist — safe to take
    }
    writeFileSync(lockFile, String(process.pid), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function releaseLock(lockFile: string): void {
  try {
    unlinkSync(lockFile);
  } catch {
    // best-effort
  }
}

// --- Tests ---

describe("lock", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Clean up any leftover lock
    try { unlinkSync(TEST_LOCK); } catch { /* ok */ }
  });

  afterEach(() => {
    try { unlinkSync(TEST_LOCK); } catch { /* ok */ }
  });

  describe("isLockStale", () => {
    test("returns true when lock file does not exist", () => {
      expect(isLockStale(TEST_LOCK)).toBe(true);
    });

    test("returns false for a fresh lock file", () => {
      writeFileSync(TEST_LOCK, "12345", "utf-8");
      expect(isLockStale(TEST_LOCK)).toBe(false);
    });

    test("returns true for a lock older than 5 minutes", () => {
      writeFileSync(TEST_LOCK, "12345", "utf-8");
      // Set mtime to 10 minutes ago
      const past = new Date(Date.now() - 10 * 60 * 1000);
      utimesSync(TEST_LOCK, past, past);
      expect(isLockStale(TEST_LOCK)).toBe(true);
    });
  });

  describe("isPidAlive", () => {
    test("returns true for current process", () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    test("returns false for a non-existent PID", () => {
      // PID 99999999 almost certainly doesn't exist
      expect(isPidAlive(99999999)).toBe(false);
    });
  });

  describe("acquireLock", () => {
    test("acquires lock when no lock file exists", () => {
      expect(acquireLock(TEST_LOCK, TEST_DIR)).toBe(true);
      const content = readFileSync(TEST_LOCK, "utf-8").trim();
      expect(content).toBe(String(process.pid));
    });

    test("acquires lock when existing lock has dead PID", () => {
      writeFileSync(TEST_LOCK, "99999999", "utf-8");
      expect(acquireLock(TEST_LOCK, TEST_DIR)).toBe(true);
    });

    test("refuses lock when existing lock has alive PID and is fresh", () => {
      // Write a lock with our parent's PID (which is alive)
      const parentPid = process.ppid;
      writeFileSync(TEST_LOCK, String(parentPid), "utf-8");
      expect(acquireLock(TEST_LOCK, TEST_DIR)).toBe(false);
    });

    test("acquires lock when existing lock is stale even if PID seems alive", () => {
      const parentPid = process.ppid;
      writeFileSync(TEST_LOCK, String(parentPid), "utf-8");
      // Make lock stale
      const past = new Date(Date.now() - 10 * 60 * 1000);
      utimesSync(TEST_LOCK, past, past);
      expect(acquireLock(TEST_LOCK, TEST_DIR)).toBe(true);
    });

    test("acquires lock when lock contains own PID", () => {
      writeFileSync(TEST_LOCK, String(process.pid), "utf-8");
      expect(acquireLock(TEST_LOCK, TEST_DIR)).toBe(true);
    });
  });

  describe("releaseLock", () => {
    test("removes the lock file", () => {
      writeFileSync(TEST_LOCK, String(process.pid), "utf-8");
      releaseLock(TEST_LOCK);
      expect(() => statSync(TEST_LOCK)).toThrow();
    });

    test("does not throw when lock file does not exist", () => {
      expect(() => releaseLock(TEST_LOCK)).not.toThrow();
    });
  });
});
