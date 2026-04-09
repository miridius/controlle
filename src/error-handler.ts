/**
 * Cross-cutting error handler: agent-first, human-last.
 *
 * When an error reaches HIGH or CRITICAL severity:
 * 1. Nudge the responsible agent (if identifiable from error source)
 * 2. Only escalate to the Telegram Escalations topic if no agent can be
 *    reached or the source has no responsible agent.
 *
 * MEDIUM errors are logged to console only (too noisy for agents or humans).
 *
 * Severity levels:
 * - medium: recoverable errors (handler failures, transient issues) — console only
 * - high: repeated failures (same source errors within time window) — agent nudge, then escalation
 * - critical: uncaught exceptions / unhandled rejections — agent nudge, then escalation
 */
import { send } from "./outbound";
import { gateway, resolveSessionForSource } from "./config";
import { exec } from "./exec";
import { escapeHtml, severityIcon } from "./utils";

type Severity = "medium" | "high" | "critical";

/** Track error counts per source for auto-escalation to "high" */
const errorCounts = new Map<string, { count: number; firstSeen: number }>();
const WINDOW_MS = 60_000; // 1 minute window
const REPEAT_THRESHOLD = 3; // escalate to "high" after 3 errors in window

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
 * Try to nudge the responsible agent with error details.
 * Returns true if the agent was successfully nudged.
 */
async function nudgeResponsibleAgent(
  source: string,
  severity: Severity,
  message: string,
): Promise<boolean> {
  const session = resolveSessionForSource(source);
  if (!session) return false;

  const nudgeText = [
    `<system-reminder>`,
    `[gateway-error] severity=${severity} source=${source}`,
    message,
    `</system-reminder>`,
  ].join("\n");

  try {
    await exec("gt", ["nudge", session, "--stdin"], { stdin: nudgeText });
    console.log(`[error-handler] Nudged agent ${session} about ${source} error`);
    return true;
  } catch {
    console.error(`[error-handler] Failed to nudge agent ${session}, falling back to escalation`);
    return false;
  }
}

/**
 * Report an error. Agent-first routing: tries to nudge the responsible agent
 * before escalating to the Telegram Escalations topic.
 *
 * - MEDIUM: console only
 * - HIGH/CRITICAL: nudge agent → if unreachable or no agent, post to Escalations
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

  // Only escalate for high and critical severity
  if (effective === "medium") return;

  // Agent-first: try to nudge the responsible agent
  const agentNotified = await nudgeResponsibleAgent(source, effective, message);
  if (agentNotified) return;

  // No agent found or nudge failed — fall back to Escalations topic
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
 * Agent-first: tries to nudge the responsible agent before falling back
 * to the Telegram Escalations topic via direct HTTP API.
 * MEDIUM errors are logged to console only.
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

  // Only escalate for high and critical severity
  if (severity === "medium") return;

  // Agent-first: try to nudge the responsible agent
  const agentNotified = await nudgeResponsibleAgent(source, severity, message);
  if (agentNotified) return;

  // No agent found or nudge failed — fall back to direct Telegram API
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

