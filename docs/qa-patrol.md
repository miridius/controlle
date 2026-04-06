# QA Patrol

Automated health checks for Controlle. Runs tests, verifies the gateway process
is alive, checks Telegram API connectivity, and validates nudge delivery.

## Quick Reference

```bash
bin/qa-patrol                  # Standard checks (tests + process + connectivity)
bin/qa-patrol --quick          # Process + connectivity only (fast)
bin/qa-patrol --with-mutation  # Include Stryker mutation testing (slow)
```

## Checks Performed

| # | Check | `--quick` | Default | `--with-mutation` |
|---|---|---|---|---|
| 1 | Test suite (`bun test`) | skip | run | run |
| 2 | Mutation score (Stryker, threshold 50%) | skip | skip | run |
| 3 | Controlle process alive (PID lock file) | run | run | run |
| 4 | Telegram API reachable (bot can see supergroup) | run | run | run |
| 5 | Nudge delivery to each configured session | skip | run | run |

## Failure Reporting

When any check fails, qa-patrol:
1. Prints the failure to stdout
2. Posts a HIGH-severity escalation to the Escalations topic via `outbound-cli`
3. Exits with code 1

Warnings (non-critical issues like inactive sessions) are printed but do not
trigger escalations or non-zero exit.

## Scheduling as a Bead

To run qa-patrol on a schedule (e.g., daily or after each merge):

```bash
# Create a recurring QA bead
bd create --title "QA Patrol: Controlle health check" \
  --description "Run bin/qa-patrol and report findings" \
  --type task

# Or trigger from a merge-queue hook (in Refinery config):
# post-merge: cd /gt/controlle && bin/qa-patrol
```

## Environment

Requires `TELEGRAM_BOT_TOKEN` (or extracts it from `bin/tg-ack`).
Runs from the controlle repo root.
