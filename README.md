# Controlle — Gas Town Telegram Gateway

Four-channel Telegram gateway bridging human operators with Gas Town agents.
All channels are forum topics within a single Telegram supergroup.

| # | Topic | Direction | Mechanism |
|---|-------|-----------|-----------|
| 1 | Mayor | In: human → `gt nudge` mayor | Out: agent-log → topic |
| 2 | Escalations | In: emoji reactions → `gt escalate ack/close` | Out: escalation alerts |
| 3 | Mail Inbox | In: reply-to → `gt mail reply` | Out: `--human` mail forwarded |
| 4 | Crew topics | In: human → `gt nudge` crew session | Out: agent-log → topic |

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Gas Town](https://github.com/anthropics/gastown) (`gt` CLI on PATH)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Telegram supergroup with **Topics enabled** (Group Settings → Topics)
- The bot must be added to the supergroup as an **admin** with permission to
  manage topics and send messages

## Setup

### 1. Create the Telegram supergroup

1. Create a supergroup in Telegram
2. Enable **Topics** in group settings
3. Add your bot as an admin
4. Create forum topics for each channel you need (e.g. "mayor",
   "escalations", "mail_inbox", one per crew member)

### 2. Get your IDs

**Supergroup chat ID:** Send a message in the group, then call:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
```

**Topic thread IDs:** Each forum topic has a `message_thread_id`. Send a
message in a topic and inspect `getUpdates` output, or use the bot's
`/status` command inside a topic.

### 3. Configure

```bash
cp .env.example .env   # Set TELEGRAM_BOT_TOKEN
bun install
```

Edit `gateway.config.json` to map your supergroup and topics:

```jsonc
{
  "supergroup_chat_id": -100XXXXXXXXXX,   // Your supergroup ID
  "topics": {
    "mayor": {
      "thread_id": 7,          // Thread ID from step 2
      "session": "hq-mayor",   // GT session name (tmux session ID)
      "agent_log": true,       // Stream Claude transcripts to this topic
      "project_dir": "-gt-mayor"  // Claude projects dir name for JSONL resolution
    },
    "escalations": {
      "thread_id": 8           // No session — outbound-only (reactions route inbound)
    },
    "mail_inbox": {
      "thread_id": 9           // No session — reply-to routing handles inbound
    },
    "crew/sam": {
      "thread_id": 10,
      "session": "co-crew-sam",
      "rig": "controlle",      // Rig name — enables auto-start on inbound message
      "agent_log": true,
      "project_dir": "-gt-controlle-crew-sam"
    }
  }
}
```

**Config fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `thread_id` | yes | Telegram forum topic thread ID |
| `session` | for agents | GT session name (used for `gt nudge`) |
| `agent_log` | no | Stream Claude JSONL transcripts to this topic |
| `project_dir` | no | Claude projects directory name (under `~/.claude/projects/`) for JSONL file resolution. Required if `agent_log` is true. |
| `rig` | no | Gas Town rig name. When set, Controlle auto-starts the crew session via `gt crew start <rig> <name>` if the tmux session is dead when a message arrives. |

### 4. Run

```bash
bun run dev    # Long polling with --watch (development)
bun run start  # Long polling (production)
```

## Adding crew members

The `bin/add-crew` script automates topic creation, config update, and hook
installation for new crew members:

```bash
bin/add-crew emma                              # defaults: rig=controlle
bin/add-crew alan --rig meerkat --session mk-crew-alan
```

This creates the Telegram topic, adds the config entry, and installs
`SessionStart` hooks so Controlle starts automatically with the agent session.

## Hook integration

Controlle is designed to run as a `SessionStart` hook so it starts alongside
agent sessions. The `bin/start-controlle.sh` script handles single-instance
locking (only one bot process, avoiding Telegram 409 conflicts).

Install it via Claude Code settings:

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "/path/to/bin/start-controlle.sh" }]
    }]
  }
}
```

## Outbound CLI

Send messages to Telegram from GT hooks or scripts:

```bash
bun run outbound -- escalation high esc-123 "Build is broken"
bun run outbound -- mail msg-456 "crew/sam" "HELP: auth" "Need credentials"
bun run outbound -- send <chat_id> "Hello"
```

## Architecture

```
src/
├── index.ts              Entry point (long polling + agent-log watcher)
├── config.ts             Gateway config loader + channel routing
├── telegram.ts           grammY bot setup, inbound routing by thread_id
├── exec.ts               Shell command helper (gt nudge, gt mail, etc.)
├── log.ts                Gateway event logging
├── outbound.ts           Bot API outbound send (escalations, mail, streaming)
├── outbound-cli.ts       CLI for GT hooks to send to Telegram
├── agent-log-watcher.ts  Watches Claude JSONL transcripts → Telegram
├── markdown.ts           GFM → Telegram HTML conversion
└── channels/
    ├── agent.ts          Generic agent topic handler (mayor + crew)
    ├── escalations.ts    Escalation alerts + reaction handling
    └── mail-inbox.ts     Mail inbox + reply routing
```

## License

[MIT](LICENSE)
