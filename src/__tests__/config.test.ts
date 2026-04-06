/**
 * Tests for config.ts: topic resolution, agent log channels, config validation.
 *
 * Note: config.ts reads TELEGRAM_BOT_TOKEN at import time, so we set the env
 * var before importing.
 */
import { describe, expect, test } from "bun:test";
import {
  resolveChannel,
  agentLogChannels,
  gateway,
  env,
  supergroupChatId,
} from "../config";

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
    expect(gateway.supergroup_chat_id).toBeDefined();
    expect(typeof gateway.supergroup_chat_id).toBe("number");
    expect(gateway.topics).toBeDefined();
    expect(gateway.topics.mayor).toBeDefined();
    expect(gateway.topics.mayor).toHaveProperty("thread_id");
    expect(gateway.topics.mayor).toHaveProperty("session");
    expect(gateway.topics.escalations).toBeDefined();
    expect(gateway.topics.escalations).toHaveProperty("thread_id");
    expect(gateway.topics.mail_inbox).toBeDefined();
    expect(gateway.topics.mail_inbox).toHaveProperty("thread_id");
    expect(gateway.topics.crew).toBeDefined();
    expect(typeof gateway.topics.crew).toBe("object");
  });

  test("crew topics have required fields", () => {
    for (const [, ch] of Object.entries(gateway.topics.crew)) {
      expect(ch).toHaveProperty("thread_id");
      expect(ch).toHaveProperty("session");
      expect(typeof ch.thread_id).toBe("number");
      expect(typeof ch.session).toBe("string");
    }
  });
});

describe("supergroupChatId", () => {
  test("returns the configured supergroup chat_id", () => {
    expect(supergroupChatId()).toBe(gateway.supergroup_chat_id);
  });
});

describe("resolveChannel", () => {
  test("returns undefined for unknown thread_id", () => {
    expect(resolveChannel(999999999)).toBeUndefined();
  });

  test("returns undefined for thread_id 0 (unconfigured)", () => {
    // thread_id 0 means "not configured" per the config format
    expect(resolveChannel(0)).toBeUndefined();
  });

  test("returns correct type for mayor if configured", () => {
    if (gateway.topics.mayor.thread_id !== 0) {
      const ch = resolveChannel(gateway.topics.mayor.thread_id);
      expect(ch).toBeDefined();
      expect(ch!.type).toBe("mayor");
      expect(ch!.session).toBe(gateway.topics.mayor.session);
      expect(ch!.threadId).toBe(gateway.topics.mayor.thread_id);
    }
  });

  test("returns correct type for escalations if configured", () => {
    if (gateway.topics.escalations.thread_id !== 0) {
      const ch = resolveChannel(gateway.topics.escalations.thread_id);
      expect(ch).toBeDefined();
      expect(ch!.type).toBe("escalations");
    }
  });

  test("returns correct type for mail_inbox if configured", () => {
    if (gateway.topics.mail_inbox.thread_id !== 0) {
      const ch = resolveChannel(gateway.topics.mail_inbox.thread_id);
      expect(ch).toBeDefined();
      expect(ch!.type).toBe("mail_inbox");
    }
  });

  test("returns correct type and crewName for crew topics", () => {
    for (const [name, crewCh] of Object.entries(gateway.topics.crew)) {
      if (crewCh.thread_id !== 0) {
        const ch = resolveChannel(crewCh.thread_id);
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

  test("includes mayor if agent_log is true", () => {
    const channels = agentLogChannels();
    if (gateway.topics.mayor.agent_log) {
      const mayor = channels.find((c) => c.label === "mayor");
      expect(mayor).toBeDefined();
      expect(mayor!.session).toBe(gateway.topics.mayor.session);
      expect(mayor!.threadId).toBe(gateway.topics.mayor.thread_id);
    }
  });

  test("includes crew channels with agent_log enabled", () => {
    const channels = agentLogChannels();
    for (const [name, ch] of Object.entries(gateway.topics.crew)) {
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
      expect(typeof ch.threadId).toBe("number");
      expect(typeof ch.session).toBe("string");
      expect(typeof ch.label).toBe("string");
    }
  });

  test("returns projectDir from config when set", () => {
    const channels = agentLogChannels();
    if (gateway.topics.mayor.agent_log && gateway.topics.mayor.project_dir) {
      const mayor = channels.find((c) => c.label === "mayor");
      expect(mayor).toBeDefined();
      expect(mayor!.projectDir).toBe(gateway.topics.mayor.project_dir);
    }
    for (const [name, ch] of Object.entries(gateway.topics.crew)) {
      if (ch.agent_log && ch.project_dir) {
        const found = channels.find((c) => c.label === `crew/${name}`);
        expect(found).toBeDefined();
        expect(found!.projectDir).toBe(ch.project_dir);
      }
    }
  });
});
