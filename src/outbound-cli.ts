#!/usr/bin/env bun
/**
 * CLI for sending messages to Telegram from GT hooks/scripts.
 *
 * All messages go to the single supergroup, targeted by forum topic thread_id.
 *
 * Usage:
 *   bun run src/outbound-cli.ts escalation <severity> <id> <description> [source]
 *   bun run src/outbound-cli.ts mail <mail-id> <from> <subject> <body>
 *   bun run src/outbound-cli.ts send <thread_id> <text>
 *   echo "text" | bun run src/outbound-cli.ts send <thread_id> --stdin
 */
import { env, gateway } from "./config";
import { persistMailMapping, persistEscalationMapping } from "./msg-map";
import { reportErrorDirect } from "./error-handler";

const TELEGRAM_API = `https://api.telegram.org/bot${env.telegramBotToken}`;
const SUPERGROUP_CHAT_ID = gateway.supergroup_chat_id;

async function telegramSend(
  threadId: number,
  text: string,
  parseMode?: string,
): Promise<number> {
  const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: SUPERGROUP_CHAT_ID,
      message_thread_id: threadId,
      text,
      parse_mode: parseMode,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram API error ${resp.status}: ${body}`);
  }
  const result = (await resp.json()) as { result: { message_id: number } };
  return result.result.message_id;
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks.join("");
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "escalation": {
      const [severity, id, description, source] = args;
      if (!severity || !id || !description) {
        console.error(
          "Usage: outbound-cli escalation <severity> <id> <description> [source]",
        );
        process.exit(1);
      }
      const icon =
        severity === "critical"
          ? "🔴"
          : severity === "high"
            ? "🟠"
            : severity === "medium"
              ? "🟡"
              : "🔵";
      const text = [
        `${icon} <b>Escalation [${severity.toUpperCase()}]</b>`,
        `<b>ID:</b> <code>${id}</code>`,
        source ? `<b>Source:</b> ${source}` : null,
        "",
        description,
        "",
        "React 👍 to ack, ✅ to resolve",
      ]
        .filter((l) => l !== null)
        .join("\n");
      const escTopic = gateway.topics.escalations;
      if (!escTopic) throw new Error("No 'escalations' topic in config");
      const escMsgId = await telegramSend(escTopic.thread_id, text, "HTML");
      persistEscalationMapping(escMsgId, id);
      console.log(`Escalation ${id} sent to Telegram (msg ${escMsgId}).`);
      break;
    }

    case "mail": {
      const [mailId, from, subject, ...bodyParts] = args;
      if (!mailId || !from || !subject) {
        console.error(
          "Usage: outbound-cli mail <mail-id> <from> <subject> <body>",
        );
        process.exit(1);
      }
      const body = bodyParts.join(" ") || (await readStdin());
      const text = [
        `📬 <b>Mail from ${escapeHtml(from)}</b>`,
        `<b>Subject:</b> ${escapeHtml(subject)}`,
        `<b>ID:</b> <code>${mailId}</code>`,
        "",
        escapeHtml(body),
        "",
        "Reply to this message to respond.",
      ].join("\n");
      const mailTopic = gateway.topics.mail_inbox;
      if (!mailTopic) throw new Error("No 'mail_inbox' topic in config");
      const mailMsgId = await telegramSend(mailTopic.thread_id, text, "HTML");
      persistMailMapping(mailMsgId, mailId);
      console.log(`Mail ${mailId} sent to Telegram (msg ${mailMsgId}).`);
      break;
    }

    case "send": {
      const [threadIdStr, ...textParts] = args;
      if (!threadIdStr) {
        console.error("Usage: outbound-cli send <thread_id> <text>|--stdin");
        process.exit(1);
      }
      const threadId = parseInt(threadIdStr, 10);
      let text: string;
      if (textParts[0] === "--stdin") {
        text = await readStdin();
      } else {
        text = textParts.join(" ");
      }
      if (!text) {
        console.error("No text provided.");
        process.exit(1);
      }
      await telegramSend(threadId, text);
      console.log("Message sent.");
      break;
    }

    default:
      console.error(
        "Usage: outbound-cli <escalation|mail|send> [args...]",
      );
      process.exit(1);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

main().catch(async (err) => {
  console.error(err);
  await reportErrorDirect(
    env.telegramBotToken,
    SUPERGROUP_CHAT_ID,
    gateway.topics.escalations?.thread_id ?? 0,
    "outbound-cli",
    err,
  );
  process.exit(1);
});
