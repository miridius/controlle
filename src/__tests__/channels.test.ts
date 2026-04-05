/**
 * Tests for channel handlers: mayor-dm, crew, mail-inbox, escalations.
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

import { handleMayorDmInbound } from "../channels/mayor-dm";
import { handleCrewInbound } from "../channels/crew";
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
    chat: { id: 100, type: "private" as const },
    message: {
      text: "hello world",
      message_id: 1,
      reply_to_message: undefined as { message_id: number } | undefined,
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

describe("handleMayorDmInbound", () => {
  beforeEach(() => {
    execMock.mockClear();
  });

  test("wraps message in XML and nudges mayor session", async () => {
    const ctx = createMockCtx();
    await handleMayorDmInbound(ctx as never);

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1][0]).toBe("nudge");
    expect(call[1]).toContain("--stdin");
    expect(call[2].stdin).toContain("<telegram>");
    expect(call[2].stdin).toContain('from="testuser"');
    expect(call[2].stdin).toContain("hello world");
    expect(call[2].stdin).toContain("</telegram>");
  });

  test("reacts with thumbs up on success", async () => {
    const ctx = createMockCtx();
    await handleMayorDmInbound(ctx as never);
    expect(ctx.react).toHaveBeenCalledWith("👍");
  });

  test("replies with error message on exec failure", async () => {
    execMock.mockImplementationOnce(() =>
      Promise.reject(new Error("nudge failed")),
    );
    const ctx = createMockCtx();
    await handleMayorDmInbound(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(
      "Failed to deliver message to mayor.",
    );
  });

  test("returns early if no text in message", async () => {
    const ctx = createMockCtx({ message: { text: undefined } });
    await handleMayorDmInbound(ctx as never);
    expect(execMock).not.toHaveBeenCalled();
  });

  test("escapes XML special characters in message text", async () => {
    const ctx = createMockCtx({
      message: { text: 'hello <world> & "quotes"' },
    });
    await handleMayorDmInbound(ctx as never);
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain("&lt;world&gt;");
    expect(stdin).toContain("&amp;");
    expect(stdin).toContain("&quot;");
    expect(stdin).not.toContain("<world>");
  });

  test("falls back to first_name when username missing", async () => {
    const ctx = createMockCtx({ from: { first_name: "Alice" } });
    await handleMayorDmInbound(ctx as never);
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain('from="Alice"');
  });
});

describe("handleCrewInbound", () => {
  beforeEach(() => {
    execMock.mockClear();
  });

  test("nudges correct session with wrapped XML", async () => {
    const ctx = createMockCtx();
    await handleCrewInbound(ctx as never, "sam", "co-crew-sam");

    expect(execMock).toHaveBeenCalledTimes(1);
    const call = getCall(0);
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["nudge", "co-crew-sam", "--stdin"]);
    expect(call[2].stdin).toContain("<telegram>");
    expect(call[2].stdin).toContain("hello world");
  });

  test("reacts with thumbs up on success", async () => {
    const ctx = createMockCtx();
    await handleCrewInbound(ctx as never, "sam", "co-crew-sam");
    expect(ctx.react).toHaveBeenCalledWith("👍");
  });

  test("replies with error on exec failure", async () => {
    execMock.mockImplementationOnce(() =>
      Promise.reject(new Error("failed")),
    );
    const ctx = createMockCtx();
    await handleCrewInbound(ctx as never, "sam", "co-crew-sam");
    expect(ctx.reply).toHaveBeenCalledWith(
      "Failed to deliver message to crew/sam.",
    );
  });

  test("returns early if no text", async () => {
    const ctx = createMockCtx({ message: { text: undefined } });
    await handleCrewInbound(ctx as never, "sam", "co-crew-sam");
    expect(execMock).not.toHaveBeenCalled();
  });

  test("escapes XML in crew messages", async () => {
    const ctx = createMockCtx({ message: { text: "<script>xss</script>" } });
    await handleCrewInbound(ctx as never, "sam", "co-crew-sam");
    const stdin = getCall(0)[2].stdin;
    expect(stdin).toContain("&lt;script&gt;");
    expect(stdin).not.toContain("<script>");
  });
});

describe("handleMailInboxInbound", () => {
  beforeEach(() => {
    execMock.mockClear();
  });

  test("rejects standalone messages (no reply-to)", async () => {
    const ctx = createMockCtx({
      message: { text: "hello", reply_to_message: undefined },
    });
    await handleMailInboxInbound(ctx as never);
    expect(ctx.reply).toHaveBeenCalledWith(
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
    expect(ctx.reply).toHaveBeenCalledWith(
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
    expect(ctx.reply).toHaveBeenCalledWith(
      "Failed to send reply to mail mail-ghi.",
    );
  });
});

describe("handleEscalationReaction", () => {
  beforeEach(() => {
    execMock.mockClear();
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
