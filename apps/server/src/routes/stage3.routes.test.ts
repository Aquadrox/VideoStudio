import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Stage3Service } from '../services/stage3.service.js';
import { registerStage3Routes } from './stage3.routes.js';

describe('Stage 3 REST routes validation & contracts', () => {
  it('validates YouTube package A/B limits (max 3 titles & max 3 thumbnails)', async () => {
    const app = Fastify({ logger: false });
    registerStage3Routes(app, {
      updateYouTubePackage: vi.fn(),
    } as unknown as Stage3Service);

    const tooManyTitles = await app.inject({
      method: 'PUT',
      url: '/api/projects/demo/youtube',
      payload: { titles: ['T1', 'T2', 'T3', 'T4'] },
    });
    expect(tooManyTitles.statusCode).toBe(400);

    await app.close();
  });

  it('validates project Git commit message and forwards init/commit cleanly', async () => {
    const initOrConfigureProjectRepo = vi.fn().mockResolvedValue({
      projectId: '11111111-1111-1111-1111-111111111111',
      projectSlug: 'demo',
      initialized: true,
      localPath: 'projects/demo/repo',
      defaultBranch: 'main',
      githubRemoteUrl: 'https://github.com/Aquadrox/demo.git',
      autoCommit: false,
      lastCommitSha: 'abcdef',
      lastSyncedAt: null,
      dirtyFiles: [],
      recentCommits: [],
    });

    const syncAndCommitProjectRepo = vi.fn().mockResolvedValue({
      committed: true,
      sha: '1234567890',
      status: { initialized: true },
    });

    const app = Fastify({ logger: false });
    registerStage3Routes(app, {
      initOrConfigureProjectRepo,
      syncAndCommitProjectRepo,
    } as unknown as Stage3Service);

    const emptyCommit = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/git/commit',
      payload: { message: '   ' },
    });
    expect(emptyCommit.statusCode).toBe(400);

    const initRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/git/init',
      payload: { githubRemoteUrl: 'https://github.com/Aquadrox/demo.git' },
    });
    expect(initRes.statusCode).toBe(200);
    expect(initOrConfigureProjectRepo).toHaveBeenCalled();

    const commitRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/git/commit',
      payload: { message: 'feat: sync storyboard and script' },
    });
    expect(commitRes.statusCode).toBe(200);
    expect(commitRes.json().committed).toBe(true);

    await app.close();
  });
});
