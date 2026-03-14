import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";

function todayFile(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return join(config.logDir, `${yyyy}-${mm}-${dd}.md`);
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export async function appendLog(
  role: "user" | "assistant",
  username: string,
  text: string,
): Promise<void> {
  await mkdir(config.logDir, { recursive: true });
  const line = `**${timestamp()} ${role === "user" ? username : "bot"}:** ${text}\n\n`;
  await appendFile(todayFile(), line, "utf-8");
}

export async function readRecentContext(maxLines = 50): Promise<string> {
  try {
    const content = await readFile(todayFile(), "utf-8");
    const lines = content.split("\n");
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
