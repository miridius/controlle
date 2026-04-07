# QA Patrol

Automated health checks for Controlle via the health-check registry.

## Quick Reference

```bash
bin/qa-patrol                  # Standard checks (quick + tests + nudge)
bin/qa-patrol --quick          # Process + config + connectivity only (fast)
bin/qa-patrol --with-mutation  # Include Stryker mutation testing (slow)
```

## Health-Check Registry

All checks are defined via `registerHealthCheck()` in `src/health-checks.ts`.
Features register their own health contracts at implementation time.

### Check Tiers

| Tier | Runs in | Description |
|------|---------|-------------|
| quick | `--quick`, default, `--with-mutation` | Fast, no side effects |
| standard | default, `--with-mutation` | Moderate cost (tests, nudge) |
| slow | `--with-mutation` only | Expensive (mutation testing) |

### Built-in Checks

| # | Check | Tier | What 'healthy' looks like |
|---|---|---|---|
| 1 | `process-alive` | quick | PID lock file exists and process responds |
| 2 | `config-valid` | quick | gateway.config.json parses with required fields |
| 3 | `telegram-api` | quick | Bot can reach the Telegram supergroup |
| 4 | `agent-log-config` | quick | Agent-log channels have session + project_dir |
| 5 | `test-suite` | standard | `bun test` passes with zero failures |
| 6 | `nudge-delivery` | standard | `gt nudge` heartbeat reaches all sessions |
| 7 | `mutation-score` | slow | Stryker score >= 50% threshold |

## Adding a Health Check

When implementing a feature that produces observable output, register a health
check so QA patrol can verify it:

```typescript
// In your feature module or in src/health-checks.ts:
import { registerHealthCheck } from "./health-registry";

registerHealthCheck({
  name: "my-feature",
  description: "Feature X produces at least one output per cycle",
  tier: "quick",
  check: async () => {
    // Check observable state
    if (healthy) return { status: "pass", message: "Feature X is healthy" };
    return { status: "fail", message: "Feature X: no output in last 5 minutes" };
  },
});
```

### Health Check Contract

Each check defines:
- **name**: Short identifier (e.g. `process-alive`)
- **description**: What 'healthy' looks like in human-readable form
- **tier**: When to run (`quick`, `standard`, or `slow`)
- **check()**: Async function returning `{ status, message }`

Status values:
- `pass` — check succeeded
- `fail` — check failed (triggers escalation)
- `warn` — non-critical issue (logged but no escalation)

## Failure Reporting

When any check fails, qa-patrol:
1. Prints all results to stdout with timing
2. Posts a HIGH-severity escalation to the Escalations topic via `outbound-cli`
3. Exits with code 1

Warnings are printed but do not trigger escalations or non-zero exit.

## Environment

Requires `TELEGRAM_BOT_TOKEN` (or set in environment).
Runs from the controlle repo root.
