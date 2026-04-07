/**
 * CLI runner for the health-check registry.
 *
 * Usage:
 *   bun run src/run-health-checks.ts [--quick|--standard|--slow]
 *
 * Imports all registered health checks, runs them at the specified tier,
 * and reports results. Posts to Escalations topic on failures.
 *
 * Exit code: 0 = all pass, 1 = failures found.
 */
import { runChecks, type CheckTier, type CheckRunResult } from "./health-registry";

// Import health checks to populate the registry
import "./health-checks";

function parseTier(args: string[]): CheckTier {
  for (const arg of args) {
    if (arg === "--quick") return "quick";
    if (arg === "--standard") return "standard";
    if (arg === "--slow") return "slow";
    if (arg === "--with-mutation") return "slow"; // backward compat
    if (arg === "-h" || arg === "--help") {
      console.log(`Usage: bun run src/run-health-checks.ts [--quick|--standard|--slow]

Tiers:
  --quick     Fast checks only (process, config, connectivity)
  --standard  Quick + moderate checks (tests, nudge delivery) [default]
  --slow      All checks including mutation testing`);
      process.exit(0);
    }
  }
  return "standard";
}

function statusIcon(status: string): string {
  switch (status) {
    case "pass": return "PASS";
    case "fail": return "FAIL";
    case "warn": return "WARN";
    default: return "????";
  }
}

async function reportFailures(failures: CheckRunResult[]): Promise<void> {
  // Report to Escalations topic via outbound-cli
  const failureText = failures
    .map((f) => `${f.check.name}: ${f.result.message}`)
    .join("\\n");

  try {
    const { exec } = await import("./exec");
    await exec("bun", [
      "run",
      "src/outbound-cli.ts",
      "escalation",
      "high",
      `qa-patrol-${Date.now()}`,
      `QA Patrol found ${failures.length} failure(s): ${failureText}`,
      "qa-patrol",
    ], { timeout: 15_000 });
  } catch {
    console.error("[qa-patrol] Warning: failed to report to Escalations topic");
  }
}

async function main(): Promise<void> {
  const tier = parseTier(process.argv.slice(2));

  console.log(`[qa-patrol] Running health checks (tier: ${tier})...\n`);

  const results = await runChecks(tier);

  // Print results
  for (const { check, result, durationMs } of results) {
    console.log(`  ${statusIcon(result.status)}: ${result.message} (${durationMs}ms)`);
  }

  // Summary
  const failures = results.filter((r) => r.result.status === "fail");
  const warnings = results.filter((r) => r.result.status === "warn");
  const passes = results.filter((r) => r.result.status === "pass");

  console.log("\n==========================================");
  console.log(`[qa-patrol] Results: ${passes.length} pass, ${failures.length} fail, ${warnings.length} warn`);
  console.log("==========================================");

  if (failures.length > 0) {
    console.log("\nFAILURES:");
    for (const f of failures) {
      console.log(`  - ${f.check.name}: ${f.result.message}`);
    }
    await reportFailures(failures);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log("\nWARNINGS:");
    for (const w of warnings) {
      console.log(`  - ${w.check.name}: ${w.result.message}`);
    }
  }

  console.log("\n[qa-patrol] All checks passed.");
}

main().catch((err) => {
  console.error("[qa-patrol] Fatal error:", err);
  process.exit(2);
});
