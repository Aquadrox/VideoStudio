import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { ProjectGitService, validateSafeGitRemoteUrl } from './project-git.service.js';

describe('ProjectGitService (per-project local Git & GitHub remote)', () => {
  let tmpDataDir: string | null = null;

  afterEach(async () => {
    if (tmpDataDir) {
      await fs.rm(tmpDataDir, { recursive: true, force: true });
      tmpDataDir = null;
    }
  });

  it('accepts clean HTTPS/SSH GitHub URLs and strictly rejects embedded tokens/credentials', () => {
    expect(validateSafeGitRemoteUrl('https://github.com/Aquadrox/my-video-project.git')).toBe(
      'https://github.com/Aquadrox/my-video-project.git',
    );
    expect(validateSafeGitRemoteUrl('git@github.com:Aquadrox/my-video-project.git')).toBe(
      'git@github.com:Aquadrox/my-video-project.git',
    );

    expect(() =>
      validateSafeGitRemoteUrl('https://testuser:testpass@github.com/Aquadrox/proj.git'),
    ).toThrow(/Embedded credentials/);
    expect(() => validateSafeGitRemoteUrl('file:///etc/passwd')).toThrow(/Unsupported Git remote/);
  });

  it('initializes a real local Git repo, exports project snapshot, commits and reads git log', async () => {
    tmpDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videostudio-git-'));
    const svc = new ProjectGitService({ dataDir: tmpDataDir } as AppConfig);

    const initRes = await svc.initRepo({
      projectSlug: 'cyberpunk-ep1',
      projectName: 'Cyberpunk EP1',
      githubRemoteUrl: 'https://github.com/Aquadrox/cyberpunk-ep1.git',
    });

    expect(initRes.localPath).toBe(path.join('projects', 'cyberpunk-ep1', 'repo'));
    expect(initRes.lastCommitSha).toMatch(/^[0-9a-f]{40}$/);

    const dirty = await svc.writeSnapshot('cyberpunk-ep1', {
      projectMeta: { slug: 'cyberpunk-ep1', name: 'Cyberpunk EP1' },
      scriptMarkdown: '# Scène 1\nINT. STUDIO - NUIT',
      resolvedRules: { hands: '5 doigts' },
      audioTracks: [{ refCode: 'track-001', lrcContent: '[00:00.00] Intro synth' }],
      youtubePackage: { description: 'Description YouTube complète' },
    });
    expect(dirty.length).toBeGreaterThan(0);

    const commitRes = await svc.commitAll('cyberpunk-ep1', 'feat: export script and rules snapshot');
    expect(commitRes.committed).toBe(true);
    expect(commitRes.sha).toMatch(/^[0-9a-f]{40}$/);

    const status = await svc.inspectStatus('cyberpunk-ep1');
    expect(status.initialized).toBe(true);
    expect(status.dirtyFiles).toEqual([]);
    expect(status.recentCommits.length).toBe(2);
    expect(status.recentCommits[0]?.message).toBe('feat: export script and rules snapshot');

    // Reject path traversal via invalid slug
    expect(() => svc.resolveRepoAbsPath('../escape')).toThrow(/Invalid project slug/);
  });
});
