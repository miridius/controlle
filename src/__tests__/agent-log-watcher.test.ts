/**
 * Tests for agent-log-watcher.ts: extractAssistantText, truncate.
 */
import { describe, expect, test } from "bun:test";
import { extractAssistantText, truncate } from "../agent-log-watcher";

describe("extractAssistantText", () => {
  test("extracts text from assistant message event", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello from assistant" }],
      },
    });
    expect(extractAssistantText(event)).toBe("Hello from assistant");
  });

  test("joins multiple text blocks with newline", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "First block" },
          { type: "text", text: "Second block" },
        ],
      },
    });
    expect(extractAssistantText(event)).toBe("First block\nSecond block");
  });

  test("skips non-text content blocks", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "123", name: "read", input: {} },
          { type: "text", text: "Only this" },
        ],
      },
    });
    expect(extractAssistantText(event)).toBe("Only this");
  });

  test("returns null for non-assistant events", () => {
    const event = JSON.stringify({
      type: "user",
      message: { content: [{ type: "text", text: "user msg" }] },
    });
    expect(extractAssistantText(event)).toBeNull();
  });

  test("returns null for assistant event with no content", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {},
    });
    expect(extractAssistantText(event)).toBeNull();
  });

  test("returns null for assistant event with only tool_use blocks", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "1", name: "bash", input: {} }],
      },
    });
    expect(extractAssistantText(event)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    expect(extractAssistantText("{invalid json")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractAssistantText("")).toBeNull();
  });

  test("returns null for system events", () => {
    const event = JSON.stringify({
      type: "system",
      data: { message: "session started" },
    });
    expect(extractAssistantText(event)).toBeNull();
  });
});

describe("truncate", () => {
  test("returns short text unchanged", () => {
    expect(truncate("hello")).toBe("hello");
  });

  test("returns text at exactly max length unchanged", () => {
    const text = "x".repeat(4000);
    expect(truncate(text)).toBe(text);
  });

  test("truncates text exceeding max length", () => {
    const text = "x".repeat(5000);
    const result = truncate(text);
    expect(result.length).toBeLessThanOrEqual(4000);
    expect(result).toEndWith("[...truncated]");
  });

  test("respects custom max length", () => {
    const text = "x".repeat(200);
    const result = truncate(text, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toEndWith("[...truncated]");
  });

  test("preserves content before truncation point", () => {
    const text = "important data " + "x".repeat(5000);
    const result = truncate(text, 100);
    expect(result).toStartWith("important data ");
  });
});
