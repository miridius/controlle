#!/usr/bin/env bash
# SessionStart hook: start Controlle gateway and inject context.

WORKDIR="/gt/controlle/crew/sam"
RUNTIME="${WORKDIR}/.runtime"
PIDFILE="${RUNTIME}/controlle.pid"
mkdir -p "${RUNTIME}"

# Start Controlle if not already running
start_controlle() {
  cd "$WORKDIR"
  TELEGRAM_BOT_TOKEN="8714425840:AAG9Wp_CEV-TqhesGErhn2cEShL3gA22eGc" \
    nohup bun run --watch src/index.ts > "${RUNTIME}/controlle.log" 2>&1 &
  echo $! > "$PIDFILE"
}

if [[ -f "$PIDFILE" ]]; then
  pid=$(cat "$PIDFILE")
  if kill -0 "$pid" 2>/dev/null; then
    :
  else
    start_controlle
  fi
else
  start_controlle
fi

# Inject context
cat <<'EOF'
Controlle gateway is running. Dave communicates via Telegram in the Gas Town supergroup.
His messages arrive as nudges. The crew/sam topic (thread 10) routes to this session.

Your full transcript is streamed to Telegram via agent-log. Just respond normally — Dave sees everything.
Do NOT use tg-group for manual replies. Agent-log IS the outbound channel.
Ack messages with: bin/tg-ack <msg_id>
EOF
