/**
 * Tests for channel handlers: agent (generic), mail-inbox, escalations.
 *
 * Mocks exec() to avoid real shell commands and grammy Context for message handling.
 */
import { describe, expect, test, mock, beforeEach } from "bun:test";

// Mock exec before importing channel modules
const execMock = mock(() => Promise.resolve("ok"));
mock.module("../exec", () => ({
  exec: execMock,
}));

// Mock log to avoid file I/O
mock.module("../log", () => ({
  log: mock(() => Promise.resolve()),
}));

// Mock msg-map to avoid file I/O — store mappings in-memory for tests
const testMailMap = new Map<string, string>();
const testEscMap = new Map<string, string>();
mock.module("../msg-map", () => ({
  persistMailMapping: mock((id: number, mailId: string) => {
    testMailMap.set(String(id), mailId);
  }),
  lookupMailMapping: mock((id: number) => testMailMap.get(String(id))),
  persistEscalationMapping: mock((id: number, escId: string) => {
    testEscMap.set(String(id), escId);
  }),
  lookupEscalationMapping: mock((id: number) => testEscMap.get(String(id))),
}));

import { handleAgentInbound, retryConfig } from "../channels/agent";
import {
  handleMailInboxInbound,
  trackMailMessage,
} from "../channels/mail-inbox";
import {
  handleEscalationReaction,
  trackEscalation,
} from "../channels/escalations";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockCall = any[];

function getCall(index: number): MockCall {
  return execMock.mock.calls[index] as unknown as MockCall;
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const msgOverrides =
    overrides.message && typeof overrides.message === "object"
      ? overrides.message
      : {};
  return {
    chat: { id: -1003572202253, type: "supergroup" as const },
    message: {
      text: "hello world",
      message_id: 1,
      message_thread_id: 100,
      reply_to_message: undefined as
        | { message_id: number; text?: string }
        | undefined,
      quote: undefined as { text?: string } | undefined,
      ...msgOverrides,
    },
    from: (overrides.from as { username?: string; first_name?: string }) ?? {
      username: "testuser",
      first_name: "Test",
    },
    messageReaction: overrides.messageReaction as
      | {
          message_id: number;
          new_reaction: Array<{ type: string; emoji?: string }>;
        }
      | undefined,
    reply: mock(() => Promise.resolve()),
    react: mock(() => Promise.resolve()),
  };
}

describe("handleAgentInbound (mayor)", () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockImplementation(() => Promise.resolve("ok"));
    retryConfig.delayMs = 0; // No delay in tests
  });

  test("wraps message in full XML with msg_id and ack-cmd", async () => {
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1][0]).toBe("nudge");
    expect(call[1][1]).toBe("gt-mayor");
    expect(call[1]).toContain("--stdin");
    const stdin = call[2].stdin;
    expect(stdin).toContain("<telegram>");
    expect(stdin).toContain('from="testuser"');
    expect(stdin).toContain('msg_id="1"');
    expect(stdin).toContain("hello world");
    expect(stdin).toContain("<ack-cmd>bin/tg-ack 1</ack-cmd>");
    expect(stdin).toContain("</telegram>");
    // No reply_to for a non-reply message
    expect(stdin).not.toContain("reply_to=");
  });

  test("reacts with thumbs up on success", async () => {
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    expect(ctx.react).toHaveBeenCalledWith("👍");
  });

  test("replies with error after all retries exhausted", async () => {
    execMock.mockImplementation(() =>
      Promise.reject(new Error("nudge failed")),
    );
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    // Should have retried 3 times
    expect(execMock).toHaveBeenCalledTimes(3);
    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(replyCall[0]).toBe("Failed to deliver message to mayor.");
    // Should include thread_id in reply
    expect(replyCall[1]).toEqual({ message_thread_id: 100 });
  });

  test("retries on transient failure then succeeds", async () => {
    execMock
      .mockImplementationOnce(() => Promise.reject(new Error("transient")))
      .mockImplementationOnce(() => Promise.resolve("ok"));
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(ctx.react).toHaveBeenCalledWith("👍");
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  test("returns early if no text in message", async () => {
    const ctx = createMockCtx({ message: { text: undefined } });
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    expect(execMock).not.toHaveBeenCalled();
  });

  test("escapes XML special characters in message text", async () => {
    const ctx = createMockCtx({
      message: { text: 'hello <world> & "quotes"' },
    });
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain("&lt;world&gt;");
    expect(stdin).toContain("&amp;");
    expect(stdin).toContain("&quot;");
    expect(stdin).not.toContain("<world>");
  });

  test("falls back to first_name when username missing", async () => {
    const ctx = createMockCtx({ from: { first_name: "Alice" } });
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain('from="Alice"');
  });

  test("includes reply_to and reply-context for real replies", async () => {
    const ctx = createMockCtx({
      message: {
        text: "my reply",
        message_id: 50,
        message_thread_id: 100,
        reply_to_message: { message_id: 42, text: "original message" },
      },
    });
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain('reply_to="42"');
    expect(stdin).toContain(
      "<reply-context>original message</reply-context>",
    );
    expect(stdin).toContain("<ack-cmd>bin/tg-ack 50</ack-cmd>");
  });

  test("filters out reply_to when it points to topic root", async () => {
    // In forum topics, reply_to_message.message_id === message_thread_id for normal messages
    const ctx = createMockCtx({
      message: {
        text: "normal forum message",
        message_id: 55,
        message_thread_id: 100,
        reply_to_message: { message_id: 100, text: "topic root" },
      },
    });
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).not.toContain("reply_to=");
    expect(stdin).not.toContain("<reply-context>");
  });

  test("includes quote text when present", async () => {
    const ctx = createMockCtx({
      message: {
        text: "responding to this",
        message_id: 60,
        message_thread_id: 100,
        reply_to_message: { message_id: 45, text: "full original text" },
        quote: { text: "selected portion" },
      },
    });
    await handleAgentInbound(ctx as never, "mayor", "gt-mayor");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain("<quote>selected portion</quote>");
    expect(stdin).toContain(
      "<reply-context>full original text</reply-context>",
    );
    expect(stdin).toContain('reply_to="45"');
  });
});

