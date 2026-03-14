# Test Templates

Standard patterns for testing Controlle modules. Copy the relevant template
when adding new functionality.

## New Channel Handler

```typescript
/**
 * Tests for channels/<name>.ts
 */
import { describe, expect, test, mock, beforeEach } from "bun:test";

// Mock exec before importing the channel module
const execMock = mock(() => Promise.resolve("ok"));
mock.module("../exec", () => ({ exec: execMock }));
mock.module("../log", () => ({ log: mock(() => Promise.resolve()) }));
mock.module("../msg-map", () => ({
  persistMailMapping: mock(),
  lookupMailMapping: mock(),
  persistEscalationMapping: mock(),
  lookupEscalationMapping: mock(),
}));

import { handleMyChannel } from "../channels/my-channel";

function createMockCtx(overrides: Record<string, unknown> = {}) {
  const msgOverrides =
    overrides.message && typeof overrides.message === "object"
      ? overrides.message
      : {};
  return {
    chat: { id: -1001234567890, type: "supergroup" as const },
    message: {
      text: "hello world",
      message_id: 1,
      message_thread_id: 100,
      reply_to_message: undefined as { message_id: number } | undefined,
      ...msgOverrides,
    },
    from: (overrides.from as { username?: string; first_name?: string }) ?? {
      username: "testuser",
      first_name: "Test",
    },
    reply: mock(() => Promise.resolve()),
    react: mock(() => Promise.resolve()),
  };
}

describe("handleMyChannel", () => {
  beforeEach(() => {
    execMock.mockClear();
  });

  test("processes valid message", async () => {
    const ctx = createMockCtx();
    await handleMyChannel(ctx as never);
    expect(execMock).toHaveBeenCalledTimes(1);
    // Verify the exact command and arguments
    const call = execMock.mock.calls[0] as unknown as unknown[];
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["expected", "args"]);
  });

  test("returns early on missing text", async () => {
    const ctx = createMockCtx({ message: { text: undefined } });
    await handleMyChannel(ctx as never);
    expect(execMock).not.toHaveBeenCalled();
  });

  test("reacts on success", async () => {
    const ctx = createMockCtx();
    await handleMyChannel(ctx as never);
    expect(ctx.react).toHaveBeenCalledWith("👍");
  });

  test("replies with error on exec failure", async () => {
    execMock.mockImplementationOnce(() =>
      Promise.reject(new Error("cmd failed")),
    );
    const ctx = createMockCtx();
    await handleMyChannel(ctx as never);
    expect(ctx.reply).toHaveBeenCalled();
    const replyText = (ctx.reply.mock.calls[0] as unknown as [string])[0];
    expect(replyText).toContain("Failed");
  });
});
```

## New Outbound Function

```typescript
/**
 * Tests for new outbound send* function
 */
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { setApi, sendMyThing } from "../outbound";
import { supergroupChatId } from "../config";

mock.module("../log", () => ({ log: mock(() => Promise.resolve()) }));

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
        async (chatId: number, text: string, opts: Record<string, unknown>) => {
          sentMessages.push({ chatId, text, opts });
          return { message_id: nextMsgId++ };
        },
      ),
    },
  };
}

describe("sendMyThing", () => {
  test("sends to supergroup with correct thread_id", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);
    const msgId = await sendMyThing(42, "content");
    expect(msgId).toBe(100);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe(supergroupChatId());
    expect(sentMessages[0].opts.message_thread_id).toBe(42);
  });

  test("escapes HTML in user content", async () => {
    const { api, sentMessages } = createMockApi();
    setApi(api as never);
    await sendMyThing(42, "<script>alert('xss')</script>");
    expect(sentMessages[0].text).toContain("&lt;script&gt;");
    expect(sentMessages[0].text).not.toContain("<script>");
  });
});
```

## Pure Function Unit Test

```typescript
/**
 * Tests for pure utility functions
 */
import { describe, expect, test } from "bun:test";
import { myFunction } from "../my-module";

describe("myFunction", () => {
  test("handles typical input", () => {
    expect(myFunction("input")).toBe("expected");
  });

  test("handles empty input", () => {
    expect(myFunction("")).toBe("default");
  });

  test("handles edge case: special characters", () => {
    expect(myFunction("<>&\"'")).toBe("escaped output");
  });

  test("handles edge case: very long input", () => {
    const long = "x".repeat(10000);
    const result = myFunction(long);
    expect(result.length).toBeLessThanOrEqual(4000);
  });
});
```

## CI Quality Gates

When CI is configured, the following gates should run pre-merge:

1. **Typecheck**: `bun run typecheck`
2. **Tests**: `bun test`
3. **Assertion density**: Verify `expect()` calls / tests >= 1 (guards against trivially passing tests)
4. **Mutation testing** (optional, on PRs): `bun run test:mutation`

Mutation testing uses Stryker with the command runner (`stryker.config.json`).
Thresholds: break at 50%, low at 60%, high at 80%.

## Assertion Quality Checklist

Before committing new tests, verify:

- [ ] **Specific error matching**: Use `.toThrow(/pattern/)` not just `.toThrow()`
- [ ] **Exact value checks**: Use `.toBe(100)` not `.toBeGreaterThanOrEqual(100)`
- [ ] **Side effects verified**: If code calls `trackX()`, assert tracking happened
- [ ] **Negative assertions meaningful**: `not.toHaveBeenCalled()` should test a real code path
- [ ] **No tautologies**: Don't test `mock.set(x); mock.get(x)` — test real code
- [ ] **Edge cases covered**: empty, null, boundary values, special characters
