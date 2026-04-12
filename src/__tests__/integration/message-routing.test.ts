/**
 * Integration tests: end-to-end message routing through the bot pipeline.
 *
 * These tests use bot.handleUpdate() to feed raw Telegram Update objects
 * through the full grammy middleware stack (dedup → routing → channel handler
 * → exec → reaction/reply). Only external boundaries are mocked:
 *   - exec: captures shell commands without running them
 *   - log: avoids file I/O
 *   - Telegram API: intercepted via grammy transformer
 *
 * Everything else is real: config resolution, channel handlers, XML wrapping,
 * retry logic, error handler routing, markdown conversion.
 */
import { describe, expect, test, mock, beforeEach, beforeAll, afterAll } from "bun:test";

// --- Mocks (must be before module imports) ---

const execCalls: Array<{ cmd: string; args: string[]; opts?: Record<string, unknown> }> = [];
let execBehavior: (() => Promise<string>) | null = null;

mock.module("../../exec", () => ({
  exec: mock(async (cmd: string, args: string[], opts?: Record<string, unknown>) => {
    execCalls.push({ cmd, args, opts });
    if (execBehavior) return execBehavior();
    return "ok";
  }),
}));

mock.module("../../log", () => ({
  log: mock(() => Promise.resolve()),
}));

// In-memory msg-map (shared between bot instance and channel handlers)
const testMailMap = new Map<string, string>();
const testEscMap = new Map<string, string>();

mock.module("../../msg-map", () => ({
  persistMailMapping: mock((id: number, mailId: string) => {
    testMailMap.set(String(id), mailId);
  }),
  lookupMailMapping: mock((id: number) => testMailMap.get(String(id))),
  persistEscalationMapping: mock((id: number, escId: string) => {
    testEscMap.set(String(id), escId);
  }),
  lookupEscalationMapping: mock((id: number) => testEscMap.get(String(id))),
}));

// --- Imports (after mocks) ---

import { createBot } from "../../telegram";
import { retryConfig } from "../../channels/agent";
import { trackMailMessage } from "../../channels/mail-inbox";
import { trackEscalation } from "../../channels/escalations";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";

// --- Test constants ---

const CHAT_ID = -1001234567890; // matches gateway.config.example.json
const AGENT_THREAD_ID = 1;      // "mayor" topic
const ESCALATIONS_THREAD_ID = 2;
const MAIL_THREAD_ID = 3;
const CREW_THREAD_ID = 4;       // "crew/sam" topic

// --- API call capture ---

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

const apiCalls: ApiCall[] = [];
let nextMsgId = 1000;

// --- Update builders ---

let updateIdCounter = 100_000;

// grammy's Update type is very strict about Telegram API shapes.
// Integration tests only need the fields the code actually reads,
// so we cast partial objects to Update.

function textUpdate(
  threadId: number,
  text: string,
  opts: {
    chatId?: number;
    from?: { id: number; is_bot: boolean; first_name: string; username?: string };
    messageId?: number;
    replyTo?: { message_id: number; text?: string };
    quote?: { text: string };
  } = {},
): Update {
  const updateId = updateIdCounter++;
  const msgId = opts.messageId ?? updateIdCounter++;
  return {
    update_id: updateId,
    message: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId ?? CHAT_ID, type: "supergroup", title: "Test" },
      from: opts.from ?? { id: 42, is_bot: false, first_name: "Dave", username: "dave" },
      text,
      message_thread_id: threadId,
      reply_to_message: opts.replyTo
        ? { ...opts.replyTo, date: 0, chat: { id: CHAT_ID, type: "supergroup" as const, title: "Test" } }
        : undefined,
      ...(opts.quote ? { quote: opts.quote } : {}),
    },
  } as Update;
}

