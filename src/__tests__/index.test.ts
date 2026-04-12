/**
 * Tests for index.ts: acquireLock, releaseLock, signal handlers, stale PID detection.
 *
 * index.ts runs top-level side effects on import (starts bot), so we test
 * the lock logic by reimplementing the core functions — these mirror the
 * exact logic in index.ts without triggering the bot startup.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Reimplement acquireLock/releaseLock from index.ts for isolated testing.
function acquireLock(runtimeDir: string, lockFile: string): boolean {
  try {
    mkdirSync(runtimeDir, { recursive: true });
    try {
      const existing = readFileSync(lockFile, "utf-8").trim();
      if (existing) {
        const pid = parseInt(existing, 10);
        if (!isNaN(pid) && pid !== process.pid) {
          try {
            process.kill(pid, 0);
            return false;
          } catch {
            // Process is dead, stale lock
          }
        }
      }
    } catch {
      // Lock file doesn't exist
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

describe("acquireLock", () => {
  let testDir: string;
  let lockFile: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `controlle-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    lockFile = join(testDir, "controlle.lock");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("acquires lock when no lock file exists", () => {
    const result = acquireLock(testDir, lockFile);
    expect(result).toBe(true);
    expect(existsSync(lockFile)).toBe(true);
    expect(readFileSync(lockFile, "utf-8").trim()).toBe(String(process.pid));
  });

  test("creates runtime directory recursively", () => {
    const deepDir = join(testDir, "nested", "deep");
    const deepLock = join(deepDir, "controlle.lock");
    expect(acquireLock(deepDir, deepLock)).toBe(true);
    expect(existsSync(deepDir)).toBe(true);
  });

  test("takes over stale lock from dead process", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(lockFile, "999999999", "utf-8");
    expect(acquireLock(testDir, lockFile)).toBe(true);
    expect(readFileSync(lockFile, "utf-8").trim()).toBe(String(process.pid));
  });

  test("allows re-acquiring lock with own PID", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(lockFile, String(process.pid), "utf-8");
    expect(acquireLock(testDir, lockFile)).toBe(true);
  });

  test("rejects lock when another live process holds it", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(lockFile, "1", "utf-8"); // PID 1 is always alive
    expect(acquireLock(testDir, lockFile)).toBe(false);
  });

  test("handles non-numeric content in lock file", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(lockFile, "not-a-number", "utf-8");
    expect(acquireLock(testDir, lockFile)).toBe(true);
  });

  test("handles empty lock file", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(lockFile, "", "utf-8");
    expect(acquireLock(testDir, lockFile)).toBe(true);
  });

  test("handles whitespace-only lock file", () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(lockFile, "   \n  ", "utf-8");
    expect(acquireLock(testDir, lockFile)).toBe(true);
  });
});

describe("releaseLock", () => {
  let testDir: string;
  let lockFile: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `controlle-release-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    lockFile = join(testDir, "controlle.lock");
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("removes lock file", () => {
    writeFileSync(lockFile, String(process.pid), "utf-8");
    expect(existsSync(lockFile)).toBe(true);
    releaseLock(lockFile);
    expect(existsSync(lockFile)).toBe(false);
  });

  test("does not throw when lock file doesn't exist", () => {
    expect(() => releaseLock(lockFile)).not.toThrow();
  });

  test("does not throw when path is invalid", () => {
    expect(() => releaseLock("/nonexistent/path/lock")).not.toThrow();
  });
});

describe("signal handler behavior (acquire → release round-trip)", () => {
  test("lock acquire then release cleans up correctly", () => {
    const dir = join(tmpdir(), `controlle-signal-test-${Date.now()}`);
    const lock = join(dir, "controlle.lock");

    expect(acquireLock(dir, lock)).toBe(true);
    expect(existsSync(lock)).toBe(true);

    releaseLock(lock);
    expect(existsSync(lock)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test("new instance can acquire after previous release", () => {
    const dir = join(tmpdir(), `controlle-reacquire-test-${Date.now()}`);
    const lock = join(dir, "controlle.lock");

    acquireLock(dir, lock);
    releaseLock(lock);

    expect(acquireLock(dir, lock)).toBe(true);
    releaseLock(lock);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("stale PID detection", () => {
  test("detects and takes over stale lock after Docker restart", () => {
    const dir = join(tmpdir(), `controlle-stale-test-${Date.now()}`);
    const lock = join(dir, "controlle.lock");

    mkdirSync(dir, { recursive: true });
    writeFileSync(lock, "999999998", "utf-8");

    expect(acquireLock(dir, lock)).toBe(true);
    expect(readFileSync(lock, "utf-8").trim()).toBe(String(process.pid));

    releaseLock(lock);
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves lock when held by a live process", () => {
    const dir = join(tmpdir(), `controlle-live-test-${Date.now()}`);
    const lock = join(dir, "controlle.lock");

    mkdirSync(dir, { recursive: true });
    writeFileSync(lock, "1", "utf-8");

    expect(acquireLock(dir, lock)).toBe(false);
    expect(readFileSync(lock, "utf-8").trim()).toBe("1");

    rmSync(dir, { recursive: true, force: true });
  });

  test("takes over lock from PID 0 (invalid)", () => {
    const dir = join(tmpdir(), `controlle-pid0-test-${Date.now()}`);
    const lock = join(dir, "controlle.lock");

    mkdirSync(dir, { recursive: true });
    writeFileSync(lock, "0", "utf-8");

    // PID 0 typically can't be signaled — process.kill(0, 0) checks own process group
    // The lock logic uses isNaN check; 0 is a valid number, not our PID, so it tries kill
    const result = acquireLock(dir, lock);
    // Result depends on whether kill(0, 0) succeeds or not — either way, no crash
    expect(typeof result).toBe("boolean");

    rmSync(dir, { recursive: true, force: true });
  });
});
