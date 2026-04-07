/**
 * Health-check registry: features define 'healthy' observable state.
 *
 * Every feature that produces observable output registers a health check here.
 * The QA patrol runner collects all registered checks and runs them by tier.
 *
 * Tiers control when checks run:
 *   - quick:    fast, no side effects (process alive, config valid)
 *   - standard: moderate cost (test suite, nudge delivery)
 *   - slow:     expensive (mutation testing, load tests)
 *
 * Usage:
 *   import { registerHealthCheck } from "./health-registry";
 *   registerHealthCheck({
 *     name: "my-feature",
 *     description: "Feature X produces at least one output per cycle",
 *     tier: "quick",
 *     check: async () => ({ status: "pass", message: "Feature X is healthy" }),
 *   });
 */

export type HealthStatus = "pass" | "fail" | "warn";
export type CheckTier = "quick" | "standard" | "slow";

export interface HealthCheckResult {
  status: HealthStatus;
  message: string;
}

export interface HealthCheck {
  /** Short identifier (e.g. "process-alive", "telegram-api") */
  name: string;
  /** Human-readable description of what healthy looks like */
  description: string;
  /** When this check runs: quick < standard < slow */
  tier: CheckTier;
  /** Execute the check. Must not throw — return fail status instead. */
  check: () => Promise<HealthCheckResult>;
}

export interface CheckRunResult {
  check: HealthCheck;
  result: HealthCheckResult;
  durationMs: number;
}

const TIER_ORDER: CheckTier[] = ["quick", "standard", "slow"];

const checks: HealthCheck[] = [];

/** Register a health check. Checks run in registration order. */
export function registerHealthCheck(check: HealthCheck): void {
  checks.push(check);
}

/** Get checks up to and including the given tier. */
export function getChecks(maxTier: CheckTier): HealthCheck[] {
  const maxIndex = TIER_ORDER.indexOf(maxTier);
  return checks.filter((c) => TIER_ORDER.indexOf(c.tier) <= maxIndex);
}

/** Get all registered checks regardless of tier. */
export function getAllChecks(): HealthCheck[] {
  return [...checks];
}

/** Run all checks up to the given tier. Returns results in registration order. */
export async function runChecks(maxTier: CheckTier): Promise<CheckRunResult[]> {
  const applicable = getChecks(maxTier);
  const results: CheckRunResult[] = [];

  for (const check of applicable) {
    const start = Date.now();
    let result: HealthCheckResult;
    try {
      result = await check.check();
    } catch (err) {
      result = {
        status: "fail",
        message: `Check threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    results.push({ check, result, durationMs: Date.now() - start });
  }

  return results;
}

/** Clear all registered checks (for testing). */
export function clearRegistry(): void {
  checks.length = 0;
}
