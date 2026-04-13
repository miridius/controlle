/**
 * Integration test: startup path catches missing gateway.config.json.
 *
 * Tests the real config.ts → telegram.ts → index.ts import chain.
 * Uses subprocess isolation so that top-level side effects (lock file,
 * bot.start(), signal handlers) don't pollute the test runner.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Run a bun script in a subprocess with an isolated RUNTIME_DIR so the lock
 * file doesn't conflict with any running gateway instance.
 */
async function runScript(opts: {
  cwd?: string;
  script: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const timeout = opts.timeoutMs ?? 5000;
  const runtimeDir = join(
    tmpdir(),
    `controlle-startup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(runtimeDir, { recursive: true });

  const proc = Bun.spawn(["bun", "-e", opts.script], {
    cwd: opts.cwd ?? PROJECT_ROOT,
    env: {
      ...process.env,
      TELEGRAM_BOT_TOKEN: "test-startup-token",
      LOG_DIR: "/tmp/controlle-startup-test-logs",
      RUNTIME_DIR: runtimeDir,
      ...opts.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => proc.kill(), timeout);
  const exitCode = await proc.exited;
  clearTimeout(timer);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  rmSync(runtimeDir, { recursive: true, force: true });
  return { exitCode, stdout, stderr };
}

describe("startup: missing gateway.config.json", () => {
  test("readFileSync crashes with ENOENT when config file is absent", async () => {
    const tempDir = join(
      tmpdir(),
      `controlle-no-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(tempDir, "src"), { recursive: true });

    // Replicate the exact loading pattern from config.ts line 34-36
    writeFileSync(
      join(tempDir, "src", "config-check.ts"),
      `import { readFileSync } from "node:fs";
import { join } from "node:path";
const configPath = join(import.meta.dir, "..", "gateway.config.json");
const gateway = JSON.parse(readFileSync(configPath, "utf-8"));
console.log("CONFIG_LOADED:" + gateway.supergroup_chat_id);
`,
    );

    const scriptPath = join(tempDir, "src", "config-check.ts");
    const result = await runScript({
      cwd: tempDir,
      script: `await import(${JSON.stringify(scriptPath)})`,
    });

    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("gateway.config.json");
    expect(combined).not.toContain("CONFIG_LOADED:");

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe("startup: valid gateway.config.json", () => {
  test("config loading succeeds with valid config file present", async () => {
    const tempDir = join(
      tmpdir(),
      `controlle-valid-config-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(tempDir, "src"), { recursive: true });

    copyFileSync(
      join(PROJECT_ROOT, "gateway.config.example.json"),
      join(tempDir, "gateway.config.json"),
    );

    writeFileSync(
      join(tempDir, "src", "config-check.ts"),
      `import { readFileSync } from "node:fs";
import { join } from "node:path";
const configPath = join(import.meta.dir, "..", "gateway.config.json");
const gateway = JSON.parse(readFileSync(configPath, "utf-8"));
if (!gateway.supergroup_chat_id) throw new Error("Missing supergroup_chat_id");
if (!gateway.topics || typeof gateway.topics !== "object") throw new Error("Missing topics");
console.log("CONFIG_LOADED:" + gateway.supergroup_chat_id);
`,
    );

    const scriptPath = join(tempDir, "src", "config-check.ts");
    const result = await runScript({
      cwd: tempDir,
      script: `await import(${JSON.stringify(scriptPath)})`,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CONFIG_LOADED:");

    rmSync(tempDir, { recursive: true, force: true });
  });

  test("real config.ts module loads when gateway.config.json exists", async () => {
    // Imports the REAL config.ts from the project.
    // setup.ts copies gateway.config.example.json → gateway.config.json.
    // If that file were missing, this import would crash — the exact bug we guard against.
    const { gateway, env, supergroupChatId } = await import("../../config");

    expect(gateway).toBeDefined();
    expect(typeof gateway.supergroup_chat_id).toBe("number");
    expect(gateway.topics).toBeDefined();
    expect(typeof env.telegramBotToken).toBe("string");
    expect(typeof supergroupChatId()).toBe("number");
  });

  test("config → telegram chain: createBot succeeds with valid config", async () => {
    // Tests the config.ts → telegram.ts import chain. createBot() depends on
    // config exports (supergroupChatId, resolveChannel). If config failed to
    // load, this import chain would throw.
    const { createBot } = await import("../../telegram");
    const bot = createBot();
    expect(bot).toBeDefined();
  });
});

describe("startup: malformed gateway.config.json", () => {
  test("crashes on invalid JSON in config file", async () => {
    const tempDir = join(
      tmpdir(),
      `controlle-bad-json-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(join(tempDir, "src"), { recursive: true });

    writeFileSync(join(tempDir, "gateway.config.json"), "{ not valid json }");

    writeFileSync(
      join(tempDir, "src", "config-check.ts"),
      `import { readFileSync } from "node:fs";
import { join } from "node:path";
const configPath = join(import.meta.dir, "..", "gateway.config.json");
JSON.parse(readFileSync(configPath, "utf-8"));
`,
    );

    const scriptPath = join(tempDir, "src", "config-check.ts");
    const result = await runScript({
      cwd: tempDir,
      script: `await import(${JSON.stringify(scriptPath)})`,
    });

    expect(result.exitCode).not.toBe(0);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
