import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ProjectGitCommit } from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import { resolveSafePath } from '../utils/security.js';

const execFileAsync = promisify(execFile);

const PROJECT_REPO_GITIGNORE = `# VideoStudio per-project repository .gitignore
# Keep secrets and heavy raw binary renders out of Git
.env
.env.*
*.key
*.pem
client_secret*.json

# Raw heavy media binaries (tracked via VideoStudio DAM storage instead)
media/originals/
media/proxies/
*.mp4
*.mov
*.mkv
*.wav
*.flac
`;

/**
 * Validates a GitHub/Git remote URL while strictly blocking embedded credentials/tokens
 * (e.g. https://user:token@github.com/...) so secrets can never leak into .git/config or DB.
 */
export function validateSafeGitRemoteUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('Remote URL cannot be empty');
  }

  // SSH format: git@github.com:owner/repo.git
  if (/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?$/.test(trimmed)) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid Git remote URL (use https://github.com/owner/repo.git or git@github.com:owner/repo.git)');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported Git remote protocol: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials/tokens in Git remote URL are strictly forbidden');
  }

  return parsed.toString();
}

export interface ProjectSnapshotFiles {
  projectMeta: Record<string, unknown>;
  scriptMarkdown?: string;
  bibleEntities?: unknown[];
  storyboardScenes?: unknown[];
  resolvedRules?: Record<string, unknown> | null;
  audioTracks?: Array<{ refCode: string; lrcContent?: string; [key: string]: unknown }>;
  youtubePackage?: { description?: string; [key: string]: unknown } | null;
}

export class ProjectGitService {
  constructor(private readonly config: AppConfig) {}

  getRelativeRepoPath(projectSlug: string): string {
    if (!/^[a-z0-9-]+$/.test(projectSlug)) {
      throw new Error('Invalid project slug for Git repository');
    }
    return path.join('projects', projectSlug, 'repo');
  }

  resolveRepoAbsPath(projectSlug: string): string {
    return resolveSafePath(this.config.dataDir, this.getRelativeRepoPath(projectSlug));
  }

