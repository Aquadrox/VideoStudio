import type { FastifyInstance } from 'fastify';
import {
  CommitProjectRepoInputSchema,
  ConfigureProjectRepoInputSchema,
  CreateSceneInputSchema,
  CreateShotInputSchema,
  UpdateScriptInputSchema,
  UpdateShotInputSchema,
  UpdateYouTubePackageInputSchema,
  UpsertAudioTrackInputSchema,
  UpsertBibleEntityInputSchema,
} from '@videostudio/shared';
import type { Stage3Service } from '../services/stage3.service.js';

export function registerStage3Routes(
  app: FastifyInstance,
  stage3: Stage3Service,
): void {
  // --- 1. Versioned Script ---
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/script',
    async (request, reply) => {
      const script = await stage3.getProjectScript(request.params.projectIdOrSlug);
      if (!script) return reply.code(404).send({ error: 'Project not found' });
      return { script };
    },
  );

  app.put<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/script',
    async (request, reply) => {
      const parsed = UpdateScriptInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const script = await stage3.updateProjectScript(request.params.projectIdOrSlug, parsed.data);
      if (!script) return reply.code(404).send({ error: 'Project not found' });
      return { script };
    },
  );

  // --- 2. Continuity Bible ---
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/bible',
    async (request) => {
      const entities = await stage3.listBibleEntities(request.params.projectIdOrSlug);
      return { entities };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/bible',
    async (request, reply) => {
      const parsed = UpsertBibleEntityInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const entity = await stage3.upsertBibleEntity(
        request.params.projectIdOrSlug,
        parsed.data,
        'user',
      );
      if (!entity) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send({ entity });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/bible/:id', async (request, reply) => {
    const ok = await stage3.deleteBibleEntity(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Entity not found' });
    return reply.code(204).send();
  });

  // --- 3. Storyboard (Scenes & Shots) ---
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/storyboard',
    async (request) => {
      const scenes = await stage3.getStoryboard(request.params.projectIdOrSlug);
      return { scenes };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/scenes',
    async (request, reply) => {
      const parsed = CreateSceneInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const scene = await stage3.createScene(request.params.projectIdOrSlug, parsed.data, 'user');
      if (!scene) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send({ scene });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (request, reply) => {
    const ok = await stage3.deleteScene(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Scene not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/shots',
    async (request, reply) => {
      const parsed = CreateShotInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const shot = await stage3.createShot(request.params.projectIdOrSlug, parsed.data, 'user');
      if (!shot) return reply.code(404).send({ error: 'Project or scene not found' });
      return reply.code(201).send({ shot });
    },
  );

  app.patch<{ Params: { id: string } }>('/api/shots/:id', async (request, reply) => {
    const parsed = UpdateShotInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const shot = await stage3.updateShot(request.params.id, parsed.data, 'user');
    if (!shot) return reply.code(404).send({ error: 'Shot not found' });
    return { shot };
  });

  app.delete<{ Params: { id: string } }>('/api/shots/:id', async (request, reply) => {
    const ok = await stage3.deleteShot(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Shot not found' });
    return reply.code(204).send();
  });

  // --- 4. Audio, Music & Lyrics ---
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/audio',
    async (request) => {
      const tracks = await stage3.listAudioTracks(request.params.projectIdOrSlug);
      return { tracks };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/audio',
    async (request, reply) => {
      const parsed = UpsertAudioTrackInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const track = await stage3.upsertAudioTrack(
        request.params.projectIdOrSlug,
        parsed.data,
        'user',
      );
      if (!track) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send({ track });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/audio/:id', async (request, reply) => {
    const ok = await stage3.deleteAudioTrack(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Audio track not found' });
    return reply.code(204).send();
  });

  // --- 5. YouTube Hub ---
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/youtube',
    async (request, reply) => {
      const pkg = await stage3.getYouTubePackage(request.params.projectIdOrSlug);
      if (!pkg) return reply.code(404).send({ error: 'Project not found' });
      return { youtube: pkg };
    },
  );

  app.put<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/youtube',
    async (request, reply) => {
      const parsed = UpdateYouTubePackageInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const pkg = await stage3.updateYouTubePackage(
        request.params.projectIdOrSlug,
        parsed.data,
        'user',
      );
      if (!pkg) return reply.code(404).send({ error: 'Project not found' });
      return { youtube: pkg };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/youtube/export-pack',
    async (request, reply) => {
      const result = await stage3.exportYouTubeReadyPack(request.params.projectIdOrSlug);
      if (!result) return reply.code(404).send({ error: 'Project not found' });
      return { exportPack: result };
    },
  );

  // --- 6. Per-Project Local Git & GitHub Repo (Issue #4) ---
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/git',
    async (request, reply) => {
      const status = await stage3.getProjectRepoStatus(request.params.projectIdOrSlug);
      if (!status) return reply.code(404).send({ error: 'Project not found' });
      return { git: status };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/git/init',
    async (request, reply) => {
      const parsed = ConfigureProjectRepoInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const status = await stage3.initOrConfigureProjectRepo(
          request.params.projectIdOrSlug,
          parsed.data,
          'user',
        );
        if (!status) return reply.code(404).send({ error: 'Project not found' });
        return { git: status };
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Git configuration error',
        });
      }
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/git/commit',
    async (request, reply) => {
      const parsed = CommitProjectRepoInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const res = await stage3.syncAndCommitProjectRepo(
        request.params.projectIdOrSlug,
        parsed.data,
        'user',
      );
      if (!res) return reply.code(404).send({ error: 'Project not found' });
      return res;
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/git/push',
    async (request, reply) => {
      const res = await stage3.pushProjectRepo(request.params.projectIdOrSlug);
      if (!res) return reply.code(404).send({ error: 'Project not found' });
      return res;
    },
  );
}
