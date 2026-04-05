/**
 * Telegram bot setup and inbound message routing.
 *
 * Routes messages to the appropriate channel handler based on chat_id.
 * Unrecognized chats are ignored with a log message.
 */
import { Bot } from "grammy";
import { env, resolveChannel } from "./config";
import { handleMayorDmInbound } from "./channels/mayor-dm";
import { handleEscalationReaction } from "./channels/escalations";
import { handleMailInboxInbound } from "./channels/mail-inbox";
import { handleCrewInbound } from "./channels/crew";
import { setApi } from "./outbound";

export function createBot(): Bot {
  const bot = new Bot(env.telegramBotToken);

  // Make the bot API available for outbound messages
  setApi(bot.api);

  // --- Inbound text messages: route by channel ---
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const channel = resolveChannel(chatId);

    if (!channel) {
      console.log(
        `[gateway] Ignoring message from unknown chat ${chatId} (${ctx.chat.type})`,
      );
      return;
    }

    switch (channel.type) {
      case "mayor_dm":
        await handleMayorDmInbound(ctx);
        break;
      case "mail_inbox":
        await handleMailInboxInbound(ctx);
        break;
      case "crew":
        await handleCrewInbound(ctx, channel.crewName!, channel.session!);
        break;
      case "escalations":
        // Escalations group is outbound-only for text; inbound is reactions
        await ctx.reply(
          "This channel is for escalation alerts. Use reactions to respond.",
        );
        break;
    }
  });

  // --- Reaction handling (escalations) ---
  bot.on("message_reaction", async (ctx) => {
    const chatId = ctx.chat.id;
    const channel = resolveChannel(chatId);

    if (channel?.type === "escalations") {
      await handleEscalationReaction(ctx);
    }
  });

  // --- /start command ---
  bot.command("start", (ctx) =>
    ctx.reply(
      "Gas Town Gateway active. Messages are routed to the appropriate agent.",
    ),
  );

  // --- /status command: show which channels are configured ---
  bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    const channel = resolveChannel(chatId);
    if (channel) {
      await ctx.reply(
        `This chat is mapped to: ${channel.type}${channel.crewName ? ` (${channel.crewName})` : ""}`,
      );
    } else {
      await ctx.reply(`This chat (${chatId}) is not mapped to any channel.`);
    }
  });

  // --- Error handler ---
  bot.catch((err) => {
    console.error("[gateway] Bot error:", err);
  });

  return bot;
}
