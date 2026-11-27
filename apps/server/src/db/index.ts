import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  pool: pg.Pool;
  db: Database;
}

export function createDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const db = drizzle(pool, { schema });
  return { pool, db };
}

/**
 * Idempotent schema bootstrap for Phase 1 so Docker Compose starts cleanly
 * without requiring manual migration commands.
 */
export async function ensureDatabaseSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      type text NOT NULL DEFAULT 'youtube_long',
      aspect_ratio text NOT NULL DEFAULT '16:9',
      fps integer NOT NULL DEFAULT 24,
      target_resolution text NOT NULL DEFAULT '1920x1080',
      status text NOT NULL DEFAULT 'pre_production',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_uidx ON projects (slug);

    CREATE TABLE IF NOT EXISTS assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      ref_code text NOT NULL,
      title text NOT NULL,
      type text NOT NULL,
      status text NOT NULL DEFAULT 'new',
      quality_tier text NOT NULL DEFAULT 'test',
      rating integer NOT NULL DEFAULT 0,
      parent_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      version_number integer NOT NULL DEFAULT 1,
      original_filename text NOT NULL,
      file_path text NOT NULL,
      proxy_path text,
      thumbnail_path text,
      mime_type text NOT NULL,
      file_size bigint NOT NULL DEFAULT 0,
      width integer,
      height integer,
      duration_sec double precision,
      fps double precision,
      prompt_used text,
      negative_prompt text,
      model_name text,
      seed text,
      comfy_metadata jsonb,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes text NOT NULL DEFAULT '',
      created_by text NOT NULL DEFAULT 'claude',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS assets_project_ref_uidx ON assets (project_id, ref_code);
    CREATE INDEX IF NOT EXISTS assets_project_created_idx ON assets (project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS assets_parent_idx ON assets (parent_asset_id);

    CREATE TABLE IF NOT EXISTS activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
      actor text NOT NULL DEFAULT 'claude',
      action text NOT NULL,
      summary text NOT NULL,
      entity_type text,
      entity_id text,
      entity_ref text,
      metadata jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS activities_created_idx ON activities (created_at DESC);

    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type text NOT NULL,
      title text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      progress integer NOT NULL DEFAULT 0,
      result_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS jobs_project_status_idx ON jobs (project_id, status);
  `);
}
