/**
 * Tests for health.ts: uptime, message counting, formatting.
 */
import { describe, expect, test } from "bun:test";
import {
  formatUptime,
  formatHealthReport,
  formatHeartbeat,
  recordInbound,
  recordOutbound,
  recordPoll,
  totalCounts,
  recentCounts,
  uptimeSeconds,
  getLastPollTime,
} from "../health";

describe("formatUptime", () => {
  test("formats seconds only", () => {
    expect(formatUptime(45)).toBe("45s");
  });

  test("formats minutes and seconds", () => {
    expect(formatUptime(125)).toBe("2m 5s");
  });

  test("formats hours, minutes, seconds", () => {
    expect(formatUptime(3661)).toBe("1h 1m 1s");
  });

  test("formats days, hours, minutes, seconds", () => {
    expect(formatUptime(90061)).toBe("1d 1h 1m 1s");
  });

  test("formats zero seconds", () => {
    expect(formatUptime(0)).toBe("0s");
  });

  test("omits zero components in the middle", () => {
    expect(formatUptime(3600)).toBe("1h 0s");
  });
});

describe("message counting", () => {
  test("totalCounts increments on recordInbound", () => {
    const before = totalCounts().inbound;
    recordInbound();
    expect(totalCounts().inbound).toBe(before + 1);
  });

  test("totalCounts increments on recordOutbound", () => {
    const before = totalCounts().outbound;
    recordOutbound();
    expect(totalCounts().outbound).toBe(before + 1);
  });

  test("recentCounts includes recent messages", () => {
    const before = recentCounts().inbound;
    recordInbound();
    expect(recentCounts().inbound).toBe(before + 1);
  });
});

describe("poll tracking", () => {
  test("getLastPollTime returns timestamp after recordPoll", () => {
    const before = Date.now();
    recordPoll();
    const result = getLastPollTime();
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(before);
    expect(result!).toBeLessThanOrEqual(Date.now());
  });
});

describe("formatHealthReport", () => {
  test("includes expected sections", () => {
    const report = formatHealthReport();
    expect(report).toContain("Gateway Health");
    expect(report).toContain("Uptime:");
    expect(report).toContain("Last poll:");
    expect(report).toContain("Messages (last 5m):");
    expect(report).toContain("Messages (total):");
    expect(report).toContain("PID:");
  });
});

describe("formatHeartbeat", () => {
  test("starts with 'gateway alive'", () => {
    const heartbeat = formatHeartbeat();
    expect(heartbeat).toStartWith("gateway alive");
  });

  test("includes uptime and message counts", () => {
    const heartbeat = formatHeartbeat();
    expect(heartbeat).toContain("uptime");
    expect(heartbeat).toContain("in /");
    expect(heartbeat).toContain("out (last 5m)");
    expect(heartbeat).toContain("last poll");
  });
});

describe("uptimeSeconds", () => {
  test("returns a non-negative number", () => {
    expect(uptimeSeconds()).toBeGreaterThanOrEqual(0);
  });
});
