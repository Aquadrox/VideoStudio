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

    -- Stage 2: Visual Annotations & Feedback Inbox
    CREATE TABLE IF NOT EXISTS annotations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      author text NOT NULL DEFAULT 'user',
      frame_number integer,
      timecode_sec double precision,
      shape_type text NOT NULL DEFAULT 'pin',
      x double precision NOT NULL,
      y double precision NOT NULL,
      w double precision,
      h double precision,
      color text NOT NULL DEFAULT '#e5a038',
      comment text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      resolved_by text,
      resolved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS annotations_asset_idx ON annotations (asset_id, created_at);
    CREATE INDEX IF NOT EXISTS annotations_project_status_idx ON annotations (project_id, status);

    -- Stage 2: Rulebooks, Rules & Per-Project Overrides
    CREATE TABLE IF NOT EXISTS rulebooks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rulebooks_slug_uidx ON rulebooks (slug);

    CREATE TABLE IF NOT EXISTS rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      rulebook_id uuid REFERENCES rulebooks(id) ON DELETE CASCADE,
      project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
      code text NOT NULL,
      title text NOT NULL,
      category text NOT NULL DEFAULT 'style',
      severity text NOT NULL DEFAULT 'mandatory',
      default_value text NOT NULL DEFAULT '',
      instruction text NOT NULL,
      positive_fragment text NOT NULL DEFAULT '',
      negative_fragment text NOT NULL DEFAULT '',
      enabled boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS rules_rulebook_idx ON rules (rulebook_id);
    CREATE INDEX IF NOT EXISTS rules_project_idx ON rules (project_id);

    CREATE TABLE IF NOT EXISTS project_rulebook_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rulebook_id uuid NOT NULL REFERENCES rulebooks(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_rulebook_link_uidx ON project_rulebook_links (project_id, rulebook_id);

    CREATE TABLE IF NOT EXISTS project_rule_overrides (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rule_id uuid NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
      enabled_override boolean,
      severity_override text,
      value_override text,
      instruction_override text,
      positive_fragment_override text,
      negative_fragment_override text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_rule_override_uidx ON project_rule_overrides (project_id, rule_id);

    -- Stage 2: Prompt Templates & ComfyUI Workflows
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL,
      name text NOT NULL,
      category text NOT NULL DEFAULT 'image',
      target_model text NOT NULL DEFAULT '',
      positive_template text NOT NULL,
      negative_template text NOT NULL DEFAULT '',
      variables jsonb NOT NULL DEFAULT '[]'::jsonb,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_slug_uidx ON prompt_templates (slug);

    CREATE TABLE IF NOT EXISTS comfy_workflows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      category text NOT NULL DEFAULT 'image_gen',
      version integer NOT NULL DEFAULT 1,
      workflow_json jsonb NOT NULL,
      input_notes text NOT NULL DEFAULT '',
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS comfy_workflows_slug_uidx ON comfy_workflows (slug);

    -- Stage 2: Claude Code Skills Hub
    CREATE TABLE IF NOT EXISTS skills (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      scope text NOT NULL DEFAULT 'global',
      project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
      content text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      sync_enabled boolean NOT NULL DEFAULT true,
      synced_path text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS skills_slug_uidx ON skills (slug);

    CREATE TABLE IF NOT EXISTS skill_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      version integer NOT NULL,
      content text NOT NULL,
      change_summary text NOT NULL DEFAULT '',
      author text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS skill_versions_skill_idx ON skill_versions (skill_id, version);
  `);

  // Seed one default reusable Rulebook if none exist yet
  const existingRulebooks = await pool.query('SELECT count(*)::int AS count FROM rulebooks');
  const count = (existingRulebooks.rows[0] as { count?: number } | undefined)?.count ?? 0;
  if (count === 0) {
    const rbRes = await pool.query(
      `INSERT INTO rulebooks (slug, name, description, is_default)
       VALUES ('standards-production-ia', 'Standards Production IA', 'Règles de qualité et d''anatomie réutilisables (surchargeables sur chaque projet).', true)
       RETURNING id`,
    );
    const rbId = (rbRes.rows[0] as { id?: string } | undefined)?.id;
    if (rbId) {
      await pool.query(
        `INSERT INTO rules (rulebook_id, code, title, category, severity, default_value, instruction, positive_fragment, negative_fragment, sort_order)
         VALUES
           ($1, 'hands-fingers', 'Nombre de doigts par main', 'anatomy', 'mandatory', '5 doigts', 'Les personnages doivent avoir exactement 5 doigts naturels par main (surcharger à 4 doigts pour un projet cartoon).', 'anatomically accurate hands, 5 fingers per hand', 'extra fingers, fused fingers, missing fingers, malformed hands', 1),
           ($1, 'no-text-artifacts', 'Aucun texte ni filigrane parasite', 'style', 'forbidden', 'Interdit', 'Aucun texte aléatoire, watermark, logo ou signature ne doit apparaître dans les images ou vidéos générées.', '', 'watermark, signature, logo, garbled text, subtitles', 2),
           ($1, 'draft-before-hq', 'Valider en basse résolution avant upscale HQ', 'editing', 'recommended', 'Draft -> HQ', 'Toujours valider la composition et le mouvement en Draft basse résolution avant de lancer un upscale Haute Résolution.', '', '', 3)`,
        [rbId],
      );
    }
  }
}
