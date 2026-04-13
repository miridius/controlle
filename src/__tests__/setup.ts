// Test setup: set required env vars before any module loads
process.env.TELEGRAM_BOT_TOKEN = "test-token-123";
process.env.LOG_DIR = "/tmp/controlle-test-logs";

// Ensure gateway.config.json exists for tests — copy from the committed example
// if missing. The real config is gitignored (deployment-specific), but tests need it.
import { existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..", "..");
const configPath = join(projectRoot, "gateway.config.json");
const examplePath = join(projectRoot, "gateway.config.example.json");

if (!existsSync(configPath) && existsSync(examplePath)) {
  copyFileSync(examplePath, configPath);
}
