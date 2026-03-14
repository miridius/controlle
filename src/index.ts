import { config } from "./config";
import { createBot } from "./telegram";

const bot = createBot();

if (config.webhookUrl) {
  // Webhook mode — start HTTP server
  bot.api.setWebhook(config.webhookUrl);
  const { webhookCallback } = await import("grammy");
  const server = Bun.serve({
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/webhook" && req.method === "POST") {
        const handler = webhookCallback(bot, "std/http");
        return handler(req);
      }
      return new Response("ok");
    },
  });
  console.log(`Webhook server listening on port ${server.port}`);
} else {
  // Long polling mode — simpler for development
  console.log("Starting bot in long polling mode...");
  bot.start();
}
