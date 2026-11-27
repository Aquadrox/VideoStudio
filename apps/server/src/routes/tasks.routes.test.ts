import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AgentTaskDto, ProjectDto } from '@videostudio/shared';
import type { StudioService } from '../services/studio.service.js';
import { registerProjectRoutes } from './projects.routes.js';

const NOW = '2026-11-27T12:00:00.000Z';

const SAMPLE_PROJECT: ProjectDto = {
  id: '00000000-0000-4000-8000-000000000010',
  slug: 'demo-film',
  name: 'Demo Film',
  description: '',
  type: 'animation',
  aspectRatio: '16:9',
  fps: 24,
  targetResolution: '1920x1080',
  status: 'production',
  localPath: '',
  assetCount: 4,
  uri: 'studio://projects/demo-film',
  createdAt: NOW,
  updatedAt: NOW,
};

const SAMPLE_TASKS: AgentTaskDto[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    projectId: SAMPLE_PROJECT.id,
    externalKey: 'upscale-01',
    title: 'Upscale 4K clé #01',
    detail: 'Terminé',
    status: 'completed',
    progress: 100,
    groupName: 'Upscale 4K',
    assetRef: '@img-001',
    etaSeconds: null,
    estimatedCompletionAt: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    projectId: SAMPLE_PROJECT.id,
    externalKey: 'upscale-02',
    title: 'Upscale 4K clé #02',
    detail: 'SeedVR2 en cours...',
    status: 'in_progress',
    progress: 45,
    groupName: 'Upscale 4K',
    assetRef: null,
    etaSeconds: 180,
    estimatedCompletionAt: null,
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

describe('Agent Live Tasks REST routes', () => {
  it('lists, syncs, updates, and clears project agent tasks', async () => {
    const app = Fastify({ logger: false });
    const studioMock = {
      getProjectByIdOrSlug: vi.fn().mockResolvedValue(SAMPLE_PROJECT),
      listAgentTasks: vi.fn().mockResolvedValue(SAMPLE_TASKS),
      syncAgentTasks: vi.fn().mockResolvedValue(SAMPLE_TASKS),
      updateAgentTask: vi.fn().mockResolvedValue({ ...SAMPLE_TASKS[1], status: 'completed', progress: 100 }),
      clearAgentTasks: vi.fn().mockResolvedValue([SAMPLE_TASKS[1]]),
    } as unknown as StudioService;

    registerProjectRoutes(app, studioMock);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/projects/demo-film/tasks',
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().tasks).toHaveLength(2);

    const syncRes = await app.inject({
      method: 'PUT',
      url: '/api/projects/demo-film/tasks',
      payload: {
        replace: true,
        tasks: [
          { key: 'upscale-01', title: 'Upscale 4K clé #01', status: 'completed', progress: 100 },
          { key: 'upscale-02', title: 'Upscale 4K clé #02', status: 'in_progress', progress: 45 },
        ],
      },
    });
    expect(syncRes.statusCode).toBe(200);
    expect(studioMock.syncAgentTasks).toHaveBeenCalledTimes(1);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/projects/demo-film/tasks/upscale-02',
      payload: { status: 'completed', progress: 100 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().task.status).toBe('completed');

    const badPatch = await app.inject({
      method: 'PATCH',
      url: '/api/projects/demo-film/tasks/upscale-02',
      payload: { status: 'invalid_status' },
    });
    expect(badPatch.statusCode).toBe(400);

    const clearRes = await app.inject({
      method: 'DELETE',
      url: '/api/projects/demo-film/tasks?scope=completed',
    });
    expect(clearRes.statusCode).toBe(200);
    expect(studioMock.clearAgentTasks).toHaveBeenCalledWith('demo-film', 'completed');

    await app.close();
  });
});
