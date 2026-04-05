/**
 * Tests for log.ts: message logging to daily files.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { log } from "../log";
import { env } from "../config";

const testLogDir = env.logDir; // set by setup.ts to /tmp/controlle-test-logs

afterAll(() => {
  // Clean up test log files
  try {
    rmSync(testLogDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("log", () => {
  test("creates log directory and writes log entry", async () => {
    await log("test_channel", "in", "testuser", "hello world");
    expect(existsSync(testLogDir)).toBe(true);
  });

  test("writes entry with correct format", async () => {
    await log("mayor_dm", "in", "alice", "test message");

    // Find today's log file
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const logFile = join(testLogDir, `${yyyy}-${mm}-${dd}.log`);

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("[mayor_dm]");
    expect(content).toContain("→");
    expect(content).toContain("alice");
    expect(content).toContain("test message");
  });

  test("uses ← arrow for outbound direction", async () => {
    await log("escalations", "out", "bot", "escalation sent");

    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const logFile = join(testLogDir, `${yyyy}-${mm}-${dd}.log`);

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("←");
    expect(content).toContain("escalation sent");
  });

  test("appends multiple log entries to same file", async () => {
    await log("ch1", "in", "user1", "first");
    await log("ch2", "out", "user2", "second");

    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const logFile = join(testLogDir, `${yyyy}-${mm}-${dd}.log`);

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("first");
    expect(content).toContain("second");
  });
});
