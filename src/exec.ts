import { spawn } from "node:child_process";

/** Run a shell command and return stdout. Throws on non-zero exit. */
export function exec(
  cmd: string,
  args: string[],
  opts?: { stdin?: string; timeout?: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: [opts?.stdin ? "pipe" : "ignore", "pipe", "pipe"],
      timeout: opts?.timeout ?? 30_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    if (opts?.stdin && proc.stdin) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    }

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(
            `${cmd} ${args.join(" ")} exited ${code}: ${stderr || stdout}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ${cmd}: ${err.message}`));
    });
  });
}
