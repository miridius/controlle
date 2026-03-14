import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "./config";

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return join(env.logDir, `${yyyy}-${mm}-${dd}.log`);
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export async function log(
  channel: string,
  direction: "in" | "out",
  from: string,
  text: string,
): Promise<void> {
  await mkdir(env.logDir, { recursive: true });
  const line = `[${timestamp()}] [${channel}] ${direction === "in" ? "→" : "←"} ${from}: ${text}\n`;
  await appendFile(todayFile(), line, "utf-8");
}