describe("handleAgentInbound (crew)", () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockImplementation(() => Promise.resolve("ok"));
    retryConfig.delayMs = 0;
  });

  test("nudges correct session with full XML including msg_id and ack-cmd", async () => {
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "crew/sam", "co-crew-sam");

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["nudge", "co-crew-sam", "--stdin"]);
    const stdin = call[2].stdin;
    expect(stdin).toContain("<telegram>");
    expect(stdin).toContain('msg_id="1"');
    expect(stdin).toContain("hello world");
    expect(stdin).toContain("<ack-cmd>bin/tg-ack 1</ack-cmd>");
  });

  test("reacts with thumbs up on success", async () => {
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "crew/sam", "co-crew-sam");
    expect(ctx.react).toHaveBeenCalledWith("👍");
  });

  test("replies with error after retries exhausted", async () => {
    execMock.mockImplementation(() =>
      Promise.reject(new Error("failed")),
    );
    const ctx = createMockCtx();
    await handleAgentInbound(ctx as never, "crew/sam", "co-crew-sam");
    expect(execMock).toHaveBeenCalledTimes(3);
    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(replyCall[0]).toBe("Failed to deliver message to crew/sam.");
  });

  test("returns early if no text", async () => {
    const ctx = createMockCtx({ message: { text: undefined } });
    await handleAgentInbound(ctx as never, "crew/sam", "co-crew-sam");
    expect(execMock).not.toHaveBeenCalled();
  });

  test("escapes XML in messages", async () => {
    const ctx = createMockCtx({ message: { text: "<script>xss</script>" } });
    await handleAgentInbound(ctx as never, "crew/sam", "co-crew-sam");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain("&lt;script&gt;");
    expect(stdin).not.toContain("<script>");
  });
});

