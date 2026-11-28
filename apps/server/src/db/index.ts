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

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      external_key text,
      title text NOT NULL,
      detail text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'pending',
      progress integer,
      group_name text NOT NULL DEFAULT '',
      asset_ref text,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS agent_tasks_project_order_idx ON agent_tasks (project_id, sort_order);

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

    -- Stage 3: Pre-production (Scripts, Continuity Bible, Storyboard)
    CREATE TABLE IF NOT EXISTS project_scripts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title text NOT NULL DEFAULT 'Scénario principal',
      content text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_scripts_project_uidx ON project_scripts (project_id);

    CREATE TABLE IF NOT EXISTS script_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      script_id uuid NOT NULL REFERENCES project_scripts(id) ON DELETE CASCADE,
      version integer NOT NULL,
      content text NOT NULL,
      change_summary text NOT NULL DEFAULT '',
      author text NOT NULL DEFAULT 'user',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS script_versions_script_idx ON script_versions (script_id, version);

    CREATE TABLE IF NOT EXISTS bible_entities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entity_type text NOT NULL DEFAULT 'character',
      ref_code text NOT NULL,
      name text NOT NULL,
      description text NOT NULL DEFAULT '',
      visual_prompt text NOT NULL DEFAULT '',
      lora_name text NOT NULL DEFAULT '',
      reference_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bible_entities_project_ref_uidx ON bible_entities (project_id, ref_code);

    CREATE TABLE IF NOT EXISTS scenes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      scene_number integer NOT NULL,
      title text NOT NULL,
      summary text NOT NULL DEFAULT '',
      location_ref text NOT NULL DEFAULT '',
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS scenes_project_sort_idx ON scenes (project_id, sort_order);

    CREATE TABLE IF NOT EXISTS shots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      shot_code text NOT NULL,
      title text NOT NULL,
      visual_description text NOT NULL DEFAULT '',
      camera_movement text NOT NULL DEFAULT '',
      dialogue text NOT NULL DEFAULT '',
      prompt text NOT NULL DEFAULT '',
      duration_sec double precision NOT NULL DEFAULT 4,
      status text NOT NULL DEFAULT 'planned',
      keyframe_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      video_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      bible_entity_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS shots_project_code_uidx ON shots (project_id, shot_code);
    CREATE INDEX IF NOT EXISTS shots_scene_sort_idx ON shots (scene_id, sort_order);

    -- Stage 3: Audio, Music, Lyrics & Lip-Sync
    CREATE TABLE IF NOT EXISTS audio_tracks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      ref_code text NOT NULL,
      title text NOT NULL,
      category text NOT NULL DEFAULT 'music',
      bpm double precision,
      musical_key text NOT NULL DEFAULT '',
      prompt_used text NOT NULL DEFAULT '',
      lyrics text NOT NULL DEFAULT '',
      lrc_content text NOT NULL DEFAULT '',
      srt_content text NOT NULL DEFAULT '',
      markers jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS audio_tracks_project_ref_uidx ON audio_tracks (project_id, ref_code);

    -- Stage 3: YouTube Packaging Hub
    CREATE TABLE IF NOT EXISTS youtube_packages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      titles jsonb NOT NULL DEFAULT '[]'::jsonb,
      description text NOT NULL DEFAULT '',
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
      category text NOT NULL DEFAULT 'Entertainment',
      language text NOT NULL DEFAULT 'fr',
      playlist text NOT NULL DEFAULT '',
      pinned_comment text NOT NULL DEFAULT '',
      ai_disclosure boolean NOT NULL DEFAULT true,
      thumbnail_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
      srt_subtitles text NOT NULL DEFAULT '',
      checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS youtube_packages_project_uidx ON youtube_packages (project_id);

    -- Stage 3 / Issue #4: Per-Project Local Git & GitHub Repo
    CREATE TABLE IF NOT EXISTS project_repos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      local_path text NOT NULL,
      default_branch text NOT NULL DEFAULT 'main',
      github_remote_url text,
      auto_commit boolean NOT NULL DEFAULT false,
      last_commit_sha text,
      last_synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_repos_project_uidx ON project_repos (project_id);

    -- v0.3.1 Additive Non-Destructive Migrations (Media Folders & Rule Auto-Inject/Tags)
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS folder_path text NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS assets_project_folder_idx ON assets (project_id, folder_path);

    CREATE TABLE IF NOT EXISTS media_folders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS media_folders_project_path_uidx ON media_folders (project_id, path);

    ALTER TABLE rules ADD COLUMN IF NOT EXISTS auto_inject boolean NOT NULL DEFAULT true;
    ALTER TABLE rules ADD COLUMN IF NOT EXISTS applies_to_tags jsonb NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE project_rule_overrides ADD COLUMN IF NOT EXISTS auto_inject_override boolean;
    ALTER TABLE project_rule_overrides ADD COLUMN IF NOT EXISTS applies_to_tags_override jsonb;

    -- v0.4.0 Additive Non-Destructive Migrations (Stage 4 Timeline, QC, Relations, ETA & Multi-Root Local Path)
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS local_path text NOT NULL DEFAULT '';
    ALTER TABLE projects ADD COLUMN IF NOT EXISTS timeline_quality_mode text NOT NULL DEFAULT 'draft_proxy';

    ALTER TABLE assets ADD COLUMN IF NOT EXISTS relation_type text NOT NULL DEFAULT 'revision';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS qc_checks jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS qc_status text NOT NULL DEFAULT 'pending';
    ALTER TABLE assets ADD COLUMN IF NOT EXISTS qc_notes text NOT NULL DEFAULT '';

    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS step_current integer;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS step_total integer;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '';
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS comfy_prompt_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS eta_seconds integer;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_completion_at timestamptz;

    ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS eta_seconds integer;
    ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS estimated_completion_at timestamptz;

    ALTER TABLE annotations ADD COLUMN IF NOT EXISTS shot_id uuid REFERENCES shots(id) ON DELETE SET NULL;
    ALTER TABLE annotations ADD COLUMN IF NOT EXISTS shot_code text;

    ALTER TABLE shots ADD COLUMN IF NOT EXISTS external_id text;
    ALTER TABLE shots ADD COLUMN IF NOT EXISTS start_sec double precision;
    CREATE UNIQUE INDEX IF NOT EXISTS shots_project_external_uidx
      ON shots (project_id, external_id)
      WHERE external_id IS NOT NULL;

    -- Stage 4: Multi-Track NLE Timeline & Server Renders
    CREATE TABLE IF NOT EXISTS timeline_tracks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      track_type text NOT NULL DEFAULT 'video',
      name text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      muted boolean NOT NULL DEFAULT false,
      locked boolean NOT NULL DEFAULT false,
      volume double precision NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS timeline_tracks_project_sort_idx ON timeline_tracks (project_id, sort_order);

    CREATE TABLE IF NOT EXISTS timeline_clips (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      track_id uuid NOT NULL REFERENCES timeline_tracks(id) ON DELETE CASCADE,
      asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      title text NOT NULL,
      start_sec double precision NOT NULL DEFAULT 0,
      duration_sec double precision NOT NULL DEFAULT 4,
      in_sec double precision NOT NULL DEFAULT 0,
      out_sec double precision,
      transition text NOT NULL DEFAULT 'cut',
      transition_duration_sec double precision NOT NULL DEFAULT 0,
      volume double precision NOT NULL DEFAULT 1,
      muted boolean NOT NULL DEFAULT false,
      notes text NOT NULL DEFAULT '',
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS timeline_clips_project_track_idx ON timeline_clips (project_id, track_id, start_sec);

    CREATE TABLE IF NOT EXISTS timeline_renders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
      output_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      quality_mode text NOT NULL DEFAULT 'draft_proxy',
      resolution text NOT NULL DEFAULT '1280x720',
      fps integer NOT NULL DEFAULT 24,
      status text NOT NULL DEFAULT 'queued',
      progress integer NOT NULL DEFAULT 0,
      duration_sec double precision,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS timeline_renders_project_idx ON timeline_renders (project_id, created_at DESC);

    -- Stage 5: Watch Folders, Outgoing Webhooks & Automated Backups
    CREATE TABLE IF NOT EXISTS watch_folders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      relative_dir text NOT NULL,
      folder_path text NOT NULL DEFAULT '',
      glob text NOT NULL DEFAULT '*',
      storage_mode text NOT NULL DEFAULT 'reference',
      quality_tier text NOT NULL DEFAULT 'test',
      tags jsonb NOT NULL DEFAULT '[]'::jsonb,
      enabled boolean NOT NULL DEFAULT true,
      poll_interval_sec integer NOT NULL DEFAULT 15,
      last_scan_at timestamptz,
      ingested_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS watch_folders_project_idx ON watch_folders (project_id);

    CREATE TABLE IF NOT EXISTS webhooks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
      name text NOT NULL,
      url text NOT NULL,
      events jsonb NOT NULL DEFAULT '[]'::jsonb,
      secret text,
      enabled boolean NOT NULL DEFAULT true,
      last_status_code integer,
      last_triggered_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS webhooks_project_idx ON webhooks (project_id);

    CREATE TABLE IF NOT EXISTS backups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      filename text NOT NULL,
      file_path text NOT NULL,
      size_bytes bigint NOT NULL DEFAULT 0,
      includes_db boolean NOT NULL DEFAULT true,
      includes_skills boolean NOT NULL DEFAULT true,
      includes_metadata boolean NOT NULL DEFAULT true,
      status text NOT NULL DEFAULT 'completed',
      notes text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS backups_created_idx ON backups (created_at DESC);

    -- Scene Blocking Plans & Freehand Storyboard Sketches
    CREATE TABLE IF NOT EXISTS sketches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
      shot_id uuid REFERENCES shots(id) ON DELETE SET NULL,
      in_sketch_board boolean NOT NULL DEFAULT true,
      board_order integer NOT NULL DEFAULT 0,
      duration_sec double precision NOT NULL DEFAULT 3,
      caption text NOT NULL DEFAULT '',
      title text NOT NULL,
      mode text NOT NULL DEFAULT 'scene_plan',
      aspect_ratio text NOT NULL DEFAULT '16:9',
      folder_path text NOT NULL DEFAULT 'plans',
      scene_data jsonb NOT NULL,
      ai_director_brief text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE sketches ADD COLUMN IF NOT EXISTS in_sketch_board boolean NOT NULL DEFAULT true;
    ALTER TABLE sketches ADD COLUMN IF NOT EXISTS board_order integer NOT NULL DEFAULT 0;
    ALTER TABLE sketches ADD COLUMN IF NOT EXISTS duration_sec double precision NOT NULL DEFAULT 3;
    ALTER TABLE sketches ADD COLUMN IF NOT EXISTS caption text NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS sketches_project_updated_idx ON sketches (project_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS sketches_asset_idx ON sketches (asset_id);
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
