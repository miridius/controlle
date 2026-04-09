#!/usr/bin/env bash
# SessionStart hook: start Controlle gateway and inject context.

WORKDIR="/gt/controlle/crew/sam"
RUNTIME="${WORKDIR}/.runtime"
PIDFILE="${RUNTIME}/controlle.pid"
mkdir -p "${RUNTIME}"

# Source .env for credentials
[[ -f "$WORKDIR/.env" ]] && set -a && source "$WORKDIR/.env" && set +a

LOCKFILE="${RUNTIME}/controlle.lock"

# Check if bot is actually running (handles stale PIDs after container restart)
is_running() {
  local pf="$1"
  [[ -f "$pf" ]] || return 1
  local pid
  pid=$(cat "$pf" 2>/dev/null) || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && return 0
  return 1
}

start_controlle() {
  # Clean stale runtime files from previous container
  rm -f "$PIDFILE" "$LOCKFILE"
  cd "$WORKDIR"
  # Unset TMUX vars — the bot is a background daemon, not a tmux pane.
  # If inherited, gt nudge uses the source pane to resolve targets, which
  # breaks cross-session delivery (e.g. crew/sam pane → mayor session).
  unset TMUX TMUX_PANE
  nohup bun run --watch src/index.ts > "${RUNTIME}/controlle.log" 2>&1 &
  echo $! > "$PIDFILE"
}

if is_running "$PIDFILE" || is_running "$LOCKFILE"; then
  :
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
