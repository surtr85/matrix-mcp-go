export interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  botUserId: string;
  allowedUsers: string[];
  autoStart: boolean;
  useSubagent: boolean;
  subagentRole?: "delegate" | "worker";
  progressCooldownSeconds: number;
  progressMode: "edit" | "message";
}

export interface PendingTurn {
  id: string;
  roomId: string;
  triggerEventId: string;
  sender: string;
  timestamp: number;
}

export interface DownloadedMedia {
  data: string; // base64
  buffer: Buffer;
  mimeType: string;
  filename: string;
  localPath: string;
  sizeBytes: number;
}

export interface UploadMediaResult {
  mxcUri: string;
  sizeBytes: number;
  mimeType: string;
}
