# Controlle

Telegram assistant bot. Uses Haiku for fast responses and `claude -p` for complex tasks.

## Setup

```bash
cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
bun install
```

## Run

```bash
# Long polling (dev)
bun run dev

# Webhook mode (prod) — set WEBHOOK_URL in .env
bun run start
```

## Architecture

Messages flow through: **Telegram → classify (Haiku) → respond (Haiku or claude -p) → log → reply**

- `src/ai/classify.ts` — Haiku decides if a message is easy or hard
- `src/ai/haiku.ts` — Fast path: Anthropic API with Haiku
- `src/ai/claude-p.ts` — Slow path: spawns `claude -p` for deep tasks
- `src/log.ts` — Daily markdown chat logs in `data/`
- `src/telegram.ts` — grammY bot setup and message routing
- `src/index.ts` — Entry point (webhook server or long polling)
