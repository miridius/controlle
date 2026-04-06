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
import { send } from "./outbound";
import { agentLogChannels } from "./config";

const POLL_INTERVAL_MS = 2000;
const MAX_MESSAGE_LENGTH = 4000; // Telegram limit ~4096

interface WatchState {
  filePath: string;
  offset: number;
}

/** Per-session watcher state */
const watchers = new Map<string, WatchState>();

/** Find the most recent JSONL file for a Claude session */
async function findSessionJsonl(session: string): Promise<string | null> {
  // Claude Code stores transcripts in ~/.claude/projects/<hash>/<session>.jsonl
  const claudeDir = join(homedir(), ".claude", "projects");
  try {
    const projectDirs = await readdir(claudeDir);
    let newest: { path: string; mtime: number } | null = null;

    for (const dir of projectDirs) {
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

/** Truncate text for Telegram */
export function truncate(text: string, max: number = MAX_MESSAGE_LENGTH): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n[...truncated]";
}

/** Poll loop for a single channel */
async function pollChannel(channel: {
  threadId: number;
  session: string;
  label: string;
}): Promise<void> {
  // Try to find the session file
  let state = watchers.get(channel.session);

  if (!state) {
    const filePath = await findSessionJsonl(channel.session);
    if (!filePath) return; // no session file yet
    const st = await stat(filePath);
    state = { filePath, offset: st.size }; // start from end (don't replay history)
    watchers.set(channel.session, state);
    console.log(`[agent-log] Watching ${channel.label}: ${filePath}`);
  }

  const lines = await readNewLines(state);
  for (const line of lines) {
    const text = extractAssistantText(line);
    if (text) {
      try {
        await send(channel.threadId, truncate(text), {
          channel: channel.label,
          disablePreview: true,
        });
      } catch (err) {
        console.error(
          `[agent-log] Failed to send to ${channel.label}:`,
          err,
        );
      }
    }
  }
}

/** Start the agent-log watcher loop */
export function startAgentLogWatcher(): void {
  const channels = agentLogChannels();
  if (channels.length === 0) {
    console.log("[agent-log] No channels with agent_log enabled, skipping.");
    return;
  }

  console.log(
    `[agent-log] Watching ${channels.length} channel(s): ${channels.map((c) => c.label).join(", ")}`,
  );

  setInterval(async () => {
    for (const channel of channels) {
      await pollChannel(channel);
    }
  }, POLL_INTERVAL_MS);
}
