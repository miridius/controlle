/**
 * Tests for exec.ts: shell command execution wrapper.
 */
import { describe, expect, test } from "bun:test";
import { exec } from "../exec";

describe("exec", () => {
  test("returns stdout from successful command", async () => {
    const result = await exec("echo", ["hello world"]);
    expect(result).toBe("hello world");
  });

  test("trims stdout output", async () => {
    const result = await exec("echo", ["  padded  "]);
    expect(result).toBe("padded");
  });

  test("throws on non-zero exit code", async () => {
    await expect(exec("sh", ["-c", "exit 1"])).rejects.toThrow("exited 1");
  });

  test("includes stderr in error message", async () => {
    await expect(
      exec("sh", ["-c", "echo 'err msg' >&2; exit 1"]),
    ).rejects.toThrow("err msg");
  });

  test("passes stdin to process", async () => {
    const result = await exec("cat", [], { stdin: "piped input" });
    expect(result).toBe("piped input");
  });

  test("throws on command not found", async () => {
    await expect(
      exec("nonexistent_command_xyz", []),
    ).rejects.toThrow("Failed to spawn");
  });

  test("respects timeout", async () => {
    await expect(
      exec("sleep", ["10"], { timeout: 100 }),
    ).rejects.toThrow(/exited|timed out|killed/i);
  });
});
