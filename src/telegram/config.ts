import * as fs from "node:fs";
import * as path from "node:path";
import * as dns from "node:dns";
import type { TelegramConfig } from "./types.js";

// Ensure IPv4 is resolved first on Node 24+ to eliminate IPv6 network timeouts / ETIMEDOUT
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Ignore on unsupported runtime versions
}

export const DEFAULT_CONFIG: TelegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  botTokenPath: path.join(process.env.HOME || "/home/amadeus", ".config/telegram/token"),
  allowedUsers: [7273048535], // Amadeus (@amad3us)
  allowedUsernames: ["amad3us"],
  autoStart: true,
  progressMode: "edit",
  progressCooldownSeconds: 3,
};

export function getHomeDir(): string {
  return process.env.HOME || "/home/amadeus";
}

export function getMediaDir(): string {
  const dir = path.join(getHomeDir(), ".pi/agent/media/telegram");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadConfig(): TelegramConfig {
  const configPath = path.join(getHomeDir(), ".config/telegram/config.json");
  let cfg = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      cfg = { ...cfg, ...data };
    } catch {
      // fallback
    }
  }

  // Load token from path if not explicitly provided
  if (!cfg.botToken && cfg.botTokenPath && fs.existsSync(cfg.botTokenPath)) {
    try {
      cfg.botToken = fs.readFileSync(cfg.botTokenPath, "utf-8").trim();
    } catch {
      // ignore
    }
  }

  return cfg;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
