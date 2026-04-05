/**
 * Tests for config.ts: channel resolution, agent log channels, config validation.
 *
 * Note: config.ts reads TELEGRAM_BOT_TOKEN at import time, so we set the env
 * var before importing.
 */
import { describe, expect, test } from "bun:test";
import { resolveChannel, agentLogChannels, gateway, env } from "../config";

describe("env", () => {
  test("reads TELEGRAM_BOT_TOKEN from environment", () => {
    expect(env.telegramBotToken).toBe("test-token-123");
  });

  test("uses LOG_DIR from environment when set", () => {
    // setup.ts sets LOG_DIR=/tmp/controlle-test-logs
    expect(env.logDir).toBe("/tmp/controlle-test-logs");
  });
});

describe("gateway config", () => {
  test("loads gateway.config.json with required structure", () => {
    expect(gateway).toBeDefined();
    expect(gateway.mayor_dm).toBeDefined();
    expect(gateway.mayor_dm).toHaveProperty("chat_id");
    expect(gateway.mayor_dm).toHaveProperty("session");
    expect(gateway.escalations).toBeDefined();
    expect(gateway.escalations).toHaveProperty("chat_id");
    expect(gateway.mail_inbox).toBeDefined();
    expect(gateway.mail_inbox).toHaveProperty("chat_id");
    expect(gateway.crew).toBeDefined();
    expect(typeof gateway.crew).toBe("object");
  });

  test("crew channels have required fields", () => {
    for (const [name, ch] of Object.entries(gateway.crew)) {
      expect(ch).toHaveProperty("chat_id");
      expect(ch).toHaveProperty("session");
      expect(typeof ch.chat_id).toBe("number");
      expect(typeof ch.session).toBe("string");
    }
  });
});

describe("resolveChannel", () => {
  test("returns undefined for unknown chat_id", () => {
    expect(resolveChannel(999999999)).toBeUndefined();
  });

  test("returns undefined for chat_id 0 (unconfigured)", () => {
    // chat_id 0 means "not configured" per the config format
    expect(resolveChannel(0)).toBeUndefined();
  });

  test("returns correct type for mayor_dm if configured", () => {
    if (gateway.mayor_dm.chat_id !== 0) {
      const ch = resolveChannel(gateway.mayor_dm.chat_id);
      expect(ch).toBeDefined();
      expect(ch!.type).toBe("mayor_dm");
      expect(ch!.session).toBe(gateway.mayor_dm.session);
      expect(ch!.chatId).toBe(gateway.mayor_dm.chat_id);
    }
  });

  test("returns correct type for escalations if configured", () => {
    if (gateway.escalations.chat_id !== 0) {
      const ch = resolveChannel(gateway.escalations.chat_id);
      expect(ch).toBeDefined();
      expect(ch!.type).toBe("escalations");
    }
  });

  test("returns correct type for mail_inbox if configured", () => {
    if (gateway.mail_inbox.chat_id !== 0) {
      const ch = resolveChannel(gateway.mail_inbox.chat_id);
      expect(ch).toBeDefined();
      expect(ch!.type).toBe("mail_inbox");
    }
  });

  test("returns correct type and crewName for crew channels", () => {
    for (const [name, crewCh] of Object.entries(gateway.crew)) {
      if (crewCh.chat_id !== 0) {
        const ch = resolveChannel(crewCh.chat_id);
        expect(ch).toBeDefined();
        expect(ch!.type).toBe("crew");
        expect(ch!.crewName).toBe(name);
        expect(ch!.session).toBe(crewCh.session);
      }
    }
  });
});

describe("agentLogChannels", () => {
  test("returns array", () => {
    const channels = agentLogChannels();
    expect(Array.isArray(channels)).toBe(true);
  });

  test("includes mayor_dm if agent_log is true", () => {
    const channels = agentLogChannels();
    if (gateway.mayor_dm.agent_log) {
      const mayor = channels.find((c) => c.label === "mayor");
      expect(mayor).toBeDefined();
      expect(mayor!.session).toBe(gateway.mayor_dm.session);
      expect(mayor!.chatId).toBe(gateway.mayor_dm.chat_id);
    }
  });

  test("includes crew channels with agent_log enabled", () => {
    const channels = agentLogChannels();
    for (const [name, ch] of Object.entries(gateway.crew)) {
      if (ch.agent_log) {
        const found = channels.find((c) => c.label === `crew/${name}`);
        expect(found).toBeDefined();
        expect(found!.session).toBe(ch.session);
      }
    }
  });

  test("excludes channels without agent_log", () => {
    const channels = agentLogChannels();
    // escalations and mail_inbox never have agent_log
    expect(channels.find((c) => c.label === "escalations")).toBeUndefined();
    expect(channels.find((c) => c.label === "mail_inbox")).toBeUndefined();
  });

  test("all returned channels have required fields", () => {
    const channels = agentLogChannels();
    for (const ch of channels) {
      expect(typeof ch.chatId).toBe("number");
      expect(typeof ch.session).toBe("string");
      expect(typeof ch.label).toBe("string");
    }
  });
});
