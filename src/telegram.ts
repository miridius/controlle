/**
 * Telegram bot setup and inbound message routing.
 *
 * Routes messages to the appropriate channel handler based on
 * message_thread_id (forum topic) within the single supergroup.
 * Unrecognized topics or chats are ignored with a log message.
 */
import { Bot } from "grammy";
import { env, resolveChannel, supergroupChatId } from "./config";
import { handleMayorInbound } from "./channels/mayor-dm";
import { handleEscalationReaction } from "./channels/escalations";
import { handleMailInboxInbound } from "./channels/mail-inbox";
import { handleCrewInbound } from "./channels/crew";
import { setApi } from "./outbound";
import { reportError } from "./error-handler";

export function createBot(): Bot {
  const bot = new Bot(env.telegramBotToken);

  // Make the bot API available for outbound messages
  setApi(bot.api);

  const groupId = supergroupChatId();

  // --- Inbound text messages: route by forum topic thread_id ---
  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;

    // Only process messages from our supergroup
    if (chatId !== groupId) {
      console.log(
        `[gateway] Ignoring message from unknown chat ${chatId} (${ctx.chat.type})`,
      );
      return;
    }

    const threadId = ctx.message.message_thread_id;
    if (!threadId) {
      console.log(
        "[gateway] Ignoring message without thread_id (general topic)",
      );
      return;
    }

    const channel = resolveChannel(threadId);
    if (!channel) {
      console.log(
        `[gateway] Ignoring message from unknown topic thread ${threadId}`,
      );
      return;
    }

    switch (channel.type) {
      case "mayor":
        await handleMayorInbound(ctx);
        break;
      case "mail_inbox":
        await handleMailInboxInbound(ctx);
        break;
      case "crew":
        await handleCrewInbound(ctx, channel.crewName!, channel.session!);
        break;
      case "escalations":
        // Escalations topic is outbound-only for text; inbound is reactions
        await ctx.reply(
          "This topic is for escalation alerts. Use reactions to respond.",
          { message_thread_id: threadId },
        );
        break;
    }
  });

  // --- Reaction handling (escalations) ---
  bot.on("message_reaction", async (ctx) => {
    const chatId = ctx.chat.id;
    if (chatId !== groupId) return;

    // Reactions in the escalations topic (or any topic with tracked messages)
    await handleEscalationReaction(ctx);
  });

  // --- /start command ---
  bot.command("start", (ctx) =>
    ctx.reply(
      "Gas Town Gateway active. Messages are routed by forum topic.",
    ),
  );

  // --- /status command: show which topic this message is in ---
  bot.command("status", async (ctx) => {
    const threadId = ctx.message?.message_thread_id;
    if (!threadId) {
      await ctx.reply("Send this command in a forum topic to see its mapping.");
      return;
    }
    const channel = resolveChannel(threadId);
    if (channel) {
      await ctx.reply(
        `This topic is mapped to: ${channel.type}${channel.crewName ? ` (${channel.crewName})` : ""}`,
        { message_thread_id: threadId },
      );
    } else {
      await ctx.reply(
        `This topic (thread ${threadId}) is not mapped to any channel.`,
        { message_thread_id: threadId },
      );
    }
  });

  // --- Error handler ---
  bot.catch((err) => {
    reportError("bot", err.error ?? err, "medium");
  });

  return bot;
}
