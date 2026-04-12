/**
 * Tests for error-handler.ts untested paths:
 * - effectiveSeverity: REPEAT_THRESHOLD=3 escalation, window expiry reset
 * - nudgeResponsibleAgent: session resolution, nudge XML, exec call, fallback
 * - reportErrorDirect: HTTP API fallback, medium short-circuit, error handling
 *
 * Uses beforeEach/afterEach spyOn for exec to intercept gt nudge calls
 * (which hang 60s in the real environment). Uses console output to verify
 * the send() fallback path (no bot API in tests, so send fails naturally).
 */
import { describe, expect, test, mock, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import * as execModule from "../exec";
import { reportError, reportErrorDirect } from "../error-handler";

let execSpy: ReturnType<typeof spyOn<typeof execModule, "exec">>;

const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
const consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});

afterAll(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

function consoleErrorContains(substring: string): boolean {
  return (consoleErrorSpy.mock.calls as unknown[][]).some(
    (c) => typeof c[0] === "string" && c[0].includes(substring),
  );
}

describe("effectiveSeverity (via reportError)", () => {
  beforeEach(() => {
    execSpy = spyOn(execModule, "exec").mockImplementation(() =>
      Promise.resolve("ok"),
    );
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    execSpy.mockRestore();
  });

  test("medium errors do not trigger escalation", async () => {
    await reportError(`eff-med-${Date.now()}`, new Error("one-off"), "medium");
    expect(execSpy).not.toHaveBeenCalled();
    expect(consoleErrorContains("Failed to report error")).toBe(false);
  });

  test("3 medium errors from same source within window escalates to high", async () => {
    const source = `eff-repeat-${Date.now()}`;
    await reportError(source, new Error("err 1"), "medium");
    await reportError(source, new Error("err 2"), "medium");
    expect(execSpy).not.toHaveBeenCalled();

    // Third triggers escalation to high — source has no session so
    // nudge is skipped and send() is attempted (fails without bot API)
    await reportError(source, new Error("err 3"), "medium");
    expect(consoleErrorContains("Failed to report error to Escalations")).toBe(
      true,
    );
  });

  test("critical severity always escalates on first call", async () => {
    const source = `eff-crit-${Date.now()}`;
    await reportError(source, new Error("critical failure"), "critical");
    expect(consoleErrorContains("Failed to report error to Escalations")).toBe(
      true,
    );
  });

  test("error count resets after window expires", async () => {
    const source = `eff-expire-${Date.now()}`;
    const realNow = Date.now();
    const dateNowSpy = spyOn(Date, "now");

    dateNowSpy.mockReturnValue(realNow);
    await reportError(source, new Error("err 1"), "medium");
    await reportError(source, new Error("err 2"), "medium");

    // Jump past 60s window — count resets, third call is NOT third in window
    dateNowSpy.mockReturnValue(realNow + 61_000);
    await reportError(source, new Error("err 3 after expiry"), "medium");
    expect(execSpy).not.toHaveBeenCalled();
    expect(consoleErrorContains("Failed to report error")).toBe(false);

    dateNowSpy.mockRestore();
  });
});

describe("nudgeResponsibleAgent (via reportError)", () => {
  beforeEach(() => {
    execSpy = spyOn(execModule, "exec").mockImplementation(() =>
      Promise.resolve("ok"),
    );
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    execSpy.mockRestore();
  });

  test("nudges agent when source matches topic with session", async () => {
    await reportError("mayor", new Error("agent error"), "high");

    expect(execSpy).toHaveBeenCalledTimes(1);
    const call = execSpy.mock.calls[0] as unknown as unknown[];
    expect(call[0]).toBe("gt");
    expect(call[1]).toEqual(["nudge", "hq-mayor", "--stdin"]);
    const stdin = (call[2] as { stdin: string }).stdin;
    expect(stdin).toContain("<system-reminder>");
    expect(stdin).toContain("severity=high");
    expect(stdin).toContain("source=mayor");
    expect(stdin).toContain("agent error");
    expect(stdin).toContain("</system-reminder>");
  });

  test("strips agent-log/ prefix to resolve session", async () => {
    await reportError("agent-log/mayor", new Error("log error"), "high");

    expect(execSpy).toHaveBeenCalledTimes(1);
    const call = execSpy.mock.calls[0] as unknown as unknown[];
    expect(call[1]).toEqual(["nudge", "hq-mayor", "--stdin"]);
  });

  test("strips agent-log/poll/ prefix to resolve session", async () => {
    await reportError("agent-log/poll/mayor", new Error("poll error"), "high");

    expect(execSpy).toHaveBeenCalledTimes(1);
    const call = execSpy.mock.calls[0] as unknown as unknown[];
    expect(call[1]).toEqual(["nudge", "hq-mayor", "--stdin"]);
  });

  test("resolves crew/sam session via agent-log/ prefix", async () => {
    await reportError("agent-log/crew/sam", new Error("crew error"), "high");

    expect(execSpy).toHaveBeenCalledTimes(1);
    const call = execSpy.mock.calls[0] as unknown as unknown[];
    expect(call[1]).toEqual(["nudge", "co-crew-sam", "--stdin"]);
  });

  test("falls back to escalation when no session found for source", async () => {
    await reportError("unknown-source-xyz", new Error("mystery"), "high");

    expect(execSpy).not.toHaveBeenCalled();
    expect(consoleErrorContains("Failed to report error to Escalations")).toBe(
      true,
    );
  });

  test("falls back to escalation when exec (nudge) fails", async () => {
    execSpy.mockImplementationOnce(() =>
      Promise.reject(new Error("nudge failed")),
    );
    await reportError("mayor", new Error("agent unreachable"), "high");

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorContains("Failed to nudge agent hq-mayor")).toBe(true);
    expect(consoleErrorContains("Failed to report error to Escalations")).toBe(
      true,
    );
  });

  test("escalations topic has no session — falls back to send", async () => {
    await reportError("escalations", new Error("self-error"), "high");

    expect(execSpy).not.toHaveBeenCalled();
    expect(consoleErrorContains("Failed to report error to Escalations")).toBe(
      true,
    );
  });

  test("reportError never throws even when all fallbacks fail", async () => {
    await expect(
      reportError("unknown-fallback", new Error("test"), "high"),
    ).resolves.toBeUndefined();
  });
});

