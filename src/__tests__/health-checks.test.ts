/**
 * Tests for health-checks.ts: built-in health check registrations.
 *
 * Verifies that importing health-checks populates the registry with
 * the expected checks at the correct tiers.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { clearRegistry, getAllChecks, getChecks } from "../health-registry";

// Import to trigger registration
import "../health-checks";

describe("built-in health checks", () => {
  // Note: we don't clearRegistry in beforeEach since importing health-checks.ts
  // registers checks once at module load time. We test the populated state.

  test("registers all expected checks", () => {
    const names = getAllChecks().map((c) => c.name);
    expect(names).toContain("process-alive");
    expect(names).toContain("config-valid");
    expect(names).toContain("telegram-api");
    expect(names).toContain("agent-log-config");
    expect(names).toContain("test-suite");
    expect(names).toContain("nudge-delivery");
    expect(names).toContain("mutation-score");
  });

  test("quick tier has process, config, telegram, and agent-log checks", () => {
    const quickNames = getChecks("quick").map((c) => c.name);
    expect(quickNames).toContain("process-alive");
    expect(quickNames).toContain("config-valid");
    expect(quickNames).toContain("telegram-api");
    expect(quickNames).toContain("agent-log-config");
    // Should NOT include standard/slow checks
    expect(quickNames).not.toContain("test-suite");
    expect(quickNames).not.toContain("nudge-delivery");
    expect(quickNames).not.toContain("mutation-score");
  });

  test("standard tier includes quick + test-suite and nudge-delivery", () => {
    const standardNames = getChecks("standard").map((c) => c.name);
    expect(standardNames).toContain("process-alive");
    expect(standardNames).toContain("test-suite");
    expect(standardNames).toContain("nudge-delivery");
    expect(standardNames).not.toContain("mutation-score");
  });

  test("slow tier includes all checks", () => {
    const slowNames = getChecks("slow").map((c) => c.name);
    expect(slowNames).toContain("mutation-score");
    expect(slowNames).toContain("test-suite");
    expect(slowNames).toContain("process-alive");
  });

  test("config-valid check passes with existing config", async () => {
    const configCheck = getAllChecks().find((c) => c.name === "config-valid");
    expect(configCheck).toBeDefined();
    const result = await configCheck!.check();
    // gateway.config.json exists in the repo, so this should pass
    expect(result.status).toBe("pass");
    expect(result.message).toMatch(/topic\(s\) configured/);
  });

  test("agent-log-config check runs without error", async () => {
    const check = getAllChecks().find((c) => c.name === "agent-log-config");
    expect(check).toBeDefined();
    const result = await check!.check();
    // Should be pass or warn, never fail (config exists)
    expect(["pass", "warn"]).toContain(result.status);
  });
});
