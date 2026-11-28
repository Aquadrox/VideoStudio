import type { FastifyInstance } from 'fastify';
import {
  LinkSketchToShotSchema,
  ReorderSketchBoardSchema,
  SaveSketchSchema,
  SyncSketchBoardToStoryboardSchema,
} from '@videostudio/shared';
import type { SketchService } from '../services/sketch.service.js';

export function registerSketchRoutes(app: FastifyInstance, sketches: SketchService): void {
  app.get<{ Params: { idOrSlug: string } }>(
    '/api/projects/:idOrSlug/sketches',
    async (request) => {
      const list = await sketches.listSketches(request.params.idOrSlug);
      return { sketches: list };
    },
  );

  app.get<{ Params: { id: string } }>('/api/sketches/:id', async (request, reply) => {
    const sketch = await sketches.getSketchById(request.params.id);
    if (!sketch) return reply.code(404).send({ error: 'Sketch not found' });
    return { sketch };
  });

  app.get<{ Params: { assetId: string } }>(
    '/api/assets/:assetId/sketch',
    async (request) => {
      const sketch = await sketches.getSketchByAssetId(request.params.assetId);
      return { sketch };
    },
  );

  app.post<{ Params: { idOrSlug: string }; Body: unknown }>(
    '/api/projects/:idOrSlug/sketches',
    async (request, reply) => {
      const parsed = SaveSketchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid sketch payload',
          details: parsed.error.flatten(),
        });
      }
      try {
        const sketch = await sketches.createSketch(request.params.idOrSlug, parsed.data, 'user');
        return reply.code(201).send({ sketch });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create sketch';
        return reply.code(message.includes('not found') ? 404 : 400).send({ error: message });
      }
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/sketches/:id',
    async (request, reply) => {
      const parsed = SaveSketchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid sketch payload',
          details: parsed.error.flatten(),
        });
      }
      try {
        const sketch = await sketches.updateSketch(request.params.id, parsed.data, 'user');
        if (!sketch) return reply.code(404).send({ error: 'Sketch not found' });
        return { sketch };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update sketch';
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.patch<{ Params: { idOrSlug: string }; Body: unknown }>(
    '/api/projects/:idOrSlug/sketches/board-order',
    async (request, reply) => {
      const parsed = ReorderSketchBoardSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid board order payload',
          details: parsed.error.flatten(),
        });
      }
      try {
        const list = await sketches.reorderSketchBoard(request.params.idOrSlug, parsed.data);
        return { sketches: list };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to reorder sketch board';
        return reply.code(message.includes('not found') ? 404 : 400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/sketches/:id/link-shot',
    async (request, reply) => {
      const parsed = LinkSketchToShotSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid shot link payload',
          details: parsed.error.flatten(),
        });
      }
      try {
        const sketch = await sketches.linkSketchToShot(request.params.id, parsed.data, 'user');
        if (!sketch) return reply.code(404).send({ error: 'Sketch not found' });
        return { sketch };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to link sketch to shot';
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { idOrSlug: string }; Body: unknown }>(
    '/api/projects/:idOrSlug/sketches/sync-to-storyboard',
    async (request, reply) => {
      const parsed = SyncSketchBoardToStoryboardSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid sync payload',
          details: parsed.error.flatten(),
        });
      }
      try {
        const result = await sketches.syncSketchBoardToStoryboard(
          request.params.idOrSlug,
          parsed.data,
          'user',
        );
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to sync sketch board';
        return reply.code(message.includes('not found') ? 404 : 400).send({ error: message });
      }
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { deleteAsset?: string } }>(
    '/api/sketches/:id',
    async (request, reply) => {
      const deleted = await sketches.deleteSketch(request.params.id, {
        deleteLinkedAsset: request.query.deleteAsset === 'true',
      });
      if (!deleted) return reply.code(404).send({ error: 'Sketch not found' });
      return reply.code(204).send();
    },
  );
}
