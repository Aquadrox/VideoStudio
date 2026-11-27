import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  MCP_AUTH_TOKEN: z.string().min(8, 'MCP_AUTH_TOKEN must be at least 8 characters'),
  CORS_ORIGIN: z.string().default('*'),
  DATA_DIR: z.string().default('./data'),
  INGEST_ALLOWED_DIR: z.string().default('./ingest'),
  INGEST_EXTRA_DIRS: z.string().default(''),
  SKILLS_SYNC_DIR: z.string().default('./skills'),
  BACKUP_DIR: z.string().default('./backups'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(20480).default(2048),
  ALLOWED_FETCH_HOSTS: z.string().default(''),
  COMFYUI_BASE_URL: z.string().default(''),
  YOUTUBE_CLIENT_ID: z.string().default(''),
  YOUTUBE_CLIENT_SECRET: z.string().default(''),
  YOUTUBE_REFRESH_TOKEN: z.string().default(''),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  mcpAuthToken: string;
  corsOrigin: string;
  dataDir: string;
  ingestAllowedDir: string;
  ingestExtraDirs: string[];
  skillsSyncDir: string;
  backupDir: string;
  maxUploadBytes: number;
  allowedFetchHosts: string[];
  comfyuiBaseUrl: string | null;
  youtubeOAuth: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  const data = parsed.data;
  const allowedFetchHosts = data.ALLOWED_FETCH_HOSTS.split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const ingestExtraDirs = data.INGEST_EXTRA_DIRS.split(/[,:]/)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => path.resolve(d));

  const comfyuiBaseUrl = data.COMFYUI_BASE_URL.trim().replace(/\/+$/, '') || null;

  const ytClientId = data.YOUTUBE_CLIENT_ID.trim();
  const ytClientSecret = data.YOUTUBE_CLIENT_SECRET.trim();
  const ytRefreshToken = data.YOUTUBE_REFRESH_TOKEN.trim();
  const youtubeOAuth =
    ytClientId && ytClientSecret && ytRefreshToken
      ? { clientId: ytClientId, clientSecret: ytClientSecret, refreshToken: ytRefreshToken }
      : null;

  return {
    nodeEnv: data.NODE_ENV,
    host: data.HOST,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    mcpAuthToken: data.MCP_AUTH_TOKEN,
    corsOrigin: data.CORS_ORIGIN,
    dataDir: path.resolve(data.DATA_DIR),
    ingestAllowedDir: path.resolve(data.INGEST_ALLOWED_DIR),
    ingestExtraDirs,
    skillsSyncDir: path.resolve(data.SKILLS_SYNC_DIR),
    backupDir: path.resolve(data.BACKUP_DIR),
    maxUploadBytes: data.MAX_UPLOAD_MB * 1024 * 1024,
    allowedFetchHosts,
    comfyuiBaseUrl,
    youtubeOAuth,
  };
}
