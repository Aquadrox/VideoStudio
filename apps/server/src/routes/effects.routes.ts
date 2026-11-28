import type { FastifyInstance } from 'fastify';
import {
  CreateVideoEffectInputSchema,
  UpdateVideoEffectInputSchema,
} from '@videostudio/shared';
import type { EffectsService } from '../services/effects.service.js';

export function registerEffectsRoutes(app: FastifyInstance, effects: EffectsService): void {
  app.get<{
    Querystring: { category?: string; q?: string; createdBy?: string };
  }>('/api/effects', async (request) => {
    const list = await effects.listEffects({
      category: request.query.category,
      query: request.query.q,
      createdBy: request.query.createdBy,
    });
    return { effects: list };
  });

  app.get<{ Params: { idOrSlug: string } }>('/api/effects/:idOrSlug', async (request, reply) => {
    const effect = await effects.getEffectByIdOrSlug(request.params.idOrSlug);
    if (!effect) return reply.code(404).send({ error: 'Effect not found' });
    return { effect };
  });

  app.post('/api/effects', async (request, reply) => {
    const parsed = CreateVideoEffectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    try {
      const effect = await effects.createEffect(parsed.data, 'user');
      return reply.code(201).send({ effect });
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Failed to create effect',
      });
    }
  });

  app.patch<{ Params: { idOrSlug: string } }>('/api/effects/:idOrSlug', async (request, reply) => {
    const parsed = UpdateVideoEffectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    try {
      const effect = await effects.updateEffect(request.params.idOrSlug, parsed.data, 'user');
      if (!effect) return reply.code(404).send({ error: 'Effect not found' });
      return { effect };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Failed to update effect',
      });
    }
  });

  app.delete<{ Params: { idOrSlug: string } }>('/api/effects/:idOrSlug', async (request, reply) => {
    try {
      const deleted = await effects.deleteEffect(request.params.idOrSlug, 'user');
      if (!deleted) return reply.code(404).send({ error: 'Effect not found' });
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Failed to delete effect',
      });
    }
  });
}
