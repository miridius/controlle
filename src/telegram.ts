/**
 * Telegram bot setup and inbound message routing.
 *
 * Routes messages to the appropriate channel handler based on
 * message_thread_id (forum topic) within the single supergroup.
 * Topics with a session are agent topics (generic nudge handler).
 * Escalations and mail_inbox have specialized inbound handling.
 * Unrecognized topics or chats are ignored with a log message.
 */
import { Bot } from "grammy";
import { env, resolveChannel, supergroupChatId } from "./config";
import { handleAgentInbound } from "./channels/agent";
import { handleEscalationReaction } from "./channels/escalations";
import { handleMailInboxInbound } from "./channels/mail-inbox";
import { setApi } from "./outbound";
import { reportError } from "./error-handler";
import { formatHealthReport, recordInbound } from "./health";

/**
 * Dedup ring buffer: track recently seen Telegram update_ids to prevent
 * duplicate processing when Telegram redelivers updates (e.g., slow handler).
 */
const DEDUP_CAPACITY = 1000;
const seenUpdateIds = new Set<number>();
const seenUpdateIdQueue: number[] = [];

function isDuplicateUpdate(updateId: number): boolean {
  if (seenUpdateIds.has(updateId)) return true;
  seenUpdateIds.add(updateId);
  seenUpdateIdQueue.push(updateId);
  if (seenUpdateIdQueue.length > DEDUP_CAPACITY) {
    const oldest = seenUpdateIdQueue.shift()!;
    seenUpdateIds.delete(oldest);
  }
  return false;
}

export function createBot(): Bot {
  const bot = new Bot(env.telegramBotToken);

  // Make the bot API available for outbound messages
  setApi(bot.api);

  const groupId = supergroupChatId();

  // --- Dedup middleware: skip already-processed updates ---
  bot.use(async (ctx, next) => {
    if (isDuplicateUpdate(ctx.update.update_id)) {
      console.log(
        `[gateway] Dropping duplicate update_id ${ctx.update.update_id}`,
      );
      return;
    }
    await next();
  });

  // --- /health command: show gateway liveness ---
  bot.command("health", async (ctx) => {
    await ctx.reply(formatHealthReport(), {
      message_thread_id: ctx.message?.message_thread_id,
    });
  });

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

    recordInbound();

    if (channel.isEscalations) {
      // Escalations topic is outbound-only for text; inbound is reactions
      await ctx.reply(
        "This topic is for escalation alerts. Use reactions to respond.",
        { message_thread_id: threadId },
      );
    } else if (channel.isMailInbox) {
      await handleMailInboxInbound(ctx);
    } else if (channel.session) {
      // Any topic with a session is an agent topic
      await handleAgentInbound(ctx, channel.label, channel.session, channel.rig);
    } else {
      console.log(
        `[gateway] Topic "${channel.label}" has no session configured, ignoring message`,
      );
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
        `This topic is mapped to: ${channel.label}`,
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
