/**
 * Persistent message ID mapping store.
 *
 * Stores telegram_msg_id → application_id mappings in a JSON file so that
 * both the long-running bot process and the standalone outbound CLI can
 * share state. The bot populates the map when sending via grammy; the CLI
 * populates it when sending via the Telegram HTTP API directly.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { env } from "./config";

const MAP_FILE = join(env.logDir, "msg-map.json");

interface MapData {
  mail: Record<string, string>; // telegramMsgId (string key) → mailId
  escalation: Record<string, string>; // telegramMsgId → escalationId
}

function emptyData(): MapData {
  return { mail: {}, escalation: {} };
}

function readMap(): MapData {
  try {
    return JSON.parse(readFileSync(MAP_FILE, "utf-8")) as MapData;
  } catch {
    return emptyData();
  }
}

function writeMap(data: MapData): void {
  mkdirSync(dirname(MAP_FILE), { recursive: true });
  writeFileSync(MAP_FILE, JSON.stringify(data), "utf-8");
}

export function persistMailMapping(
  telegramMsgId: number,
  mailId: string,
): void {
  const data = readMap();
  data.mail[String(telegramMsgId)] = mailId;
  writeMap(data);
}

export function lookupMailMapping(telegramMsgId: number): string | undefined {
  const data = readMap();
  return data.mail[String(telegramMsgId)];
}

export function persistEscalationMapping(
  telegramMsgId: number,
  escalationId: string,
): void {
  const data = readMap();
  data.escalation[String(telegramMsgId)] = escalationId;
  writeMap(data);
}

export function lookupEscalationMapping(
  telegramMsgId: number,
): string | undefined {
  const data = readMap();
  return data.escalation[String(telegramMsgId)];
}
