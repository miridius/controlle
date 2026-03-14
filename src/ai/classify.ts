import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export type Difficulty = "easy" | "hard";

export async function classifyMessage(message: string): Promise<Difficulty> {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 10,
    system: `Classify whether this user message needs a simple quick response ("easy") or requires deep reasoning, research, code generation, or complex analysis ("hard"). Reply with exactly one word: easy or hard.`,
    messages: [{ role: "user", content: message }],
  });

  const block = response.content[0];
  if (block.type !== "text") return "easy";
  const answer = block.text.trim().toLowerCase();
  return answer === "hard" ? "hard" : "easy";
}
