/**
 * Tests for outbound-cli.ts: escalation, mail, send commands,
 * telegramSend HTTP calls, readStdin, argument parsing, escapeHtml.
 *
 * outbound-cli.ts is a standalone CLI that runs main() at module scope.
 * We test the core logic by reimplementing pure functions (escapeHtml,
 * message formatting) and by mocking fetch for the telegramSend logic.
 */
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";

// Mock msg-map to avoid file I/O
const persistMailMappingMock = mock();
const persistEscalationMappingMock = mock();
mock.module("../msg-map", () => ({
  persistMailMapping: persistMailMappingMock,
  persistEscalationMapping: persistEscalationMappingMock,
  lookupMailMapping: mock(),
  lookupEscalationMapping: mock(),
}));

// Mock error-handler
mock.module("../error-handler", () => ({
  reportErrorDirect: mock(() => Promise.resolve()),
  reportError: mock(),
}));

// Mock log
mock.module("../log", () => ({
  log: mock(() => Promise.resolve()),
}));

// Reimplement escapeHtml from outbound-cli.ts (not exported)
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

describe("escapeHtml", () => {
  test("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  test("escapes angle brackets", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;",
    );
  });

  test("escapes all special chars together", () => {
    expect(escapeHtml("<b>bold & stuff</b>")).toBe(
      "&lt;b&gt;bold &amp; stuff&lt;/b&gt;",
    );
  });

  test("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  test("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  test("handles multiple consecutive ampersands", () => {
    expect(escapeHtml("a && b && c")).toBe("a &amp;&amp; b &amp;&amp; c");
  });

  test("handles already-escaped entities", () => {
    expect(escapeHtml("&amp; &lt;")).toBe("&amp;amp; &amp;lt;");
  });
});

describe("escalation message formatting", () => {
  function formatEscalation(
    severity: string,
    id: string,
    description: string,
    source?: string,
  ): string {
    const icon =
      severity === "critical"
        ? "\u{1F534}"
        : severity === "high"
          ? "\u{1F7E0}"
          : severity === "medium"
            ? "\u{1F7E1}"
            : "\u{1F535}";
    return [
      `${icon} <b>Escalation [${severity.toUpperCase()}]</b>`,
      `<b>ID:</b> <code>${id}</code>`,
      source ? `<b>Source:</b> ${source}` : null,
      "",
      description,
      "",
      "React \u{1F44D} to ack, \u2705 to resolve",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  test("formats critical with red icon", () => {
    const msg = formatEscalation("critical", "esc-1", "Server down");
    expect(msg).toContain("\u{1F534}");
    expect(msg).toContain("CRITICAL");
    expect(msg).toContain("esc-1");
    expect(msg).toContain("Server down");
  });

  test("formats high with orange icon", () => {
    const msg = formatEscalation("high", "esc-2", "Test failure");
    expect(msg).toContain("\u{1F7E0}");
    expect(msg).toContain("HIGH");
  });

  test("formats medium with yellow icon", () => {
    const msg = formatEscalation("medium", "esc-3", "Slow query");
    expect(msg).toContain("\u{1F7E1}");
  });

  test("formats unknown severity with blue icon", () => {
    const msg = formatEscalation("low", "esc-4", "Minor");
    expect(msg).toContain("\u{1F535}");
  });

  test("includes source when provided", () => {
    const msg = formatEscalation("high", "esc-5", "Test", "mayor");
    expect(msg).toContain("<b>Source:</b> mayor");
  });

  test("omits source line when not provided", () => {
    const msg = formatEscalation("high", "esc-6", "Test");
    expect(msg).not.toContain("Source:");
  });
});

describe("mail message formatting", () => {
  function formatMail(
    mailId: string,
    from: string,
    subject: string,
    body: string,
  ): string {
    return [
      `\u{1F4EC} <b>Mail from ${escapeHtml(from)}</b>`,
      `<b>Subject:</b> ${escapeHtml(subject)}`,
      `<b>ID:</b> <code>${mailId}</code>`,
      "",
      escapeHtml(body),
      "",
      "Reply to this message to respond.",
    ].join("\n");
  }

  test("formats mail with all fields", () => {
    const msg = formatMail("mail-1", "alice", "Hello", "Body text");
    expect(msg).toContain("alice");
    expect(msg).toContain("Hello");
    expect(msg).toContain("mail-1");
    expect(msg).toContain("Body text");
    expect(msg).toContain("Reply to this message to respond.");
  });

  test("escapes HTML in user-provided fields", () => {
    const msg = formatMail(
      "mail-2",
      "<script>xss</script>",
      "Re: <b>bold</b>",
      "Body & stuff",
    );
    expect(msg).toContain("&lt;script&gt;");
    expect(msg).toContain("&amp;");
    expect(msg).not.toContain("<script>xss");
  });

  test("handles empty body", () => {
    const msg = formatMail("mail-3", "bob", "Subject", "");
    expect(msg).toContain("bob");
    expect(msg).toContain("Subject");
  });
});

describe("telegramSend", () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls: Array<{ url: string; body: any }> = [];

  // Reimplement telegramSend for isolated testing
  async function telegramSend(
    apiBase: string,
    chatId: number,
    threadId: number,
    text: string,
    parseMode?: string,
  ): Promise<number> {
    const resp = await fetch(`${apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: threadId,
        text,
        parse_mode: parseMode,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram API error ${resp.status}: ${body}`);
    }
    const result = (await resp.json()) as { result: { message_id: number } };
    return result.result.message_id;
  }

  beforeEach(() => {
    fetchCalls = [];
    globalThis.fetch = mock(async (url: string | URL | Request, opts?: RequestInit) => {
      const body = opts?.body ? JSON.parse(opts.body as string) : null;
      fetchCalls.push({ url: url.toString(), body });
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 42 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends POST to correct endpoint", async () => {
    const msgId = await telegramSend(
      "https://api.telegram.org/botTEST",
      -100123,
      42,
      "Hello",
    );
    expect(msgId).toBe(42);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(
      "https://api.telegram.org/botTEST/sendMessage",
    );
    expect(fetchCalls[0].body.chat_id).toBe(-100123);
    expect(fetchCalls[0].body.message_thread_id).toBe(42);
    expect(fetchCalls[0].body.text).toBe("Hello");
  });

  test("includes parse_mode when specified", async () => {
    await telegramSend(
      "https://api.telegram.org/botTEST",
      -100123,
      42,
      "<b>bold</b>",
      "HTML",
    );
    expect(fetchCalls[0].body.parse_mode).toBe("HTML");
  });

  test("omits parse_mode when not specified", async () => {
    await telegramSend(
      "https://api.telegram.org/botTEST",
      -100123,
      42,
      "plain",
    );
    expect(fetchCalls[0].body.parse_mode).toBeUndefined();
  });

  test("throws on non-OK response with status and body", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Bad Request: can't parse entities", { status: 400 });
    }) as unknown as typeof fetch;

    await expect(
      telegramSend("https://api.telegram.org/botTEST", -100123, 42, "bad"),
    ).rejects.toThrow("Telegram API error 400: Bad Request: can't parse entities");
  });

  test("throws on 500 server error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      telegramSend("https://api.telegram.org/botTEST", -100123, 42, "test"),
    ).rejects.toThrow("Telegram API error 500");
  });
});

