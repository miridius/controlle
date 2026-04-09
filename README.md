# Controlle — Gas Town Telegram Gateway

Telegram gateway bridging human operators with Gas Town agents via forum
topics in a single supergroup. Three channel types:

| Channel type | Topics | Direction | Mechanism |
|--------------|--------|-----------|-----------|
| Agent | Mayor, crew members | In: human → `gt nudge` session | Out: agent-log → topic |
| Escalations | 1 shared topic | In: emoji reactions → `gt escalate ack/close` | Out: escalation alerts |
| Mail Inbox | 1 shared topic | In: reply-to → `gt mail reply` | Out: `--human` mail forwarded |

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Gas Town](https://github.com/anthropics/gastown) (`gt` CLI on PATH)
- A Telegram bot token (from BotFather — the human sets this up)
- A Telegram supergroup with **Topics enabled**, bot added as admin

## Deployment

Controlle is designed to be checked out as a Gas Town rig. Agents (typically
the mayor) can then modify config, add crew members, and maintain it in place.

```bash
cd /gt  # or wherever your Gas Town root is
git clone https://github.com/miridius/controlle.git
cd controlle
cp .env.example .env
bun install
```

Set `TELEGRAM_BOT_TOKEN` in `.env`. The human creates the bot and supergroup
beforehand; an agent handles the rest.

### 2. Discover your supergroup

```bash
# Get the supergroup chat_id (bot must already be a member)
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
  | jq '[.result[].message.chat | select(.type == "supergroup")] | unique_by(.id) | .[] | {id, title}'
```

### 3. Create forum topics via API

```bash
TOKEN="$TELEGRAM_BOT_TOKEN"
CHAT_ID="-100XXXXXXXXXX"  # From step 2

# Create each topic and capture the thread_id from the response
curl -s -X POST "https://api.telegram.org/bot${TOKEN}/createForumTopic" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": ${CHAT_ID}, \"name\": \"mayor\"}" \
  | jq '.result.message_thread_id'

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/createForumTopic" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": ${CHAT_ID}, \"name\": \"escalations\"}" \
  | jq '.result.message_thread_id'

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/createForumTopic" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": ${CHAT_ID}, \"name\": \"mail_inbox\"}" \
  | jq '.result.message_thread_id'
```

### 4. Write `gateway.config.json`

Map the thread IDs from step 3 to your GT sessions:

```jsonc
{
  "supergroup_chat_id": -100XXXXXXXXXX,
  "topics": {
    "mayor": {
      "thread_id": 7,             // from createForumTopic response
      "session": "hq-mayor",      // GT session name (tmux session ID)
      "agent_log": true,          // stream Claude transcripts to this topic
      "project_dir": "-gt-mayor"  // ~/.claude/projects/<this> for JSONL resolution
    },
    "escalations": {
      "thread_id": 8              // outbound-only; reactions route inbound
    },
    "mail_inbox": {
      "thread_id": 9              // reply-to routing handles inbound
    }
  }
}
```

**Config fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `thread_id` | yes | Telegram forum topic thread ID |
| `session` | for agents | GT session name (target for `gt nudge`) |
| `agent_log` | no | Stream Claude JSONL transcripts to this topic |
| `project_dir` | if `agent_log` | Directory name under `~/.claude/projects/` for JSONL file resolution |
| `rig` | no | Gas Town rig name. Enables auto-start: when a message arrives and the tmux session is dead, Controlle runs `gt crew start <rig> <name> --resume` |

### 5. Start

```bash
bun run dev    # Long polling with --watch (development)
bun run start  # Long polling (production)
```

## Adding crew members

Use `bin/add-crew` to automate topic creation, config update, and hook
installation:

```bash
bin/add-crew sam                                # defaults: rig=controlle
bin/add-crew alan --rig meerkat --session mk-crew-alan
```

This calls the Telegram API to create the forum topic, adds the entry to
`gateway.config.json`, and installs `SessionStart` hooks + `tg-ack` in the
crew member's working directory.

## Hook integration

Controlle runs as a `SessionStart` hook so it starts alongside any agent
session. `bin/start-controlle.sh` handles single-instance locking (prevents
duplicate bots and Telegram 409 conflicts).

Add to the agent's `.claude/settings.json`:

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
