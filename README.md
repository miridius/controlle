# Controlle — Gas Town Telegram Gateway

Four-channel Telegram gateway bridging human operators with Gas Town agents.

## Channels

| # | Channel | Direction | Mechanism |
|---|---------|-----------|-----------|
| 1 | Bot DM (Mayor) | In: human → `gt nudge` mayor | Out: agent-log → DM |
| 2 | Escalations Group | In: emoji reactions → `gt escalate ack/close` | Out: escalation alerts |
| 3 | Mail Inbox Group | In: reply-to → `gt mail reply` | Out: `--human` mail forwarded |
| 4 | Crew Chat Groups | In: human → `gt nudge` crew session | Out: agent-log → group |

## Setup

```bash
cp .env.example .env   # Set TELEGRAM_BOT_TOKEN
bun install
```

Edit `gateway.config.json` to map Telegram chat/group IDs to GT sessions.

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
├── telegram.ts           grammY bot setup, inbound routing by chat_id
├── exec.ts               Shell command helper (gt nudge, gt mail, etc.)
├── log.ts                Gateway event logging
├── outbound.ts           Bot API outbound send (escalations, mail, streaming)
├── outbound-cli.ts       CLI for GT hooks to send to Telegram
├── agent-log-watcher.ts  Watches Claude JSONL transcripts → Telegram
└── channels/
    ├── mayor-dm.ts       Channel 1: Mayor direct line
    ├── escalations.ts    Channel 2: Escalation alerts + reaction handling
    ├── mail-inbox.ts     Channel 3: Mail inbox + reply routing
    └── crew.ts           Channel 4: Crew chat groups
```
