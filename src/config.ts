function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  port: parseInt(process.env.PORT || "3000", 10),
  webhookUrl: process.env.WEBHOOK_URL,
  logDir: process.env.LOG_DIR || "data",
} as const;
