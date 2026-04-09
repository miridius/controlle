/**
 * Agent-log watcher: streams Claude Code JSONL transcripts to Telegram
 *
 * Watches for new assistant messages in Claude session JSONL files and
 * forwards them to the appropriate forum topic in the supergroup.
 *
 * Uses a tail-like approach: track file size, read new bytes, parse JSONL lines.
 */
import { readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { sendWithMarkdownFallback } from "./outbound";
import { agentLogChannels } from "./config";
import { reportError } from "./error-handler";

const POLL_INTERVAL_MS = 2000;
interface WatchState {
  filePath: string;
  offset: number;
}

/** Per-session watcher state */
const watchers = new Map<string, WatchState>();

/** Find the most recent JSONL file for a Claude session in a specific project dir */
async function findSessionJsonl(
  session: string,
  projectDir?: string,
): Promise<string | null> {
  const claudeDir = join(homedir(), ".claude", "projects");

  // If projectDir is specified, search only that directory
  const dirsToSearch = projectDir ? [projectDir] : await listProjectDirs(claudeDir);
  if (!dirsToSearch) return null;

  let newest: { path: string; mtime: number } | null = null;

  for (const dir of dirsToSearch) {
    const fullDir = join(claudeDir, dir);
    try {
      const files = await readdir(fullDir);
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const fp = join(fullDir, f);
        const st = await stat(fp);
        if (!newest || st.mtimeMs > newest.mtime) {
          newest = { path: fp, mtime: st.mtimeMs };
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  return newest?.path ?? null;
}

/** List project directory names (fallback when no projectDir configured) */
async function listProjectDirs(claudeDir: string): Promise<string[] | null> {
  try {
    return await readdir(claudeDir);
  } catch {
    return null;
  }
}

/** Read new lines from a JSONL file since last offset */
async function readNewLines(state: WatchState): Promise<string[]> {
  try {
    const st = await stat(state.filePath);
    if (st.size <= state.offset) return [];

    const fh = await open(state.filePath, "r");
    try {
      const buf = Buffer.alloc(st.size - state.offset);
      await fh.read(buf, 0, buf.length, state.offset);
      state.offset = st.size;
      return buf
        .toString("utf-8")
        .split("\n")
        .filter((l) => l.trim());
    } finally {
      await fh.close();
    }
  } catch {
    return [];
  }
}

/** Extract assistant text from a JSONL event line */
export function extractAssistantText(line: string): string | null {
  try {
    const event = JSON.parse(line);
    // Claude Code JSONL format: look for assistant messages with text content
    if (event.type === "assistant" && event.message?.content) {
      const textBlocks = event.message.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text);
      if (textBlocks.length > 0) {
        return textBlocks.join("\n");
      }
    }
  } catch {
    // malformed JSON, skip
  }
  return null;
}

/** Poll loop for a single channel */
async function pollChannel(channel: {
  threadId: number;
  session: string;
  projectDir: string | undefined;
  label: string;
}): Promise<void> {
  let state = watchers.get(channel.session);

  // Always check for a newer session file (handles handoffs)
  const newestPath = await findSessionJsonl(channel.session, channel.projectDir);
  if (!newestPath) return; // no session file yet

  if (!state || state.filePath !== newestPath) {
    // New file discovered — start from end (don't replay history)
    const st = await stat(newestPath);
    state = { filePath: newestPath, offset: st.size };
    watchers.set(channel.session, state);
    console.log(`[agent-log] Watching ${channel.label}: ${newestPath}`);
  }

  const lines = await readNewLines(state);
  for (const line of lines) {
    const text = extractAssistantText(line);
    if (text) {
      try {
        await sendWithMarkdownFallback(channel.threadId, text, {
          channel: channel.label,
          disablePreview: true,
        });
      } catch (err) {
        reportError(`agent-log/${channel.label}`, err);
      }
    }
  }
}

let pollIntervalHandle: ReturnType<typeof setInterval> | null = null;

/** Stop the agent-log watcher loop */
export function stopAgentLogWatcher(): void {
  if (pollIntervalHandle !== null) {
    clearInterval(pollIntervalHandle);
    pollIntervalHandle = null;
    console.log("[agent-log] Watcher stopped.");
  }
}

/** Start the agent-log watcher loop */
export function startAgentLogWatcher(): void {
  // Clear any existing interval to prevent duplicate poll loops on restart
  stopAgentLogWatcher();

  const channels = agentLogChannels();
  if (channels.length === 0) {
    console.log("[agent-log] No channels with agent_log enabled, skipping.");
    return;
  }

  console.log(
    `[agent-log] Watching ${channels.length} channel(s): ${channels.map((c) => c.label).join(", ")}`,
  );

  pollIntervalHandle = setInterval(async () => {
    for (const channel of channels) {
      try {
        await pollChannel(channel);
      } catch (err) {
        reportError(`agent-log/poll/${channel.label}`, err);
      }
    }
  }, POLL_INTERVAL_MS);
}
