/**
 * Integration tests: agent-log watcher with real JSONL files on disk.
 *
 * These tests write real JSONL files, start the watcher's poll loop, and
 * verify that assistant messages are extracted, converted to HTML, and
 * sent via the Telegram API. Only the Telegram API, exec, and config are mocked.
 *
 * Tests the full pipeline:
 *   JSONL on disk → file discovery → offset tracking → JSONL parsing
 *   → assistant text extraction → GFM→HTML conversion → Telegram send
 */
import {
  describe,
  expect,
  test,
  mock,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "bun:test";
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// --- Test constants ---

const TEST_PROJECT_DIR = `integ-test-${Date.now()}`;
const JSONL_DIR = join(homedir(), ".claude", "projects", TEST_PROJECT_DIR);
const TEST_CHAT_ID = -1001234567890;
const TEST_THREAD_ID = 100;

// --- Mocks (must be before module imports) ---

mock.module("../../exec", () => ({
  exec: mock(() => Promise.resolve("ok")),
}));

mock.module("../../log", () => ({
  log: mock(() => Promise.resolve()),
}));

mock.module("../../msg-map", () => ({
  persistMailMapping: mock(),
  lookupMailMapping: mock(),
  persistEscalationMapping: mock(),
  lookupEscalationMapping: mock(),
}));

// Mock config to point agent_log to our test directory
mock.module("../../config", () => ({
  env: { telegramBotToken: "test-token-integ", logDir: "/tmp/controlle-integ" },
  gateway: {
    supergroup_chat_id: TEST_CHAT_ID,
    topics: {
      "test-agent": {
        thread_id: TEST_THREAD_ID,
        session: "test-session",
        agent_log: true,
        project_dir: TEST_PROJECT_DIR,
      },
      escalations: { thread_id: 200 },
    },
  },
  resolveChannel: () => undefined,
  supergroupChatId: () => TEST_CHAT_ID,
  agentLogChannels: () => [
    {
      threadId: TEST_THREAD_ID,
      session: "test-session",
      projectDir: TEST_PROJECT_DIR,
      label: "test-agent",
    },
  ],
  resolveSessionForSource: () => undefined,
}));

// --- Imports (after mocks) ---

import {
  extractAssistantText,
  startAgentLogWatcher,
  stopAgentLogWatcher,
} from "../../agent-log-watcher";
import { setApi } from "../../outbound";

// --- Test helpers ---

interface SendCall {
  chatId: number;
  text: string;
  opts: Record<string, unknown>;
}

const sendCalls: SendCall[] = [];
let nextMsgId = 2000;

function createMockApi() {
  return {
    sendMessage: mock(
      async (chatId: number, text: string, opts: Record<string, unknown>) => {
        sendCalls.push({ chatId, text, opts });
        return { message_id: nextMsgId++, entities: [] };
      },
    ),
  };
}

function assistantJsonl(text: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
    },
  });
}

function assistantJsonlMultiBlock(texts: string[]): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: texts.map((t) => ({ type: "text", text: t })),
    },
  });
}

function toolUseJsonl(): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tool_1", name: "Bash", input: { command: "ls" } }],
    },
  });
}

function systemJsonl(): string {
  return JSON.stringify({ type: "system", message: "Session started" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Setup ---

beforeAll(() => {
  mkdirSync(JSONL_DIR, { recursive: true });

  // Set up mock API through outbound module (not through grammy transformer)
  const mockApi = createMockApi();
  setApi(mockApi as never);
});

beforeEach(() => {
  sendCalls.length = 0;
  nextMsgId = 2000;
});

afterEach(() => {
  stopAgentLogWatcher();
});

afterAll(() => {
  rmSync(JSONL_DIR, { recursive: true, force: true });
});

// ─── extractAssistantText (pure function, no I/O) ────────────────────

describe("integration: extractAssistantText", () => {
  test("extracts text from valid assistant event", () => {
    const line = assistantJsonl("Hello from the agent");
    expect(extractAssistantText(line)).toBe("Hello from the agent");
  });

  test("joins multiple text blocks with newline", () => {
    const line = assistantJsonlMultiBlock(["First paragraph", "Second paragraph"]);
    expect(extractAssistantText(line)).toBe("First paragraph\nSecond paragraph");
  });

  test("returns null for tool_use only events", () => {
    expect(extractAssistantText(toolUseJsonl())).toBeNull();
  });

  test("returns null for system events", () => {
    expect(extractAssistantText(systemJsonl())).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(extractAssistantText("not json at all")).toBeNull();
    expect(extractAssistantText("{broken")).toBeNull();
  });

  test("returns null for empty content array", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [] },
    });
    expect(extractAssistantText(line)).toBeNull();
  });
});