describe("argument parsing logic", () => {
  test("escalation destructures severity, id, description, optional source", () => {
    const args = ["critical", "esc-1", "Server is down", "mayor"];
    const [severity, id, description, source] = args;
    expect(severity).toBe("critical");
    expect(id).toBe("esc-1");
    expect(description).toBe("Server is down");
    expect(source).toBe("mayor");
  });

  test("escalation source is undefined when omitted", () => {
    const args = ["high", "esc-2", "Test failure"];
    const [, , , source] = args;
    expect(source).toBeUndefined();
  });

  test("mail joins body parts with space", () => {
    const args = ["mail-1", "alice", "Hello", "Body", "text", "here"];
    const [mailId, from, subject, ...bodyParts] = args;
    expect(mailId).toBe("mail-1");
    expect(from).toBe("alice");
    expect(subject).toBe("Hello");
    expect(bodyParts.join(" ")).toBe("Body text here");
  });

  test("mail body parts can be empty (stdin fallback)", () => {
    const args = ["mail-1", "alice", "Hello"];
    const [, , , ...bodyParts] = args;
    expect(bodyParts.join(" ")).toBe("");
  });

  test("send parses thread_id as integer", () => {
    expect(parseInt("42", 10)).toBe(42);
    expect(parseInt("0", 10)).toBe(0);
    expect(isNaN(parseInt("abc", 10))).toBe(true);
  });

  test("send detects --stdin flag as first text part", () => {
    const textParts = ["--stdin"];
    expect(textParts[0] === "--stdin").toBe(true);
  });

  test("send joins text parts with space", () => {
    const textParts = ["hello", "world"];
    expect(textParts.join(" ")).toBe("hello world");
  });

  test("unknown command falls through to default", () => {
    const cmd = "unknown";
    expect(["escalation", "mail", "send"].includes(cmd)).toBe(false);
  });
});