  async isInitialized(projectSlug: string): Promise<boolean> {
    const abs = this.resolveRepoAbsPath(projectSlug);
    try {
      const stat = await fs.stat(path.join(abs, '.git'));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async initRepo(params: {
    projectSlug: string;
    projectName: string;
    defaultBranch?: string;
    githubRemoteUrl?: string | null;
  }): Promise<{ localPath: string; lastCommitSha: string | null }> {
    const branch = params.defaultBranch ?? 'main';
    const relPath = this.getRelativeRepoPath(params.projectSlug);
    const absPath = this.resolveRepoAbsPath(params.projectSlug);

    await fs.mkdir(absPath, { recursive: true });

    const alreadyInit = await this.isInitialized(params.projectSlug);
    if (!alreadyInit) {
      await this.runGit(absPath, ['init', '-b', branch]);
      await this.runGit(absPath, ['config', 'user.name', 'VideoStudio']);
      await this.runGit(absPath, ['config', 'user.email', 'noreply@videostudio.local']);
    }

    await fs.writeFile(path.join(absPath, '.gitignore'), PROJECT_REPO_GITIGNORE, 'utf8');
    await fs.writeFile(
      path.join(absPath, 'README.md'),
      `# ${params.projectName}\n\nDépôt de production VideoStudio pour le projet \`@proj-${params.projectSlug}\`.\n\nContient le scénario, la bible de continuité, le storyboard, les règles projet, les paroles/marqueurs audio et le packaging YouTube.\n`,
      'utf8',
    );

    if (params.githubRemoteUrl) {
      await this.setRemote(params.projectSlug, params.githubRemoteUrl);
    }

    let lastCommitSha = await this.getHeadSha(absPath);
    if (!lastCommitSha) {
      await this.runGit(absPath, ['add', '.gitignore', 'README.md']);
      await this.runGit(absPath, ['commit', '-m', `chore: initialize VideoStudio project repo (${params.projectSlug})`]);
      lastCommitSha = await this.getHeadSha(absPath);
    }

    return { localPath: relPath, lastCommitSha };
  }

  async setRemote(projectSlug: string, githubRemoteUrl: string | null): Promise<string | null> {
    const absPath = this.resolveRepoAbsPath(projectSlug);
    const initialized = await this.isInitialized(projectSlug);
    if (!initialized) {
      throw new Error('Project Git repository is not initialized yet');
    }

    if (!githubRemoteUrl) {
      try {
        await this.runGit(absPath, ['remote', 'remove', 'origin']);
      } catch {
        // Remote origin did not exist
      }
      return null;
    }

    const safeUrl = validateSafeGitRemoteUrl(githubRemoteUrl);
    try {
      await this.runGit(absPath, ['remote', 'set-url', 'origin', safeUrl]);
    } catch {
      await this.runGit(absPath, ['remote', 'add', 'origin', safeUrl]);
    }
    return safeUrl;
  }

  async writeSnapshot(projectSlug: string, snapshot: ProjectSnapshotFiles): Promise<string[]> {
    const absPath = this.resolveRepoAbsPath(projectSlug);
    if (!(await this.isInitialized(projectSlug))) {
      throw new Error('Project Git repository is not initialized yet');
    }

    const writeJson = async (rel: string, data: unknown) => {
      const target = resolveSafePath(absPath, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    };

    const writeText = async (rel: string, content: string) => {
      const target = resolveSafePath(absPath, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    };

    await writeJson('project.json', snapshot.projectMeta);
    if (snapshot.scriptMarkdown !== undefined) {
      await writeText('script/script.md', `${snapshot.scriptMarkdown}\n`);
    }
    if (snapshot.bibleEntities !== undefined) {
      await writeJson('bible/entities.json', snapshot.bibleEntities);
    }
    if (snapshot.storyboardScenes !== undefined) {
      await writeJson('storyboard/scenes.json', snapshot.storyboardScenes);
    }
    if (snapshot.resolvedRules !== undefined) {
      await writeJson('rules/resolved-rules.json', snapshot.resolvedRules);
    }
    if (snapshot.audioTracks !== undefined) {
      await writeJson('audio/tracks.json', snapshot.audioTracks);
      for (const track of snapshot.audioTracks) {
        if (track.lrcContent && track.lrcContent.trim()) {
          await writeText(`audio/lyrics/${track.refCode}.lrc`, `${track.lrcContent}\n`);
        }
      }
    }
    if (snapshot.youtubePackage !== undefined) {
      await writeJson('youtube/package.json', snapshot.youtubePackage);
      if (snapshot.youtubePackage?.description) {
        await writeText('youtube/description.md', `${snapshot.youtubePackage.description}\n`);
      }
    }

    return this.getDirtyFiles(absPath);
  }

  async commitAll(projectSlug: string, message: string): Promise<{ sha: string | null; committed: boolean }> {
    const absPath = this.resolveRepoAbsPath(projectSlug);
    const dirty = await this.getDirtyFiles(absPath);
    if (dirty.length === 0) {
      return { sha: await this.getHeadSha(absPath), committed: false };
    }

    await this.runGit(absPath, ['add', '-A']);
    await this.runGit(absPath, ['commit', '-m', message.trim()]);
    const sha = await this.getHeadSha(absPath);
    return { sha, committed: true };
  }

  async pushToOrigin(projectSlug: string, branch = 'main'): Promise<{ ok: boolean; output: string }> {
    const absPath = this.resolveRepoAbsPath(projectSlug);
    if (!/^[a-zA-Z0-9._/-]+$/.test(branch)) {
      throw new Error('Invalid branch name');
    }
    try {
      const { stdout, stderr } = await this.runGit(absPath, ['push', '-u', 'origin', branch]);
      return { ok: true, output: `${stdout}\n${stderr}`.trim() || 'Pushed cleanly to origin' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, output: msg };
    }
  }

  async inspectStatus(projectSlug: string): Promise<{
    initialized: boolean;
    dirtyFiles: string[];
    lastCommitSha: string | null;
    recentCommits: ProjectGitCommit[];
  }> {
    const absPath = this.resolveRepoAbsPath(projectSlug);
    const initialized = await this.isInitialized(projectSlug);
    if (!initialized) {
      return { initialized: false, dirtyFiles: [], lastCommitSha: null, recentCommits: [] };
    }

    const [dirtyFiles, lastCommitSha, recentCommits] = await Promise.all([
      this.getDirtyFiles(absPath),
      this.getHeadSha(absPath),
      this.getRecentCommits(absPath),
    ]);

    return { initialized: true, dirtyFiles, lastCommitSha, recentCommits };
  }

  private async getDirtyFiles(absPath: string): Promise<string[]> {
    try {
      const { stdout } = await this.runGit(absPath, ['status', '--porcelain']);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async getHeadSha(absPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(absPath, ['rev-parse', 'HEAD']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async getRecentCommits(absPath: string, limit = 12): Promise<ProjectGitCommit[]> {
    try {
      const { stdout } = await this.runGit(absPath, [
        'log',
        `-${limit}`,
        '--pretty=format:%H%x1f%h%x1f%aI%x1f%s',
      ]);
      return stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [sha = '', shortSha = '', date = '', message = ''] = line.split('\x1f');
          return { sha, shortSha, date, message };
        });
    } catch {
      return [];
    }
  }

  private async runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync('git', args, {
      cwd,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  }
}
