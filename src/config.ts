import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { MatrixConfig } from "./types.js";

export const DEFAULT_CONFIG: MatrixConfig = {
  homeserver: process.env.MATRIX_HOMESERVER || "",
  accessToken: process.env.MATRIX_ACCESS_TOKEN || "",
  botUserId: process.env.MATRIX_BOT_USER_ID || "",
  allowedUsers: process.env.MATRIX_ALLOWED_USERS
    ? process.env.MATRIX_ALLOWED_USERS.split(",").map((u) => u.trim())
    : [],
  autoStart: true,
  useSubagent: false,
  subagentRole: "delegate",
  progressCooldownSeconds: 5,
  progressMode: "edit",
};

export function getHomeDir(): string {
  return process.env.HOME || "/home/amadeus";
}

export function getSyncTokenPath(): string {
  return path.join(getHomeDir(), ".pi/agent/matrix_sync_token");
}

export function getMediaDir(): string {
  const dir = path.join(getHomeDir(), ".pi/agent/media");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function loadConfig(): MatrixConfig {
  const configPath = path.join(getHomeDir(), ".pi/agent/matrix.json");
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return { ...DEFAULT_CONFIG, ...data };
    } catch {
      // Fallback to defaults
    }
  }
  return DEFAULT_CONFIG;
}

export function loadSavedSyncToken(): string | null {
  const tokenFile = getSyncTokenPath();
  try {
    if (fs.existsSync(tokenFile)) {
      const token = fs.readFileSync(tokenFile, "utf-8").trim();
      return token.length > 0 ? token : null;
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

export function saveSyncToken(token: string): void {
  try {
    const tokenFile = getSyncTokenPath();
    fs.writeFileSync(tokenFile, token.trim(), "utf-8");
  } catch {
    // Ignore write errors
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function sendDesktopNotification(title: string, message: string): void {
  execFile(
    "notify-send",
    ["-a", "Matrix Bridge", "-u", "normal", "-t", "5000", title, message],
    () => {},
  );
}
