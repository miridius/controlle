# Controlle — Gas Town Telegram Gateway

Four-channel Telegram gateway bridging human operators with Gas Town agents.

## Channels

All channels are forum topics within a single Telegram supergroup.

| # | Topic | Direction | Mechanism |
|---|-------|-----------|-----------|
| 1 | Mayor | In: human → `gt nudge` mayor | Out: agent-log → topic |
| 2 | Escalations | In: emoji reactions → `gt escalate ack/close` | Out: escalation alerts |
| 3 | Mail Inbox | In: reply-to → `gt mail reply` | Out: `--human` mail forwarded |
| 4 | Crew topics | In: human → `gt nudge` crew session | Out: agent-log → topic |

## Setup

```bash
cp .env.example .env   # Set TELEGRAM_BOT_TOKEN
bun install
```

Edit `gateway.config.json` to set your `supergroup_chat_id` and map Telegram
forum topic `thread_id`s to your GT sessions. The shipped config contains
placeholder values.

## Run

```bash
bun run dev    # Long polling with --watch
bun run start  # Production
```

## Outbound CLI

Send messages to Telegram from GT hooks:

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
