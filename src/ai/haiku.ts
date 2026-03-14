import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { readRecentContext } from "../log";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `You are a helpful Telegram assistant called Controlle. Be concise and direct.`;

export async function askHaiku(userMessage: string): Promise<string> {
  const recentContext = await readRecentContext();

  const messages: Anthropic.MessageParam[] = [];
  if (recentContext) {
    messages.push({
      role: "user",
      content: `[Recent chat context]\n${recentContext}`,
    });
    messages.push({
      role: "assistant",
      content: "Understood, I have the recent context.",
    });
  }
  messages.push({ role: "user", content: userMessage });

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const block = response.content[0];
  if (block.type !== "text") return "(no text response)";
  return block.text;
}
