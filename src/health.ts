/**
 * Health tracking for the gateway.
 *
 * Tracks uptime, message counts, and last poll times so the /health
 * bot command and periodic heartbeat log can report gateway liveness.
 */

const startedAt = Date.now();

interface MessageCounts {
  inbound: number;
  outbound: number;
}

/** Rolling window of message timestamps for "last 5m" counts */
const recentInbound: number[] = [];
const recentOutbound: number[] = [];
const WINDOW_MS = 5 * 60 * 1000;

let lastPollTime: number | null = null;
let totalInbound = 0;
let totalOutbound = 0;

/** Record an inbound message */
export function recordInbound(): void {
  totalInbound++;
  recentInbound.push(Date.now());
}

/** Record an outbound message */
export function recordOutbound(): void {
  totalOutbound++;
  recentOutbound.push(Date.now());
}

/** Record that the agent-log poll loop executed */
export function recordPoll(): void {
  lastPollTime = Date.now();
}

/** Prune timestamps older than the window */
function prune(timestamps: number[]): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }
}

/** Get counts within the last 5 minutes */
export function recentCounts(): MessageCounts {
  prune(recentInbound);
  prune(recentOutbound);
  return {
    inbound: recentInbound.length,
    outbound: recentOutbound.length,
  };
}

/** Get total message counts since startup */
export function totalCounts(): MessageCounts {
  return { inbound: totalInbound, outbound: totalOutbound };
}

/** Get uptime in seconds */
export function uptimeSeconds(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

/** Get the last poll timestamp (ms since epoch), or null if never polled */
export function getLastPollTime(): number | null {
  return lastPollTime;
}

/** Format uptime as human-readable string */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/** Format health status as a text report */
export function formatHealthReport(): string {
  const up = uptimeSeconds();
  const recent = recentCounts();
  const total = totalCounts();
  const lastPoll = getLastPollTime();

  const lastPollStr = lastPoll
    ? `${Math.floor((Date.now() - lastPoll) / 1000)}s ago`
    : "never";

  return [
    `Gateway Health`,
    `  Uptime: ${formatUptime(up)}`,
    `  Last poll: ${lastPollStr}`,
    `  Messages (last 5m): ${recent.inbound} in / ${recent.outbound} out`,
    `  Messages (total): ${total.inbound} in / ${total.outbound} out`,
    `  PID: ${process.pid}`,
  ].join("\n");
}

/**
 * Format heartbeat line for periodic console logging.
 * Example: "gateway alive — uptime 2h 15m 30s, 3 in / 12 out (last 5m), last poll 2s ago"
 */
export function formatHeartbeat(): string {
  const up = uptimeSeconds();
  const recent = recentCounts();
  const lastPoll = getLastPollTime();

  const lastPollStr = lastPoll
    ? `${Math.floor((Date.now() - lastPoll) / 1000)}s ago`
    : "never";

  return `gateway alive — uptime ${formatUptime(up)}, ${recent.inbound} in / ${recent.outbound} out (last 5m), last poll ${lastPollStr}`;
}
