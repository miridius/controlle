/**
 * Tests for msg-map.ts: file-backed message ID mapping store.
 */
import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  persistMailMapping,
  lookupMailMapping,
  persistEscalationMapping,
  lookupEscalationMapping,
} from "../msg-map";
import { env } from "../config";

const mapFile = join(env.logDir, "msg-map.json");

beforeEach(() => {
  // Clean map file before each test for isolation
  try {
    rmSync(mapFile, { force: true });
  } catch {
    // ignore
  }
});

afterAll(() => {
  try {
    rmSync(mapFile, { force: true });
  } catch {
    // ignore
  }
});

describe("mail mapping", () => {
  test("persists and retrieves mail mapping", () => {
    persistMailMapping(100, "mail-abc");
    const result = lookupMailMapping(100);
    expect(result).toBe("mail-abc");
  });

  test("returns undefined for unknown mail mapping", () => {
    expect(lookupMailMapping(999)).toBeUndefined();
  });

  test("overwrites existing mail mapping", () => {
    persistMailMapping(200, "mail-old");
    persistMailMapping(200, "mail-new");
    expect(lookupMailMapping(200)).toBe("mail-new");
  });

  test("stores multiple mail mappings independently", () => {
    persistMailMapping(300, "mail-a");
    persistMailMapping(301, "mail-b");
    expect(lookupMailMapping(300)).toBe("mail-a");
    expect(lookupMailMapping(301)).toBe("mail-b");
  });
});

describe("escalation mapping", () => {
  test("persists and retrieves escalation mapping", () => {
    persistEscalationMapping(400, "esc-xyz");
    const result = lookupEscalationMapping(400);
    expect(result).toBe("esc-xyz");
  });

  test("returns undefined for unknown escalation mapping", () => {
    expect(lookupEscalationMapping(888)).toBeUndefined();
  });

  test("overwrites existing escalation mapping", () => {
    persistEscalationMapping(500, "esc-old");
    persistEscalationMapping(500, "esc-new");
    expect(lookupEscalationMapping(500)).toBe("esc-new");
  });
});

describe("cross-type isolation", () => {
  test("mail and escalation mappings do not interfere", () => {
    persistMailMapping(600, "mail-x");
    persistEscalationMapping(600, "esc-y");

    expect(lookupMailMapping(600)).toBe("mail-x");
    expect(lookupEscalationMapping(600)).toBe("esc-y");
  });
});

describe("file persistence", () => {
  test("creates map file on first write", () => {
    expect(existsSync(mapFile)).toBe(false);
    persistMailMapping(700, "mail-create");
    expect(existsSync(mapFile)).toBe(true);
  });

  test("writes valid JSON to map file", () => {
    persistMailMapping(800, "mail-json");
    const content = JSON.parse(readFileSync(mapFile, "utf-8"));
    expect(content).toHaveProperty("mail");
    expect(content).toHaveProperty("escalation");
    expect(content.mail["800"]).toBe("mail-json");
  });

  test("survives reading corrupted file gracefully", () => {
    // Write invalid JSON to the file
    const { writeFileSync } = require("node:fs");
    writeFileSync(mapFile, "{invalid json", "utf-8");

    // Should return undefined, not throw
    expect(lookupMailMapping(999)).toBeUndefined();
  });
});
