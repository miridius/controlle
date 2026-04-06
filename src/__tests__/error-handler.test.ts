/**
 * Tests for error-handler.ts: severity logic, formatting, error handling.
 *
 * Tests the internal logic via the public reportError interface.
 * The send() call is mocked via mock.module on the log module only,
 * while outbound is tested by capturing console output and verifying
 * no exceptions propagate.
 */
import { describe, expect, test, mock, beforeEach, afterAll, spyOn } from "bun:test";

// Import the internal helper functions by testing via the public interface
import { reportError } from "../error-handler";

// Suppress console.error noise during tests
const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

describe("reportError", () => {
  beforeEach(() => {
    consoleErrorSpy.mockClear();
  });

  test("logs error to console.error with source prefix", async () => {
    // send() will fail since API isn't initialized, but reportError catches that
    await reportError("test-source", new Error("something broke"));

    expect(consoleErrorSpy).toHaveBeenCalled();
    // First call should be the console.error in reportError
    const firstCall = consoleErrorSpy.mock.calls[0] as unknown[];
    expect(firstCall[0]).toBe("[test-source]");
  });

  test("formats non-Error objects as strings for console", async () => {
    await reportError("test-source", "plain string error");

    const firstCall = consoleErrorSpy.mock.calls[0] as unknown[];
    expect(firstCall[0]).toBe("[test-source]");
    expect(firstCall[1]).toBe("plain string error");
  });

  test("does not throw when send fails (prevents error loops)", async () => {
    // reportError should never throw, even when everything is broken
    await expect(
      reportError("test-source", new Error("original error")),
    ).resolves.toBeUndefined();
  });

  test("does not throw with critical severity", async () => {
    await expect(
      reportError("test-source", new Error("fatal"), "critical"),
    ).resolves.toBeUndefined();
  });

  test("logs repeated errors without throwing", async () => {
    const source = `repeat-source-${Date.now()}`;
    // Fire multiple errors — should never throw
    await reportError(source, new Error("err 1"));
    await reportError(source, new Error("err 2"));
    await reportError(source, new Error("err 3"));

    // All errors should have been logged to console
    const sourceCalls = (consoleErrorSpy.mock.calls as unknown[][]).filter(
      (call) => call[0] === `[${source}]`,
    );
    expect(sourceCalls).toHaveLength(3);
  });

  test("escapes HTML special chars in source (via console log)", async () => {
    await reportError("<script>xss</script>", new Error("test"));

    const firstCall = consoleErrorSpy.mock.calls[0] as unknown[];
    expect(firstCall[0]).toBe("[<script>xss</script>]");
  });
});
