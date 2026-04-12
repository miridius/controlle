# Controlle Requirements Spec

Controlle is the Telegram gateway for Gas Town. It bridges a single Telegram
supergroup (with forum topics) to Gas Town's agent infrastructure. Dave
communicates with agents via topic threads; each agent gets one topic.

## Architecture

- **Runtime**: Bun + grammY (Telegram Bot API)
- **Mode**: Long polling, single-instance deployment
- **Config**: `gateway.config.json` — static mapping of topic labels to thread IDs, sessions, and agent-log settings

### Topic Types

| Topic | Purpose | Inbound | Outbound |
|---|---|---|---|
| Agent topics (mayor, crew/*) | Per-agent communication | Human message -> `gt nudge` | Agent-log JSONL -> Telegram |
| `escalations` | Alert routing | Emoji reactions (ack/resolve) | `gt escalate` / error-handler posts |
| `mail_inbox` | Human mail replies | Reply-to mapping -> `gt mail reply` | `gt mail send --human` forwarded |

## REQ-1: Inbound — Agent Topic Nudges

**When** a human sends a text message in an agent's forum topic:

1. Resolve the `message_thread_id` to a configured channel via `gateway.config.json`
2. The channel must have a `session` field (otherwise the message is ignored with a log)
3. Build an XML-wrapped nudge:
   ```xml
   <telegram>
     <message from="username" msg_id="123" [reply_to="456"]>message text</message>
     [<quote>quoted text</quote>]
     [<reply-context>original message text</reply-context>]
     <ack-cmd>bin/tg-ack 123</ack-cmd>
   </telegram>
   ```
4. Deliver via `gt nudge <session> --stdin` with the XML as stdin
5. On success: react with thumbs-up emoji on the original message
6. On failure: post an error message in the topic

### Reply/Quote Context

- Every message in a forum topic has `reply_to_message` pointing to the topic root message. This MUST be filtered out — only real replies (where `reply_to_message.message_id != message_thread_id`) produce `reply_to` and `reply-context` attributes.
- If Telegram's quote feature is used, the `<quote>` element includes the selected text.
- `<reply-context>` contains the full text of the replied-to message (when it's a real reply).

### XML Escaping

All user-provided text (`from`, message text, quote, reply-context) MUST be XML-escaped: `&`, `<`, `>`, `"` replaced with their entity equivalents.

## REQ-2: Outbound — Agent-Log Streaming

**When** an agent produces assistant output in its Claude Code session:

1. Poll the agent's JSONL session file every 2 seconds
2. Look for events with `type === "assistant"` containing text content blocks
3. Extract and concatenate text blocks
4. Truncate to 4000 characters (Telegram limit ~4096) with `[...truncated]` suffix
5. Send to the agent's forum topic via `sendMessage` with link preview disabled

### Session File Resolution

- If `project_dir` is configured: look in `~/.claude/projects/<project_dir>/`
- Otherwise: scan all directories under `~/.claude/projects/`
- Pick the most recently modified `.jsonl` file
- On first discovery, start from end of file (don't replay history)

### Channels

Only topics with `agent_log: true` AND a `session` field are watched.

## REQ-3: Outbound — Escalations

**When** `gt escalate` fires or the error handler detects a HIGH/CRITICAL error:

1. Format with severity icon: CRITICAL=red, HIGH=orange, MEDIUM=yellow, LOW=blue
2. Include escalation ID, source, description
3. Post to the `escalations` topic with HTML parse mode
4. Track `telegram_msg_id -> escalation_id` mapping (in-memory + persistent JSON file)
5. Include instructions: "React thumbs-up to ack, checkmark to resolve"

### Error Handler Auto-Escalation

- MEDIUM errors: console log only (not posted to Telegram)
- HIGH errors: posted to escalations topic
- CRITICAL errors: always posted
- Auto-upgrade: if the same error source fires 3+ times within 60 seconds, MEDIUM is upgraded to HIGH
- Uncaught exceptions and unhandled rejections are always CRITICAL

## REQ-4: Inbound — Escalation Reactions

**When** a user reacts to a message in any topic:

1. Look up `telegram_msg_id` in escalation mapping (in-memory cache, then persistent file)
2. If not found: ignore (not an escalation message)
3. Thumbs-up reaction: run `gt escalate ack <escalation_id>`
4. Checkmark reaction: run `gt escalate close <escalation_id> --reason "Resolved via Telegram by <user>"`

## REQ-5: Outbound — Mail Messages

**When** `gt mail send --human` triggers:

1. Format with mail icon, sender, subject, mail ID
2. Post to the `mail_inbox` topic with HTML parse mode
3. Track `telegram_msg_id -> mail_id` mapping (in-memory + persistent JSON file)
4. Include instructions: "Reply to this message to respond"

## REQ-6: Inbound — Mail Inbox Replies

**When** a human sends a text message in the `mail_inbox` topic:

1. The message MUST be a reply to a previous mail message (`reply_to_message` present)
2. If not a reply: respond with guidance ("Reply to a specific message to respond")
3. Look up `reply_to_message.message_id` in mail mapping (in-memory, then persistent file)
4. If mapping not found: respond with "Could not find the original mail message"
5. Deliver via `gt mail reply <mail_id> --stdin` with the reply text as stdin
6. On success: react with thumbs-up
7. On failure: post error message in the topic

## REQ-7: Escalations Topic — Text Messages

**When** a human sends a text message in the `escalations` topic:

1. Reply with guidance: "This topic is for escalation alerts. Use reactions to respond."
2. No nudge or routing occurs

## REQ-8: Single-Instance Lock

**Prevent** duplicate bot processes (which cause Telegram 409 Conflict errors):

1. On startup, write PID to `.runtime/controlle.lock`
2. If lock file exists with a live PID (different from current): exit immediately
3. If lock file exists with a dead PID: take over (stale lock)
4. On exit (normal, SIGINT, SIGTERM): remove lock file

## REQ-9: Watch Mode

**Auto-restart** on code changes:

- `bun run --watch src/index.ts` is the standard dev/production invocation
- The single-instance lock (REQ-8) ensures that watch-mode restarts don't create duplicate bots

## REQ-10: Bot Self-Filter

The bot MUST only process messages from the configured supergroup:
- Messages from other chats are ignored with a log message
- Messages without a `message_thread_id` (general topic) are ignored

The bot does NOT explicitly filter its own messages because grammY's long polling
does not deliver the bot's own outbound messages as inbound updates.

## REQ-11: Topic Root Filter

In Telegram forum topics, every message has `reply_to_message` pointing to the
topic's root message. This MUST be filtered so that only genuine user replies
produce `reply_to` attributes in the nudge XML. The filter:
`replyToMsg.message_id !== threadId` — if the reply target IS the thread ID,
it's the topic root and is discarded.

## REQ-12: Retry on Transient Failures

**Agent nudge delivery** retries up to 3 attempts with 2-second delay between attempts:

- On transient `gt nudge` failures (process exit non-zero), retry
- After all attempts exhausted: report error and notify in the topic
- Only applies to agent inbound nudges (REQ-1), not mail replies

## REQ-13: Auto Crew Setup

`bin/add-crew <name>` automates new crew member provisioning:

1. **Create Telegram forum topic** via Telegram API (`createForumTopic`)
2. **Update `gateway.config.json`** — add topic entry with `thread_id`, `session`, `agent_log: true`, `project_dir`
3. **Install bin scripts** in the crew member's directory:
   - `start-controlle.sh` — SessionStart hook that launches the gateway
   - `tg-ack` — acknowledge messages with eyes emoji reaction
4. **Configure SessionStart hook** in the crew member's `.claude/settings.json`

### Defaults

- Rig: `controlle` (overridable with `--rig`)
- Session: `<rig-prefix>-crew-<name>` (overridable with `--session`)
- Project dir: `-gt-<rig>-crew-<name>`

## REQ-14: Update Dedup

**Prevent** duplicate processing of Telegram updates:

1. Track seen `update_id` values in a ring buffer (capacity: 1000)
2. If an update was already processed: drop it with a log message
3. Evict oldest entries when capacity is exceeded

This handles Telegram redelivering updates when handlers are slow.

## REQ-15: Message ID Mapping Persistence

Escalation and mail mappings (`telegram_msg_id -> application_id`) are stored:

1. **In-memory**: `Map<number, string>` for fast lookup during the bot's lifetime
2. **Persistent**: `data/msg-map.json` file so the outbound CLI and bot share state

Both layers are checked on lookup (in-memory first, then file).

## REQ-16: Outbound CLI

Standalone CLI (`src/outbound-cli.ts`) for sending messages from GT hooks/scripts
without requiring the grammY bot instance:

- `outbound-cli escalation <severity> <id> <description> [source]`
- `outbound-cli mail <mail-id> <from> <subject> <body>`
- `outbound-cli send <thread_id> <text>|--stdin`

Uses direct Telegram HTTP API. Shares message mapping via persistent JSON file (REQ-15).

## REQ-17: Logging

All inbound and outbound messages are logged to daily log files:

- Path: `<LOG_DIR>/YYYY-MM-DD.log`
- Format: `[YYYY-MM-DD HH:MM:SS] [channel] {direction} from: text`
- Direction: `->` for inbound, `<-` for outbound
- Log directory created on first write

## REQ-18: Configuration

### Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Telegram Bot API token |
| `LOG_DIR` | No | `data` | Directory for log files and message mappings |
| `RUNTIME_DIR` | No | `../.runtime` | Directory for PID lock file |

### Gateway Config (`gateway.config.json`)

```json
{
  "supergroup_chat_id": -100...,
  "topics": {
    "<label>": {
      "thread_id": 123,
      "session": "session-id",
      "agent_log": true,
      "project_dir": "-gt-rig-name"
    }
  }
}
```

- `thread_id` (required): Telegram forum topic thread ID
- `session` (optional): GT session ID for nudge delivery
- `agent_log` (optional): enable JSONL transcript streaming
- `project_dir` (optional): Claude projects subdirectory for JSONL resolution

## REQ-19: Inbound Message Delivery Feedback

**All inbound messages MUST receive visual feedback indicating delivery status (success, pending, or failure).**

When a human sends a message in an agent's forum topic:

1. **Immediately** react with 👀 (eyes) to acknowledge receipt
2. **On successful delivery**: replace reaction with 👍 (success)
3. **On failed delivery** (after retry exhaustion): replace reaction with 😢 (failure) and post a brief error message as a reply to the original message

This ensures the human operator always knows the delivery status of their message. Silent failures — where the bot appears to ignore a message — are not acceptable.

## REQ-20: Health Check

**Gateway MUST expose a health check mechanism that detects frozen poll loops and stalled long polling.**

### `/health` Bot Command

**When** a user sends `/health` in any topic:

1. Report gateway uptime (human-readable: e.g. "2h 15m 30s")
2. Report last agent-log poll time (seconds ago, or "never" if no poll has run)
3. Report message counts for the last 5 minutes (inbound and outbound)
4. Report total message counts since startup
5. Report the gateway process PID

### Periodic Heartbeat Log

Every 5 minutes, log a heartbeat line to console:

```
[heartbeat] gateway alive — uptime 2h 15m 30s, 3 in / 12 out (last 5m), last poll 2s ago
```

This provides an observable liveness signal in logs. If heartbeats stop appearing,
the gateway process is frozen or dead.

### Message Counting

- **Inbound**: incremented when a routed message is received (after channel resolution)
- **Outbound**: incremented when a message is sent via the `send()` function
- **Recent window**: 5-minute rolling window for "last 5m" counts
