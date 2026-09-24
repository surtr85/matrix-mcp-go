import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as dns from "node:dns";
import type { TelegramConfig } from "./types.js";

// Ensure IPv4 is resolved first on Node 24+ to eliminate IPv6 network timeouts / ETIMEDOUT
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Ignore on unsupported runtime versions
}

export function getHomeDir(): string {
  return process.env.HOME || os.homedir();
}

export const DEFAULT_CONFIG: TelegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  botTokenPath: path.join(getHomeDir(), ".config/telegram/token"),
  allowedUsers: process.env.TELEGRAM_ALLOWED_USERS
    ? process.env.TELEGRAM_ALLOWED_USERS.split(",")
        .map((u) => parseInt(u.trim(), 10))
        .filter(Number.isFinite)
    : [],
  allowedUsernames: process.env.TELEGRAM_ALLOWED_USERNAMES
    ? process.env.TELEGRAM_ALLOWED_USERNAMES.split(",").map((u) =>
        u.trim().replace(/^@/, ""),
      )
    : [],
  autoStart: true,
  progressMode: "edit",
  progressCooldownSeconds: 3,
};

export function getMediaDir(): string {
  const dir = path.join(getHomeDir(), ".pi/agent/media/telegram");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getOffsetPath(): string {
  return path.join(getHomeDir(), ".pi/agent/telegram_offset");
}

export function loadSavedOffset(): number {
  const file = getOffsetPath();
  try {
    if (fs.existsSync(file)) {
      const val = parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
      return Number.isSafeInteger(val) && val > 0 ? val : 0;
    }
  } catch {
    // Ignore read errors
  }
  return 0;
}

export function saveOffset(offset: number): void {
  try {
    const file = getOffsetPath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, String(offset), "utf-8");
  } catch {
    // Ignore write errors
  }
}

export function loadConfig(): TelegramConfig {
  const primaryPath = path.join(getHomeDir(), ".pi/agent/telegram.json");
  const fallbackPath = path.join(getHomeDir(), ".config/telegram/config.json");
  const configPath = fs.existsSync(primaryPath) ? primaryPath : fallbackPath;

  let cfg = { ...DEFAULT_CONFIG };

  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      cfg = { ...cfg, ...data };
    } catch {
      // fallback
    }
  }

  if (!cfg.botToken && process.env.TELEGRAM_BOT_TOKEN) {
    cfg.botToken = process.env.TELEGRAM_BOT_TOKEN;
  }

  // Check common secret paths
  const candidateTokenPaths = [
    cfg.botTokenPath,
    path.join(getHomeDir(), ".config/telegram/token"),
    path.join(getHomeDir(), ".config/sops-nix/secrets/telegram-bot-token"),
    "/run/secrets/telegram-bot-token",
  ].filter(Boolean) as string[];

  if (!cfg.botToken) {
    for (const p of candidateTokenPaths) {
      if (fs.existsSync(p)) {
        try {
          const val = fs.readFileSync(p, "utf-8").trim();
          if (val) {
            cfg.botToken = val;
            break;
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // If no bot token is configured at all, do not autoStart to prevent error notifications
  if (!cfg.botToken) {
    cfg.autoStart = false;
  }

  return cfg;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