function reactionUpdate(
  msgId: number,
  emojis: string[],
  opts: {
    chatId?: number;
    from?: { id: number; is_bot: boolean; first_name: string; username?: string };
  } = {},
): Update {
  return {
    update_id: updateIdCounter++,
    message_reaction: {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: opts.chatId ?? CHAT_ID, type: "supergroup", title: "Test" },
      user: opts.from ?? { id: 42, is_bot: false, first_name: "Dave", username: "dave" },
      old_reaction: [],
      new_reaction: emojis.map((e) => ({ type: "emoji" as const, emoji: e })),
    },
  } as Update;
}

// --- Bot setup ---

let bot: Bot;

beforeAll(() => {
  bot = createBot();

  // grammy requires botInfo before handleUpdate() can process updates.
  // Cast needed: test only provides fields the code uses.
  bot.botInfo = {
    id: 123456,
    is_bot: true,
    first_name: "ControlleBot",
    username: "controlle_bot",
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as typeof bot.botInfo;

  // Intercept all Telegram API calls via grammy transformer.
  // grammy's callApi checks data.ok and returns data.result,
  // so we must return { ok: true, result: <actual response> }.
  bot.api.config.use((async (_prev: unknown, method: string, payload: unknown) => {
    apiCalls.push({ method, payload: { ...(payload as Record<string, unknown>) } });

    if (method === "sendMessage") {
      return {
        ok: true,
        result: {
          message_id: nextMsgId++,
          date: Math.floor(Date.now() / 1000),
          chat: { id: CHAT_ID, type: "supergroup", title: "Test" },
          text: (payload as Record<string, unknown>).text ?? "",
        },
      };
    }
    // All other methods (setMessageReaction, etc.)
    return { ok: true, result: true };
  }) as Parameters<typeof bot.api.config.use>[0]);
});

beforeEach(() => {
  execCalls.length = 0;
  apiCalls.length = 0;
  execBehavior = null;
  nextMsgId = 1000;
  retryConfig.delayMs = 0;
});

afterAll(() => {
  retryConfig.delayMs = 2000;
});

// ─── Agent message routing ───────────────────────────────────────────

describe("integration: agent message routing", () => {
  test("routes message to agent via gt nudge with correct XML payload", async () => {
    const update = textUpdate(AGENT_THREAD_ID, "check status please");
    await bot.handleUpdate(update);

    // Should exec gt nudge with XML-wrapped message
    const nudge = execCalls.find((c) => c.cmd === "gt" && c.args[0] === "nudge");
    expect(nudge).toBeDefined();
    expect(nudge!.args[1]).toBe("hq-mayor"); // session from config
    expect(nudge!.args).toContain("--stdin");
    expect(nudge!.opts?.stdin).toContain("<telegram>");
    expect(nudge!.opts?.stdin).toContain("check status please");
    expect(nudge!.opts?.stdin).toContain('from="dave"');
    expect(nudge!.opts?.stdin).toContain("<ack-cmd>bin/tg-ack");
    expect(nudge!.opts?.stdin).toContain("</telegram>");
  });

  test("sets pending then success reactions through API", async () => {
    const update = textUpdate(AGENT_THREAD_ID, "hello agent");
    await bot.handleUpdate(update);

    const reactions = apiCalls.filter((c) => c.method === "setMessageReaction");
    expect(reactions.length).toBe(2);
    // First: pending (👀), second: success (👍)
    const firstEmoji = (reactions[0].payload as Record<string, unknown>).reaction;
    const secondEmoji = (reactions[1].payload as Record<string, unknown>).reaction;
    expect(firstEmoji).toEqual([{ type: "emoji", emoji: "👀" }]);
    expect(secondEmoji).toEqual([{ type: "emoji", emoji: "👍" }]);
  });

  test("includes reply_to and reply-context for real replies", async () => {
    const update = textUpdate(AGENT_THREAD_ID, "my reply", {
      replyTo: { message_id: 555, text: "original text" },
    });
    await bot.handleUpdate(update);

    const nudge = execCalls.find((c) => c.cmd === "gt" && c.args[0] === "nudge");
    const stdin = nudge!.opts?.stdin as string;
    expect(stdin).toContain('reply_to="555"');
    expect(stdin).toContain("<reply-context>original text</reply-context>");
  });

  test("includes quote text when Telegram quote feature is used", async () => {
    const update = textUpdate(AGENT_THREAD_ID, "about this part", {
      replyTo: { message_id: 556, text: "full original message" },
      quote: { text: "selected portion" },
    });
    await bot.handleUpdate(update);

    const nudge = execCalls.find((c) => c.cmd === "gt" && c.args[0] === "nudge");
    const stdin = nudge!.opts?.stdin as string;
    expect(stdin).toContain("<quote>selected portion</quote>");
    expect(stdin).toContain("<reply-context>full original message</reply-context>");
  });

  test("reacts with failure and replies on exec failure", async () => {
    execBehavior = () => Promise.reject(new Error("agent unreachable"));
    const update = textUpdate(AGENT_THREAD_ID, "hello");
    await bot.handleUpdate(update);

    // Should have retried 3 times
    const nudges = execCalls.filter((c) => c.cmd === "gt" && c.args[0] === "nudge");
    expect(nudges.length).toBe(3);

    // Should react with failure
    const reactions = apiCalls.filter((c) => c.method === "setMessageReaction");
    const lastReaction = reactions[reactions.length - 1];
    expect(lastReaction.payload.reaction).toEqual([{ type: "emoji", emoji: "😢" }]);

    // Should reply with error message
    const replies = apiCalls.filter((c) => c.method === "sendMessage");
    expect(replies.some((r) => (r.payload.text as string).includes("delivery failed"))).toBe(true);
  });

  test("escapes XML special characters in message text", async () => {
    const update = textUpdate(AGENT_THREAD_ID, 'use <b>bold</b> & "quotes"');
    await bot.handleUpdate(update);

    const nudge = execCalls.find((c) => c.cmd === "gt" && c.args[0] === "nudge");
    const stdin = nudge!.opts?.stdin as string;
    expect(stdin).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(stdin).toContain("&amp;");
    expect(stdin).toContain("&quot;quotes&quot;");
    expect(stdin).not.toContain("<b>bold</b>");
  });
});

// ─── Crew topic routing ──────────────────────────────────────────────

describe("integration: crew topic routing", () => {
  test("routes crew topic message to correct session with auto-start check", async () => {
    // The crew topic has rig="controlle", so the handler checks tmux first.
    // Our mock exec returns "ok" for everything, so tmux check passes (session alive)
    // and the nudge goes through without a crew start.
    const update = textUpdate(CREW_THREAD_ID, "hello crew");
    await bot.handleUpdate(update);

    // tmux has-session check
    const tmuxCheck = execCalls.find((c) => c.cmd === "tmux");
    expect(tmuxCheck).toBeDefined();
    expect(tmuxCheck!.args).toEqual(["has-session", "-t", "co-crew-sam"]);

    // nudge with correct session
    const nudge = execCalls.find((c) => c.cmd === "gt" && c.args[0] === "nudge");
    expect(nudge).toBeDefined();
    expect(nudge!.args[1]).toBe("co-crew-sam");
    expect(nudge!.opts?.stdin).toContain("<telegram>");
    expect(nudge!.opts?.stdin).toContain("hello crew");
  });
});

// ─── Escalation topic ────────────────────────────────────────────────

describe("integration: escalation topic", () => {
  test("rejects text messages with instruction to use reactions", async () => {
    const update = textUpdate(ESCALATIONS_THREAD_ID, "what about this?");
    await bot.handleUpdate(update);

    // Should NOT exec anything
    expect(execCalls.length).toBe(0);

    // Should reply with instruction
    const replies = apiCalls.filter((c) => c.method === "sendMessage");
    expect(replies.length).toBe(1);
    expect(replies[0].payload.text).toContain("reactions");
  });

  test("acks escalation on thumbs up reaction", async () => {
    trackEscalation(800, "esc-integ-1");
    const update = reactionUpdate(800, ["👍"]);
    await bot.handleUpdate(update);

    const ack = execCalls.find(
      (c) => c.cmd === "gt" && c.args[0] === "escalate" && c.args[1] === "ack",
    );
    expect(ack).toBeDefined();
    expect(ack!.args[2]).toBe("esc-integ-1");
  });

  test("closes escalation on checkmark reaction", async () => {
    trackEscalation(801, "esc-integ-2");
    const update = reactionUpdate(801, ["✅"], { from: { id: 42, is_bot: false, first_name: "Admin", username: "admin" } });
    await bot.handleUpdate(update);

    const close = execCalls.find(
      (c) => c.cmd === "gt" && c.args[0] === "escalate" && c.args[1] === "close",
    );
    expect(close).toBeDefined();
    expect(close!.args[2]).toBe("esc-integ-2");
    expect(close!.args).toContain("--reason");
    // Reason should include the user who resolved it
    const reasonIdx = close!.args.indexOf("--reason");
    expect(close!.args[reasonIdx + 1]).toContain("admin");
  });

  test("ignores reaction on untracked message", async () => {
    const update = reactionUpdate(99999, ["👍"]);
    await bot.handleUpdate(update);
    expect(execCalls.length).toBe(0);
  });
});

// ─── Mail inbox topic ────────────────────────────────────────────────

describe("integration: mail inbox routing", () => {
  test("routes reply to tracked mail via gt mail reply", async () => {
    trackMailMessage(900, "mail-integ-1");
    const update = textUpdate(MAIL_THREAD_ID, "Thanks, got it!", {
      replyTo: { message_id: 900 },
    });
    await bot.handleUpdate(update);

    const mailReply = execCalls.find(
      (c) => c.cmd === "gt" && c.args[0] === "mail" && c.args[1] === "reply",
    );
    expect(mailReply).toBeDefined();
    expect(mailReply!.args[2]).toBe("mail-integ-1");
    expect(mailReply!.args).toContain("--stdin");
    expect(mailReply!.opts?.stdin).toBe("Thanks, got it!");

    // Should react with success
    const reactions = apiCalls.filter((c) => c.method === "setMessageReaction");
    expect(reactions.some((r) =>
      JSON.stringify(r.payload.reaction) === JSON.stringify([{ type: "emoji", emoji: "👍" }]),
    )).toBe(true);
  });

  test("rejects standalone messages (no reply-to)", async () => {
    const update = textUpdate(MAIL_THREAD_ID, "standalone message");
    await bot.handleUpdate(update);

    expect(execCalls.length).toBe(0);
    const replies = apiCalls.filter((c) => c.method === "sendMessage");
    expect(replies.some((r) => (r.payload.text as string).includes("Reply to a specific message"))).toBe(true);
  });

  test("rejects reply to untracked message", async () => {
    const update = textUpdate(MAIL_THREAD_ID, "reply to unknown", {
      replyTo: { message_id: 77777 },
    });
    await bot.handleUpdate(update);

    expect(execCalls.length).toBe(0);
    const replies = apiCalls.filter((c) => c.method === "sendMessage");
    expect(replies.some((r) => (r.payload.text as string).includes("Could not find"))).toBe(true);
  });
});

// ─── Cross-boundary lifecycle ────────────────────────────────────────

describe("integration: escalation send → track → react → command", () => {
  test("sendEscalation tracks mapping, then reaction triggers ack", async () => {
    // Import sendEscalation which uses real outbound + real tracking
    const { sendEscalation } = await import("../../outbound");

    // Send an escalation — this calls the mocked API and tracks the mapping
    const telegramMsgId = await sendEscalation(
      ESCALATIONS_THREAD_ID,
      "esc-lifecycle-1",
      "high",
      "Test server overloaded",
      "mayor",
    );

    // Verify the escalation was sent via API
    const sends = apiCalls.filter((c) => c.method === "sendMessage");
    expect(sends.length).toBeGreaterThanOrEqual(1);
    const escSend = sends[sends.length - 1];
    expect(escSend.payload.text).toContain("Escalation [HIGH]");
    expect(escSend.payload.text).toContain("esc-lifecycle-1");

    // Now react to the sent message — should trigger ack command
    execCalls.length = 0;
    apiCalls.length = 0;

    const ackUpdate = reactionUpdate(telegramMsgId, ["👍"]);
    await bot.handleUpdate(ackUpdate);

    const ack = execCalls.find(
      (c) => c.cmd === "gt" && c.args[0] === "escalate" && c.args[1] === "ack",
    );
    expect(ack).toBeDefined();
    expect(ack!.args[2]).toBe("esc-lifecycle-1");
  });
});

describe("integration: mail send → track → reply → command", () => {
  test("sendMailMessage tracks mapping, then reply triggers mail reply", async () => {
    const { sendMailMessage } = await import("../../outbound");

    // Send a mail message — tracks mapping
    const telegramMsgId = await sendMailMessage(
      MAIL_THREAD_ID,
      "mail-lifecycle-1",
      "witness",
      "HELP: stuck on build",
      "Can't get tests to pass after refactor.",
    );

    // Verify sent via API
    const sends = apiCalls.filter((c) => c.method === "sendMessage");
    expect(sends.length).toBeGreaterThanOrEqual(1);
    const mailSend = sends[sends.length - 1];
    expect(mailSend.payload.text).toContain("Mail from witness");
    expect(mailSend.payload.text).toContain("mail-lifecycle-1");

    // Now reply to the mail message in Telegram
    execCalls.length = 0;
    apiCalls.length = 0;

    const replyUpdate = textUpdate(MAIL_THREAD_ID, "Try clearing the cache first", {
      replyTo: { message_id: telegramMsgId },
    });
    await bot.handleUpdate(replyUpdate);

    const mailReply = execCalls.find(
      (c) => c.cmd === "gt" && c.args[0] === "mail" && c.args[1] === "reply",
    );
    expect(mailReply).toBeDefined();
    expect(mailReply!.args[2]).toBe("mail-lifecycle-1");
    expect(mailReply!.opts?.stdin).toBe("Try clearing the cache first");
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────

describe("integration: edge cases", () => {
  test("ignores messages from wrong chat", async () => {
    const update = textUpdate(AGENT_THREAD_ID, "wrong chat", { chatId: -999 });
    await bot.handleUpdate(update);
    expect(execCalls.length).toBe(0);
    // No API calls for reactions/replies (message is silently dropped)
    const relevant = apiCalls.filter(
      (c) => c.method === "sendMessage" || c.method === "setMessageReaction",
    );
    expect(relevant.length).toBe(0);
  });

  test("ignores messages from unknown topic", async () => {
    const update = textUpdate(99999, "unknown topic");
    await bot.handleUpdate(update);
    expect(execCalls.length).toBe(0);
  });

  test("ignores messages without thread_id (general topic)", async () => {
    const update = {
      update_id: updateIdCounter++,
      message: {
        message_id: updateIdCounter++,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT_ID, type: "supergroup" as const, title: "Test" },
        from: { id: 42, is_bot: false, first_name: "Dave" },
        text: "general topic message",
        // no message_thread_id
      },
    } as Update;
    await bot.handleUpdate(update);
    expect(execCalls.length).toBe(0);
  });

  test("dedup: second identical update_id is dropped", async () => {
    const update = textUpdate(AGENT_THREAD_ID, "should not duplicate");
    // Handle twice with same update_id
    await bot.handleUpdate(update);
    await bot.handleUpdate(update);

    // Should have only one nudge call (second was deduped)
    const nudges = execCalls.filter((c) => c.cmd === "gt" && c.args[0] === "nudge");
    expect(nudges.length).toBe(1);
  });
});
