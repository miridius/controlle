/**
 * Cross-cutting error handler: reports HIGH/CRITICAL errors to the Escalations topic.
 * MEDIUM errors are logged to console only (too noisy for the topic).
 *
 * Severity levels:
 * - medium: recoverable errors (handler failures, transient issues) — console only
 * - high: repeated failures (same source errors within time window) — escalated
 * - critical: uncaught exceptions / unhandled rejections — escalated
 */
import { send } from "./outbound";
import { gateway } from "./config";

type Severity = "medium" | "high" | "critical";

/** Track error counts per source for auto-escalation to "high" */
const errorCounts = new Map<string, { count: number; firstSeen: number }>();
const WINDOW_MS = 60_000; // 1 minute window
const REPEAT_THRESHOLD = 3; // escalate to "high" after 3 errors in window

function severityIcon(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "high":
      return "🟠";
    case "medium":
      return "🟡";
  }
}

/**
 * Determine effective severity, upgrading to "high" if errors are repeating.
 */
function effectiveSeverity(source: string, base: Severity): Severity {
  if (base === "critical") return "critical";

  const now = Date.now();
  const entry = errorCounts.get(source);

  if (entry && now - entry.firstSeen < WINDOW_MS) {
    entry.count++;
    if (entry.count >= REPEAT_THRESHOLD) {
      return "high";
    }
  } else {
    errorCounts.set(source, { count: 1, firstSeen: now });
  }

  return base;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Report an error. Only HIGH and CRITICAL are posted to the Escalations topic;
 * MEDIUM errors are logged to console only.
 *
 * Failures in reporting itself are swallowed (logged only) to avoid loops.
 */
export async function reportError(
  source: string,
  err: unknown,
  severity: Severity = "medium",
): Promise<void> {
  const message = formatError(err);
  console.error(`[${source}]`, err);

  const effective = effectiveSeverity(source, severity);

  // Only post to Escalations topic for high and critical severity
  if (effective === "medium") return;

  const icon = severityIcon(effective);

  const text = [
    `${icon} <b>Gateway Error [${effective.toUpperCase()}]</b>`,
    `<b>Source:</b> ${escapeHtml(source)}`,
    "",
    escapeHtml(message),
  ].join("\n");

  try {
    await send(gateway.topics.escalations.thread_id, text, {
      channel: "escalations",
      parseMode: "HTML",
    });
  } catch (sendErr) {
    // Don't recurse — just log the reporting failure
    console.error("[error-handler] Failed to report error to Escalations:", sendErr);
  }
}

/**
 * Report an error directly via Telegram HTTP API (for use in outbound-cli
 * where the grammy bot API is not available).
 * Only HIGH and CRITICAL are posted; MEDIUM errors are logged to console only.
 */
export async function reportErrorDirect(
  botToken: string,
  chatId: number,
  threadId: number,
  source: string,
  err: unknown,
  severity: Severity = "medium",
): Promise<void> {
  const message = formatError(err);
  console.error(`[${source}]`, err);

  // Only post to Escalations for high and critical severity
  if (severity === "medium") return;

  const icon = severityIcon(severity);

  const text = [
    `${icon} <b>Gateway Error [${severity.toUpperCase()}]</b>`,
    `<b>Source:</b> ${escapeHtml(source)}`,
    "",
    escapeHtml(message),
  ].join("\n");

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_thread_id: threadId,
          text,
          parse_mode: "HTML",
        }),
      },
    );
    if (!resp.ok) {
      console.error(
        "[error-handler] Failed to report error via direct API:",
        resp.status,
        await resp.text(),
      );
    }
  } catch (sendErr) {
    console.error("[error-handler] Failed to report error via direct API:", sendErr);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