// ─── Watcher with real JSONL files ───────────────────────────────────

describe("integration: agent-log watcher with real files", () => {
  test("picks up new assistant messages appended to JSONL", async () => {
    const jsonlPath = join(JSONL_DIR, "session-pick-up.jsonl");
    writeFileSync(jsonlPath, systemJsonl() + "\n");

    startAgentLogWatcher();
    // Wait for first poll to discover file and seek to end
    await sleep(2500);

    // Append after watcher initialized — only new content is read
    appendFileSync(jsonlPath, assistantJsonl("Integration test message") + "\n");
    await sleep(2500);

    const sent = sendCalls.find((c) => c.text.includes("Integration test message"));
    expect(sent).toBeDefined();
    // Should target the correct thread_id
    expect(sent!.opts.message_thread_id).toBe(TEST_THREAD_ID);
  }, 10_000);

  test("converts GFM to HTML before sending", async () => {
    const jsonlPath = join(JSONL_DIR, "session-gfm.jsonl");
    writeFileSync(jsonlPath, systemJsonl() + "\n");

    startAgentLogWatcher();
    await sleep(2500);

    appendFileSync(
      jsonlPath,
      assistantJsonl("Check **this** and `that code`") + "\n",
    );
    await sleep(2500);

    const sent = sendCalls.find((c) => c.text.includes("<b>this</b>"));
    expect(sent).toBeDefined();
    expect(sent!.text).toContain("<code>that code</code>");
    expect(sent!.opts.parse_mode).toBe("HTML");
  }, 10_000);

  test("skips non-assistant events", async () => {
    const jsonlPath = join(JSONL_DIR, "session-skip.jsonl");
    writeFileSync(jsonlPath, systemJsonl() + "\n");

    startAgentLogWatcher();
    await sleep(2500);

    appendFileSync(jsonlPath, systemJsonl() + "\n");
    appendFileSync(jsonlPath, toolUseJsonl() + "\n");
    await sleep(2500);

    expect(sendCalls.length).toBe(0);
  }, 10_000);

  test("handles multiple assistant messages in rapid succession", async () => {
    const jsonlPath = join(JSONL_DIR, "session-multi.jsonl");
    writeFileSync(jsonlPath, systemJsonl() + "\n");

    startAgentLogWatcher();
    await sleep(2500);

    appendFileSync(jsonlPath, assistantJsonl("Message one") + "\n");
    appendFileSync(jsonlPath, assistantJsonl("Message two") + "\n");
    appendFileSync(jsonlPath, assistantJsonl("Message three") + "\n");
    await sleep(2500);

    const texts = sendCalls.map((c) => c.text);
    expect(texts.some((t) => t.includes("Message one"))).toBe(true);
    expect(texts.some((t) => t.includes("Message two"))).toBe(true);
    expect(texts.some((t) => t.includes("Message three"))).toBe(true);
  }, 10_000);

  test("skips malformed JSON lines gracefully", async () => {
    const jsonlPath = join(JSONL_DIR, "session-malformed.jsonl");
    writeFileSync(jsonlPath, systemJsonl() + "\n");

    startAgentLogWatcher();
    await sleep(2500);

    appendFileSync(jsonlPath, "{ broken json here\n");
    appendFileSync(jsonlPath, assistantJsonl("After the bad line") + "\n");
    await sleep(2500);

    const sent = sendCalls.find((c) => c.text.includes("After the bad line"));
    expect(sent).toBeDefined();
  }, 10_000);

  test("disables link previews for agent-log messages", async () => {
    const jsonlPath = join(JSONL_DIR, "session-links.jsonl");
    writeFileSync(jsonlPath, systemJsonl() + "\n");

    startAgentLogWatcher();
    await sleep(2500);

    appendFileSync(
      jsonlPath,
      assistantJsonl("Check https://example.com for details") + "\n",
    );
    await sleep(2500);

    const sent = sendCalls.find((c) => c.text.includes("example.com"));
    expect(sent).toBeDefined();
    expect(sent!.opts.link_preview_options).toEqual({ is_disabled: true });
  }, 10_000);
});
