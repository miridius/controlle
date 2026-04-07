/**
 * Tests for health-registry.ts: registration, tier filtering, and check execution.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  registerHealthCheck,
  getChecks,
  getAllChecks,
  runChecks,
  clearRegistry,
  type HealthCheck,
  type HealthCheckResult,
} from "../health-registry";

beforeEach(() => {
  clearRegistry();
});

function makeCheck(
  name: string,
  tier: "quick" | "standard" | "slow",
  result: HealthCheckResult,
): HealthCheck {
  return {
    name,
    description: `${name} check`,
    tier,
    check: async () => result,
  };
}

describe("registerHealthCheck", () => {
  test("adds check to registry", () => {
    registerHealthCheck(makeCheck("a", "quick", { status: "pass", message: "ok" }));
    expect(getAllChecks()).toHaveLength(1);
    expect(getAllChecks()[0].name).toBe("a");
  });

  test("preserves registration order", () => {
    registerHealthCheck(makeCheck("first", "quick", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("second", "standard", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("third", "slow", { status: "pass", message: "" }));
    expect(getAllChecks().map((c) => c.name)).toEqual(["first", "second", "third"]);
  });
});

describe("getChecks", () => {
  beforeEach(() => {
    registerHealthCheck(makeCheck("q1", "quick", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("s1", "standard", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("s2", "standard", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("w1", "slow", { status: "pass", message: "" }));
  });

  test("quick tier returns only quick checks", () => {
    const checks = getChecks("quick");
    expect(checks.map((c) => c.name)).toEqual(["q1"]);
  });

  test("standard tier returns quick + standard checks", () => {
    const checks = getChecks("standard");
    expect(checks.map((c) => c.name)).toEqual(["q1", "s1", "s2"]);
  });

  test("slow tier returns all checks", () => {
    const checks = getChecks("slow");
    expect(checks.map((c) => c.name)).toEqual(["q1", "s1", "s2", "w1"]);
  });
});

describe("runChecks", () => {
  test("runs checks and returns results with duration", async () => {
    registerHealthCheck(makeCheck("a", "quick", { status: "pass", message: "ok" }));
    const results = await runChecks("quick");
    expect(results).toHaveLength(1);
    expect(results[0].check.name).toBe("a");
    expect(results[0].result.status).toBe("pass");
    expect(results[0].result.message).toBe("ok");
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test("catches thrown errors and returns fail status", async () => {
    registerHealthCheck({
      name: "thrower",
      description: "throws an error",
      tier: "quick",
      check: async () => {
        throw new Error("boom");
      },
    });
    const results = await runChecks("quick");
    expect(results[0].result.status).toBe("fail");
    expect(results[0].result.message).toContain("boom");
  });

  test("catches non-Error throws", async () => {
    registerHealthCheck({
      name: "string-thrower",
      description: "throws a string",
      tier: "quick",
      check: async () => {
        throw "string error";
      },
    });
    const results = await runChecks("quick");
    expect(results[0].result.status).toBe("fail");
    expect(results[0].result.message).toContain("string error");
  });

  test("respects tier filtering when running", async () => {
    registerHealthCheck(makeCheck("q", "quick", { status: "pass", message: "q" }));
    registerHealthCheck(makeCheck("s", "standard", { status: "pass", message: "s" }));
    const results = await runChecks("quick");
    expect(results).toHaveLength(1);
    expect(results[0].check.name).toBe("q");
  });

  test("returns results in registration order", async () => {
    registerHealthCheck(makeCheck("c", "quick", { status: "pass", message: "c" }));
    registerHealthCheck(makeCheck("a", "quick", { status: "fail", message: "a" }));
    registerHealthCheck(makeCheck("b", "quick", { status: "warn", message: "b" }));
    const results = await runChecks("quick");
    expect(results.map((r) => r.check.name)).toEqual(["c", "a", "b"]);
  });

  test("runs all tiers for slow", async () => {
    registerHealthCheck(makeCheck("q", "quick", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("s", "standard", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("w", "slow", { status: "pass", message: "" }));
    const results = await runChecks("slow");
    expect(results).toHaveLength(3);
  });
});

describe("clearRegistry", () => {
  test("removes all registered checks", () => {
    registerHealthCheck(makeCheck("a", "quick", { status: "pass", message: "" }));
    registerHealthCheck(makeCheck("b", "standard", { status: "pass", message: "" }));
    clearRegistry();
    expect(getAllChecks()).toHaveLength(0);
  });
});
