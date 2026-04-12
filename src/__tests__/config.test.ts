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
  resolveSessionForSource,
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
    expect(typeof gateway.topics).toBe("object");
  });

  test("topics are a flat record with thread_id", () => {
    for (const [label, ch] of Object.entries(gateway.topics)) {
      expect(ch).toHaveProperty("thread_id");
      expect(typeof ch.thread_id).toBe("number");
      // Agent topics must have a session
      if (label !== "escalations" && label !== "mail_inbox") {
        expect(ch).toHaveProperty("session");
        expect(typeof ch.session).toBe("string");
      }
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

  test("returns correct label for configured topics", () => {
    for (const [label, ch] of Object.entries(gateway.topics)) {
      if (ch.thread_id !== 0) {
        const resolved = resolveChannel(ch.thread_id);
        expect(resolved).toBeDefined();
        expect(resolved!.label).toBe(label);
        expect(resolved!.threadId).toBe(ch.thread_id);
      }
    }
  });

  test("marks escalations topic correctly", () => {
    const escTopic = gateway.topics.escalations;
    if (escTopic && escTopic.thread_id !== 0) {
      const ch = resolveChannel(escTopic.thread_id);
      expect(ch).toBeDefined();
      expect(ch!.isEscalations).toBe(true);
      expect(ch!.isMailInbox).toBe(false);
    }
  });

  test("marks mail_inbox topic correctly", () => {
    const mailTopic = gateway.topics.mail_inbox;
    if (mailTopic && mailTopic.thread_id !== 0) {
      const ch = resolveChannel(mailTopic.thread_id);
      expect(ch).toBeDefined();
      expect(ch!.isMailInbox).toBe(true);
      expect(ch!.isEscalations).toBe(false);
    }
  });

  test("agent topics have session", () => {
    for (const [label, ch] of Object.entries(gateway.topics)) {
      if (label !== "escalations" && label !== "mail_inbox" && ch.thread_id !== 0) {
        const resolved = resolveChannel(ch.thread_id);
        expect(resolved).toBeDefined();
        expect(resolved!.session).toBe(ch.session);
        expect(resolved!.isEscalations).toBe(false);
        expect(resolved!.isMailInbox).toBe(false);
      }
    }
  });
});

describe("agentLogChannels", () => {
  test("returns array", () => {
    const channels = agentLogChannels();
    expect(Array.isArray(channels)).toBe(true);
  });

  test("includes topics with agent_log enabled", () => {
    const channels = agentLogChannels();
    for (const [label, ch] of Object.entries(gateway.topics)) {
      if (ch.agent_log && ch.session) {
        const found = channels.find((c) => c.label === label);
        expect(found).toBeDefined();
        expect(found!.session).toBe(ch.session);
        expect(found!.threadId).toBe(ch.thread_id);
      }
    }
  });

  test("excludes channels without agent_log", () => {
    const channels = agentLogChannels();
    for (const [label, ch] of Object.entries(gateway.topics)) {
      if (!ch.agent_log) {
        expect(channels.find((c) => c.label === label)).toBeUndefined();
      }
    }
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
    for (const [label, ch] of Object.entries(gateway.topics)) {
      if (ch.agent_log && ch.session && ch.project_dir) {
        const found = channels.find((c) => c.label === label);
        expect(found).toBeDefined();
        expect(found!.projectDir).toBe(ch.project_dir);
      }
    }
  });
});

describe("resolveSessionForSource", () => {
  test("returns session for direct topic label match", () => {
    expect(resolveSessionForSource("mayor")).toBe("hq-mayor");
  });

  test("returns session for nested topic label (crew/sam)", () => {
    expect(resolveSessionForSource("crew/sam")).toBe("co-crew-sam");
  });

  test("strips agent-log/ prefix and matches topic", () => {
    expect(resolveSessionForSource("agent-log/mayor")).toBe("hq-mayor");
  });

  test("strips agent-log/poll/ prefix and matches topic", () => {
    expect(resolveSessionForSource("agent-log/poll/mayor")).toBe("hq-mayor");
  });

  test("strips agent-log/poll/ prefix for nested topic", () => {
    expect(resolveSessionForSource("agent-log/poll/crew/sam")).toBe("co-crew-sam");
  });

  test("strips agent-log/ prefix for nested topic", () => {
    expect(resolveSessionForSource("agent-log/crew/sam")).toBe("co-crew-sam");
  });

  test("returns undefined for unknown source", () => {
    expect(resolveSessionForSource("unknown-topic")).toBeUndefined();
  });

  test("returns undefined for topic without session (escalations)", () => {
    expect(resolveSessionForSource("escalations")).toBeUndefined();
  });

  test("returns undefined for prefixed source without session", () => {
    expect(resolveSessionForSource("agent-log/escalations")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(resolveSessionForSource("")).toBeUndefined();
  });
});