describe("handleMailInboxInbound", () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockImplementation(() => Promise.resolve("ok"));
  });

  test("rejects standalone messages (no reply-to)", async () => {
    const ctx = createMockCtx({
      message: { text: "hello", reply_to_message: undefined },
    });
    await handleMailInboxInbound(ctx as never);
    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(replyCall[0]).toBe(
      "Reply to a specific message to respond. Standalone messages are not routed.",
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  test("rejects reply to untracked message", async () => {
    const ctx = createMockCtx({
      message: {
        text: "reply text",
        reply_to_message: { message_id: 9999 },
      },
    });
    await handleMailInboxInbound(ctx as never);
    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(replyCall[0]).toBe(
      "Could not find the original mail message. It may be too old.",
    );
    expect(execMock).not.toHaveBeenCalled();
  });

  test("routes reply to tracked mail message", async () => {
    trackMailMessage(500, "mail-abc");

    const ctx = createMockCtx({
      message: {
        text: "my reply",
        reply_to_message: { message_id: 500 },
      },
    });
    await handleMailInboxInbound(ctx as never);

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["mail", "reply", "mail-abc", "--stdin"]);
    expect(call[2].stdin).toBe("my reply");
  });

  test("reacts with thumbs up on successful reply", async () => {
    trackMailMessage(501, "mail-def");
    const ctx = createMockCtx({
      message: {
        text: "reply",
        reply_to_message: { message_id: 501 },
      },
    });
    await handleMailInboxInbound(ctx as never);
    expect(ctx.react).toHaveBeenCalledWith("👍");
  });

  test("replies with error on exec failure", async () => {
    trackMailMessage(502, "mail-ghi");
    execMock.mockImplementationOnce(() =>
      Promise.reject(new Error("mail failed")),
    );
    const ctx = createMockCtx({
      message: {
        text: "reply",
        reply_to_message: { message_id: 502 },
      },
    });
    await handleMailInboxInbound(ctx as never);
    expect(ctx.reply).toHaveBeenCalled();
    const replyCall = ctx.reply.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(replyCall[0]).toBe("Failed to send reply to mail mail-ghi.");
  });

  test("falls back to file-backed mapping for CLI-sent messages", async () => {
    // Simulate CLI having persisted a mapping (via the mocked msg-map)
    testMailMap.set("700", "mail-cli");

    const ctx = createMockCtx({
      message: {
        text: "reply to cli mail",
        reply_to_message: { message_id: 700 },
      },
    });
    await handleMailInboxInbound(ctx as never);

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["mail", "reply", "mail-cli", "--stdin"]);
    expect(call[2].stdin).toBe("reply to cli mail");
  });
});

describe("handleEscalationReaction", () => {
  beforeEach(() => {
    execMock.mockReset();
    execMock.mockImplementation(() => Promise.resolve("ok"));
  });

  test("acks escalation on thumbs up reaction", async () => {
    trackEscalation(600, "esc-ack-1");
    const ctx = createMockCtx({
      messageReaction: {
        message_id: 600,
        new_reaction: [{ type: "emoji", emoji: "👍" }],
      },
      from: { username: "admin" },
    });
    await handleEscalationReaction(ctx as never);

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["escalate", "ack", "esc-ack-1"]);
  });

  test("closes escalation on checkmark reaction", async () => {
    trackEscalation(601, "esc-close-1");
    const ctx = createMockCtx({
      messageReaction: {
        message_id: 601,
        new_reaction: [{ type: "emoji", emoji: "✅" }],
      },
      from: { username: "admin" },
    });
    await handleEscalationReaction(ctx as never);

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1][0]).toBe("escalate");
    expect(call[1][1]).toBe("close");
    expect(call[1][2]).toBe("esc-close-1");
    expect(call[1]).toContain("--reason");
    expect(call[1][call[1].length - 1]).toContain("admin");
  });

  test("ignores reaction on untracked message", async () => {
    const ctx = createMockCtx({
      messageReaction: {
        message_id: 9999,
        new_reaction: [{ type: "emoji", emoji: "👍" }],
      },
    });
    await handleEscalationReaction(ctx as never);
    expect(execMock).not.toHaveBeenCalled();
  });

  test("ignores non-emoji reactions", async () => {
    trackEscalation(602, "esc-non");
    const ctx = createMockCtx({
      messageReaction: {
        message_id: 602,
        new_reaction: [{ type: "custom_emoji", custom_emoji_id: "123" }],
      },
    });
    await handleEscalationReaction(ctx as never);
    expect(execMock).not.toHaveBeenCalled();
  });

  test("returns early if no messageReaction", async () => {
    const ctx = createMockCtx({ messageReaction: undefined });
    await handleEscalationReaction(ctx as never);
    expect(execMock).not.toHaveBeenCalled();
  });

  test("handles both ack and close in single reaction update", async () => {
    trackEscalation(603, "esc-both");
    const ctx = createMockCtx({
      messageReaction: {
        message_id: 603,
        new_reaction: [
          { type: "emoji", emoji: "👍" },
          { type: "emoji", emoji: "✅" },
        ],
      },
      from: { username: "admin" },
    });
    await handleEscalationReaction(ctx as never);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  test("continues on exec failure (does not throw)", async () => {
    trackEscalation(604, "esc-fail");
    execMock.mockImplementationOnce(() =>
      Promise.reject(new Error("ack failed")),
    );
    const ctx = createMockCtx({
      messageReaction: {
        message_id: 604,
        new_reaction: [{ type: "emoji", emoji: "👍" }],
      },
      from: { username: "admin" },
    });
    await handleEscalationReaction(ctx as never);
  });
});
