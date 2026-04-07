/**
 * Built-in health checks for Controlle gateway.
 *
 * Registers all standard checks into the health registry. Import this module
 * to populate the registry before running checks.
 *
 * Checks (in registration order):
 *   1. process-alive     (quick)    — Controlle gateway process is running
 *   2. config-valid      (quick)    — gateway.config.json is parseable with required fields
 *   3. telegram-api      (quick)    — Bot can reach the Telegram supergroup
 *   4. agent-log-config  (quick)    — Agent-log channels have required project_dir
 *   5. test-suite        (standard) — bun test passes
 *   6. nudge-delivery    (standard) — gt nudge reaches configured sessions
 *   7. mutation-score    (slow)     — Stryker mutation score meets threshold
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { registerHealthCheck, type HealthCheckResult } from "./health-registry";
import { exec } from "./exec";

const REPO_DIR = join(dirname(import.meta.dir));

function pass(message: string): HealthCheckResult {
  return { status: "pass", message };
}

function fail(message: string): HealthCheckResult {
  return { status: "fail", message };
}

function warn(message: string): HealthCheckResult {
  return { status: "warn", message };
}

// --- 1. Process alive (quick) ---

registerHealthCheck({
  name: "process-alive",
  description: "Controlle gateway process is running (PID lock file valid)",
  tier: "quick",
  check: async () => {
    const runtimeDir = process.env.RUNTIME_DIR || join(REPO_DIR, ".runtime");
    const lockFile = join(runtimeDir, "controlle.lock");

    if (!existsSync(lockFile)) {
      // Fallback: check via process list
      try {
        await exec("pgrep", ["-f", "bun.*src/index.ts"]);
        return warn("Process running but no lock file found");
      } catch {
        return fail("Process not running (no lock file, no matching process)");
      }
    }

    const pid = readFileSync(lockFile, "utf-8").trim();
    if (!pid) return fail("Lock file exists but is empty");

    try {
      process.kill(parseInt(pid, 10), 0);
      return pass(`Process running (PID ${pid})`);
    } catch {
      return fail(`Lock file exists but process (PID ${pid}) is dead`);
    }
  },
});

// --- 2. Config valid (quick) ---

registerHealthCheck({
  name: "config-valid",
  description: "gateway.config.json is parseable with supergroup_chat_id and topics",
  tier: "quick",
  check: async () => {
    const configPath = join(REPO_DIR, "gateway.config.json");
    if (!existsSync(configPath)) {
      return fail("gateway.config.json not found");
    }

    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (!config.supergroup_chat_id) {
        return fail("Missing supergroup_chat_id in config");
      }
      if (!config.topics || Object.keys(config.topics).length === 0) {
        return fail("No topics configured");
      }
      const topicCount = Object.keys(config.topics).length;
      return pass(`Config valid: ${topicCount} topic(s) configured`);
    } catch (err) {
      return fail(`Config parse error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

// --- 3. Telegram API reachable (quick) ---

registerHealthCheck({
  name: "telegram-api",
  description: "Bot can reach the Telegram supergroup via getChat",
  tier: "quick",
  check: async () => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return warn("No TELEGRAM_BOT_TOKEN available");

    const configPath = join(REPO_DIR, "gateway.config.json");
    let chatId: number;
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      chatId = config.supergroup_chat_id;
    } catch {
      return fail("Cannot read supergroup_chat_id from config");
    }

    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${botToken}/getChat?chat_id=${chatId}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const data = (await resp.json()) as { ok: boolean };
      if (data.ok) {
        return pass("Bot can reach supergroup");
      }
      return fail(`Cannot reach supergroup (chat_id: ${chatId})`);
    } catch (err) {
      return fail(`Telegram API error: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

// --- 4. Agent-log config (quick) ---

registerHealthCheck({
  name: "agent-log-config",
  description: "Agent-log channels have session and project_dir configured",
  tier: "quick",
  check: async () => {
    const configPath = join(REPO_DIR, "gateway.config.json");
    let config: { topics: Record<string, { agent_log?: boolean; session?: string; project_dir?: string }> };
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return fail("Cannot read config");
    }

    const issues: string[] = [];
    let agentLogCount = 0;

    for (const [label, ch] of Object.entries(config.topics)) {
      if (!ch.agent_log) continue;
      agentLogCount++;
      if (!ch.session) issues.push(`${label}: missing session`);
      if (!ch.project_dir) issues.push(`${label}: missing project_dir`);
    }

    if (agentLogCount === 0) {
      return warn("No agent_log channels configured");
    }
    if (issues.length > 0) {
      return warn(`Agent-log config issues: ${issues.join("; ")}`);
    }
    return pass(`${agentLogCount} agent-log channel(s) fully configured`);
  },
});

// --- 5. Test suite (standard) ---

registerHealthCheck({
  name: "test-suite",
  description: "bun test passes with zero failures",
  tier: "standard",
  check: async () => {
    try {
      await exec("bun", ["test"], { timeout: 60_000 });
      return pass("Test suite passed");
    } catch (err) {
      return fail(`Test suite failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});

// --- 6. Nudge delivery (standard) ---

registerHealthCheck({
  name: "nudge-delivery",
  description: "gt nudge heartbeat reaches each configured session",
  tier: "standard",
  check: async () => {
    const configPath = join(REPO_DIR, "gateway.config.json");
    let config: { topics: Record<string, { session?: string }> };
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      return fail("Cannot read config");
    }

    const sessions: Array<{ label: string; session: string }> = [];
    for (const [label, ch] of Object.entries(config.topics)) {
      if (ch.session) sessions.push({ label, session: ch.session });
    }

    if (sessions.length === 0) {
      return warn("No sessions configured for nudge delivery test");
    }

    const failures: string[] = [];
    for (const { label, session } of sessions) {
      try {
        await exec("gt", ["nudge", session, "--stdin"], {
          stdin: "<qa-patrol>heartbeat</qa-patrol>",
          timeout: 15_000,
        });
      } catch {
        failures.push(label);
      }
    }

    if (failures.length > 0) {
      return warn(`Nudge delivery failed for: ${failures.join(", ")} (sessions may be inactive)`);
    }
    return pass(`Nudge delivery OK for ${sessions.length} session(s)`);
  },
});

// --- 7. Mutation score (slow) ---

const MUTATION_THRESHOLD = 50;

registerHealthCheck({
  name: "mutation-score",
  description: `Stryker mutation score meets ${MUTATION_THRESHOLD}% threshold`,
  tier: "slow",
  check: async () => {
    try {
      await exec("npx", ["stryker", "run"], { timeout: 300_000 });
    } catch (err) {
      return fail(`Stryker run failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const reportPath = join(REPO_DIR, "reports", "mutation", "mutation.json");
    if (!existsSync(reportPath)) {
      return warn("Mutation report not found");
    }

    try {
      const report = JSON.parse(readFileSync(reportPath, "utf-8"));
      const files = report.files || {};
      let killed = 0;
      let total = 0;
      for (const file of Object.values(files) as Array<{ mutants?: Array<{ status: string }> }>) {
        for (const m of file.mutants || []) {
          total++;
          if (m.status === "Killed") killed++;
        }
      }
      const score = total > 0 ? Math.round((killed / total) * 100) : 0;
      if (score >= MUTATION_THRESHOLD) {
        return pass(`Mutation score: ${score}% (threshold: ${MUTATION_THRESHOLD}%)`);
      }
      return fail(`Mutation score: ${score}% below threshold (${MUTATION_THRESHOLD}%)`);
    } catch (err) {
      return fail(`Cannot parse mutation report: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
