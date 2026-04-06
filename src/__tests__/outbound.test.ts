/**
 * Tests for outbound.ts: send, sendEscalation, sendMailMessage, escapeHtml.
 *
 * send() now targets a forum topic (threadId) within the single supergroup.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import {
  setApi,
  send,
  sendEscalation,
  sendMailMessage,
  escapeMarkdownV2,
  sendWithMarkdownFallback,
} from "../outbound";
import { supergroupChatId } from "../config";

// Mock the log module to avoid file I/O
mock.module("../log", () => ({
  log: mock(() => Promise.resolve()),
}));

// Mock msg-map to avoid file I/O
mock.module("../msg-map", () => ({
  persistMailMapping: mock(),
  lookupMailMapping: mock(),
  persistEscalationMapping: mock(),
  lookupEscalationMapping: mock(),
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

  test("sends message to supergroup with message_thread_id", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    const msgId = await send(42, "hello", { channel: "test" });
    expect(msgId).toBe(100);
    expect(sentMessages).toHaveLength(1);
    // Should send to the supergroup chat_id, not the threadId
    expect(sentMessages[0].chatId).toBe(supergroupChatId());
    expect(sentMessages[0].text).toBe("hello");
    // Thread ID should be passed as message_thread_id
    expect(sentMessages[0].opts.message_thread_id).toBe(42);
  });

  test("passes parse_mode from options", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await send(42, "<b>bold</b>", { channel: "test", parseMode: "HTML" });
    expect(sentMessages[0].opts.parse_mode).toBe("HTML");
  });

  test("sets link_preview_options when disablePreview is true", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await send(42, "https://example.com", {
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

    await send(42, "text", { channel: "test", disablePreview: false });
    expect(sentMessages[0].opts.link_preview_options).toBeUndefined();
  });

  test("tracks escalation when escalationId provided", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    const msgId = await send(42, "esc", {
      channel: "escalations",
      escalationId: "esc-001",
    });
    expect(msgId).toBe(100);
    // Verify the message was actually sent
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe("esc");
  });

  test("tracks mail when mailId provided", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    const msgId = await send(42, "mail", {
      channel: "mail_inbox",
      mailId: "mail-001",
    });
    expect(msgId).toBe(100);
    // Verify the message was actually sent
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe("mail");
  });
});

describe("sendEscalation", () => {
  test("formats critical escalation with red icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(42, "esc-1", "critical", "Server is down", "mayor");
    expect(sentMessages[0].text).toContain("🔴");
    expect(sentMessages[0].text).toContain("CRITICAL");
    expect(sentMessages[0].text).toContain("esc-1");
    expect(sentMessages[0].text).toContain("Server is down");
    expect(sentMessages[0].text).toContain("Source:");
    expect(sentMessages[0].text).toContain("mayor");
    expect(sentMessages[0].opts.parse_mode).toBe("HTML");
    expect(sentMessages[0].opts.message_thread_id).toBe(42);
  });

  test("formats high escalation with orange icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(42, "esc-2", "high", "Test failure");
    expect(sentMessages[0].text).toContain("🟠");
    expect(sentMessages[0].text).toContain("HIGH");
  });

  test("formats medium escalation with yellow icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(42, "esc-3", "medium", "Slow query");
    expect(sentMessages[0].text).toContain("🟡");
  });

  test("formats low/unknown escalation with blue icon", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(42, "esc-4", "low", "Minor issue");
    expect(sentMessages[0].text).toContain("🔵");
  });

  test("omits source line when source not provided", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(42, "esc-5", "high", "No source");
    expect(sentMessages[0].text).not.toContain("Source:");
  });

  test("includes reaction instructions", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendEscalation(42, "esc-6", "high", "Test");
    expect(sentMessages[0].text).toContain("React 👍 to ack, ✅ to resolve");
  });
});

describe("sendMailMessage", () => {
  test("formats mail message with from and subject", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendMailMessage(42, "mail-1", "alice", "Hello", "Body text");
    expect(sentMessages[0].text).toContain("📬");
    expect(sentMessages[0].text).toContain("alice");
    expect(sentMessages[0].text).toContain("Hello");
    expect(sentMessages[0].text).toContain("mail-1");
    expect(sentMessages[0].text).toContain("Body text");
    expect(sentMessages[0].text).toContain("Reply to this message to respond.");
    expect(sentMessages[0].opts.parse_mode).toBe("HTML");
    expect(sentMessages[0].opts.message_thread_id).toBe(42);
  });

  test("escapes HTML in user-provided fields", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendMailMessage(
      42,
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

describe("escapeMarkdownV2", () => {
  test("escapes all MarkdownV2 special characters", () => {
    const input = "hello_world *bold* [link](url) ~strike~ `code` >quote #tag +plus -dash =eq |pipe {brace} .dot !bang";
    const result = escapeMarkdownV2(input);
    expect(result).toBe(
      "hello\\_world \\*bold\\* \\[link\\]\\(url\\) \\~strike\\~ \\`code\\` \\>quote \\#tag \\+plus \\-dash \\=eq \\|pipe \\{brace\\} \\.dot \\!bang",
    );
  });

  test("returns plain text unchanged", () => {
    expect(escapeMarkdownV2("hello world")).toBe("hello world");
  });

  test("escapes backslashes", () => {
    expect(escapeMarkdownV2("path\\to\\file")).toBe("path\\\\to\\\\file");
  });
});

describe("sendWithMarkdownFallback", () => {
  test("sends with MarkdownV2 when it succeeds", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendWithMarkdownFallback(42, "hello_world", { channel: "test" });
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe("hello\\_world");
    expect(sentMessages[0].opts.parse_mode).toBe("MarkdownV2");
  });

  test("falls back to plain text on 400 error", async () => {
    let callCount = 0;
    const sentMessages: Array<{
      chatId: number;
      text: string;
      opts: Record<string, unknown>;
    }> = [];

    const api = {
      sendMessage: mock(
        async (
          chatId: number,
          text: string,
          opts: Record<string, unknown>,
        ) => {
          callCount++;
          if (callCount === 1 && opts.parse_mode === "MarkdownV2") {
            // Import GrammyError to throw a proper error
            const { GrammyError } = await import("grammy");
            throw new GrammyError(
              "Bad Request: can't parse entities",
              { ok: false, error_code: 400, description: "Bad Request: can't parse entities" },
              "sendMessage",
              { chat_id: chatId, text },
            );
          }
          sentMessages.push({ chatId, text, opts });
          return { message_id: 100 };
        },
      ),
    };
    setApi(api as never);

    const msgId = await sendWithMarkdownFallback(42, "bad *markdown", {
      channel: "test",
    });
    expect(msgId).toBe(100);
    // Should have tried MarkdownV2 first (failed), then plain text
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe("bad *markdown"); // original unescaped text
    expect(sentMessages[0].opts.parse_mode).toBeUndefined();
  });

  test("re-throws non-400 errors", async () => {
    const api = {
      sendMessage: mock(async () => {
        const { GrammyError } = await import("grammy");
        throw new GrammyError(
          "Forbidden",
          { ok: false, error_code: 403, description: "Forbidden" },
          "sendMessage",
          {},
        );
      }),
    };
    setApi(api as never);

    await expect(
      sendWithMarkdownFallback(42, "text", { channel: "test" }),
    ).rejects.toThrow("Forbidden");
  });

  test("preserves disablePreview option through fallback", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);

    await sendWithMarkdownFallback(42, "text", {
      channel: "test",
      disablePreview: true,
    });
    expect(sentMessages[0].opts.link_preview_options).toEqual({
      is_disabled: true,
    });
  });
});
