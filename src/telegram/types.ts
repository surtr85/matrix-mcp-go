export interface TelegramConfig {
  botToken: string;
  botTokenPath?: string;
  allowedUsers: number[];
  allowedUsernames: string[];
  autoStart: boolean;
  progressMode: "edit" | "typing";
  progressCooldownSeconds: number;
}

export interface PendingTelegramTurn {
  id: string;
  chatId: number;
  triggerMessageId: number;
  senderId: number;
  senderUsername?: string;
  timestamp: number;
}

export interface DownloadedFile {
  localPath: string;
  data: string;
  mimeType: string;
  sizeBytes: number;
}