describe("reportErrorDirect", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    execSpy = spyOn(execModule, "exec").mockImplementation(() =>
      Promise.resolve("ok"),
    );
    consoleErrorSpy.mockClear();
    consoleLogSpy.mockClear();
    fetchMock = mock(() =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    execSpy.mockRestore();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("medium severity logs to console only — no nudge or HTTP call", async () => {
    await reportErrorDirect(
      "bot-token",
      -100,
      999,
      "direct-med",
      new Error("minor issue"),
      "medium",
    );
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("high severity falls back to HTTP API when no session found", async () => {
    await reportErrorDirect(
      "bot-token",
      -100,
      999,
      "direct-unknown-src",
      new Error("serious issue"),
      "high",
    );
    expect(execSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const fetchCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(fetchCall[0]).toBe(
      "https://api.telegram.org/botbot-token/sendMessage",
    );
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.chat_id).toBe(-100);
    expect(body.message_thread_id).toBe(999);
    expect(body.text).toContain("HIGH");
    expect(body.text).toContain("direct-unknown-src");
    expect(body.parse_mode).toBe("HTML");
  });

  test("critical severity sends with correct icon and label", async () => {
    await reportErrorDirect(
      "bot-token",
      -100,
      999,
      "direct-crit-src",
      new Error("fatal"),
      "critical",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.text).toContain("CRITICAL");
  });

  test("high severity nudges agent when source matches topic session", async () => {
    await reportErrorDirect(
      "bot-token",
      -100,
      999,
      "mayor",
      new Error("agent issue"),
      "high",
    );
    expect(execSpy).toHaveBeenCalledTimes(1);
    const call = execSpy.mock.calls[0] as unknown as unknown[];
    expect(call[1]).toEqual(["nudge", "hq-mayor", "--stdin"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falls back to HTTP API when nudge fails", async () => {
    execSpy.mockImplementationOnce(() =>
      Promise.reject(new Error("nudge failed")),
    );
    await reportErrorDirect(
      "bot-token",
      -100,
      999,
      "mayor",
      new Error("nudge broken"),
      "high",
    );
    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("handles HTTP API non-ok response without throwing", async () => {
    fetchMock = mock(() =>
      Promise.resolve(new Response("Bad Request", { status: 400 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      reportErrorDirect(
        "bot-token",
        -100,
        999,
        "direct-fail-src",
        new Error("http fail"),
        "high",
      ),
    ).resolves.toBeUndefined();
    const errorCalls = consoleErrorSpy.mock.calls as unknown[][];
    const hasApiFailLog = errorCalls.some(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("Failed to report error via direct API"),
    );
    expect(hasApiFailLog).toBe(true);
  });

  test("handles fetch network error without throwing", async () => {
    fetchMock = mock(() => Promise.reject(new Error("network error")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      reportErrorDirect(
        "bot-token",
        -100,
        999,
        "direct-net-err",
        new Error("net fail"),
        "high",
      ),
    ).resolves.toBeUndefined();
  });

  test("escapes HTML in source and message", async () => {
    await reportErrorDirect(
      "bot-token",
      -100,
      999,
      "<script>xss</script>",
      new Error("<b>bold</b>"),
      "high",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const fetchCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.text).toContain("&lt;script&gt;");
    expect(body.text).not.toContain("<script>xss");
    expect(body.text).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});
