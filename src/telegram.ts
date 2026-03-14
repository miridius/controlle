import { Bot } from "grammy";
import { config } from "./config";
import { classifyMessage } from "./ai/classify";
import { askHaiku } from "./ai/haiku";
import { askClaudeP } from "./ai/claude-p";
import { appendLog } from "./log";

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  bot.command("start", (ctx) =>
    ctx.reply("Hey! I'm Controlle. Send me a message and I'll help out."),
  );

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const username = ctx.from.username || ctx.from.first_name || "user";

    await appendLog("user", username, text);

    const difficulty = await classifyMessage(text);
    let reply: string;

    if (difficulty === "hard") {
      await ctx.replyWithChatAction("typing");
      try {
        reply = await askClaudeP(text);
      } catch (err) {
        console.error("claude -p failed, falling back to haiku:", err);
        reply = await askHaiku(text);
      }
    } else {
      reply = await askHaiku(text);
    }

    await appendLog("assistant", "bot", reply);
    await ctx.reply(reply, { parse_mode: "Markdown" });
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}
