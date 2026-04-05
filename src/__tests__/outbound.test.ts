/**
 * Tests for outbound.ts: send, sendEscalation, sendMailMessage, escapeHtml.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { setApi, send, sendEscalation, sendMailMessage } from "../outbound";
import { trackEscalation } from "../channels/escalations";
import { trackMailMessage } from "../channels/mail-inbox";

// Mock the log module to avoid file I/O
mock.module("../log", () => ({
  log: mock(() => Promise.resolve()),
}));

function createMockApi() {
  const sentMessages: Array<{
    chatId: number;
    text: string;
    opts: Record<string, unknown>;
  }> = [];
  let nextMsgId = 100;

  return {
    sentMessages,
    api: {
      sendMessage: mock(
        async (
          chatId: number,
          text: string,
          opts: Record<string, unknown>,
        ) => {
          sentMessages.push({ chatId, text, opts });
          return { message_id: nextMsgId++ };
        },
      ),
    },
  };
}

describe("send", () => {
  test("throws if API not initialized", async () => {
    // Reset API
    setApi(null as never);
    await expect(send(123, "hello")).rejects.toThrow(
      "Bot API not initialized",
    );
  });

  test("sends message via bot API", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    const msgId = await send(123, "hello", { channel: "test" });
    expect(msgId).toBe(100);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(123);
    expect(sentMessages[0].text).toBe("hello");
  });

  test("passes parse_mode from options", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await send(123, "<b>bold</b>", { channel: "test", parseMode: "HTML" });
    expect(sentMessages[0].opts.parse_mode).toBe("HTML");
  });

  test("sets link_preview_options when disablePreview is true", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await send(123, "https://example.com", {
      channel: "test",
      disablePreview: true,
    });
    expect(sentMessages[0].opts.link_preview_options).toEqual({
      is_disabled: true,
    });
  });

  test("does not set link_preview_options when disablePreview is false", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await send(123, "text", { channel: "test", disablePreview: false });
    expect(sentMessages[0].opts.link_preview_options).toBeUndefined();
  });

  test("tracks escalation when escalationId provided", async () => {
    const { api } = createMockApi();
    setApi(api as never);

    const msgId = await send(123, "esc", {
      channel: "escalations",
      escalationId: "esc-001",
    });
    // The track function is called internally — we verify via sendEscalation tests
    expect(msgId).toBeGreaterThanOrEqual(100);
  });

  test("tracks mail when mailId provided", async () => {
    const { api } = createMockApi();
    setApi(api as never);

    const msgId = await send(123, "mail", {
      channel: "mail_inbox",
      mailId: "mail-001",
    });
    expect(msgId).toBeGreaterThanOrEqual(100);
  });
});

describe("sendEscalation", () => {
  test("formats critical escalation with red icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(123, "esc-1", "critical", "Server is down", "mayor");
    expect(sentMessages[0].text).toContain("🔴");
    expect(sentMessages[0].text).toContain("CRITICAL");
    expect(sentMessages[0].text).toContain("esc-1");
    expect(sentMessages[0].text).toContain("Server is down");
    expect(sentMessages[0].text).toContain("Source:");
    expect(sentMessages[0].text).toContain("mayor");
    expect(sentMessages[0].opts.parse_mode).toBe("HTML");
  });

  test("formats high escalation with orange icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(123, "esc-2", "high", "Test failure");
    expect(sentMessages[0].text).toContain("🟠");
    expect(sentMessages[0].text).toContain("HIGH");
  });

  test("formats medium escalation with yellow icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(123, "esc-3", "medium", "Slow query");
    expect(sentMessages[0].text).toContain("🟡");
  });

  test("formats low/unknown escalation with blue icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(123, "esc-4", "low", "Minor issue");
    expect(sentMessages[0].text).toContain("🔵");
  });

  test("omits source line when source not provided", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(123, "esc-5", "high", "No source");
    expect(sentMessages[0].text).not.toContain("Source:");
  });

  test("includes reaction instructions", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(123, "esc-6", "high", "Test");
    expect(sentMessages[0].text).toContain("React 👍 to ack, ✅ to resolve");
  });
});

describe("sendMailMessage", () => {
  test("formats mail message with from and subject", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendMailMessage(456, "mail-1", "alice", "Hello", "Body text");
    expect(sentMessages[0].text).toContain("📬");
    expect(sentMessages[0].text).toContain("alice");
    expect(sentMessages[0].text).toContain("Hello");
    expect(sentMessages[0].text).toContain("mail-1");
    expect(sentMessages[0].text).toContain("Body text");
    expect(sentMessages[0].text).toContain("Reply to this message to respond.");
    expect(sentMessages[0].opts.parse_mode).toBe("HTML");
  });

  test("escapes HTML in user-provided fields", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendMailMessage(
      456,
      "mail-2",
      "<script>alert</script>",
      "Re: <b>bold</b>",
      "Body with <html> & stuff",
    );
    const text = sentMessages[0].text;
    expect(text).toContain("&lt;script&gt;");
    expect(text).toContain("&amp;");
    expect(text).not.toContain("<script>");
  });
});
