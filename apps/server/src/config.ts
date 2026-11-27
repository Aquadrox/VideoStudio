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
  SKILLS_SYNC_DIR: z.string().default('./skills'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(20480).default(2048),
  ALLOWED_FETCH_HOSTS: z.string().default(''),
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
  skillsSyncDir: string;
  maxUploadBytes: number;
  allowedFetchHosts: string[];
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

  return {
    nodeEnv: data.NODE_ENV,
    host: data.HOST,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    mcpAuthToken: data.MCP_AUTH_TOKEN,
    corsOrigin: data.CORS_ORIGIN,
    dataDir: path.resolve(data.DATA_DIR),
    ingestAllowedDir: path.resolve(data.INGEST_ALLOWED_DIR),
    skillsSyncDir: path.resolve(data.SKILLS_SYNC_DIR),
    maxUploadBytes: data.MAX_UPLOAD_MB * 1024 * 1024,
    allowedFetchHosts,
  };
}
