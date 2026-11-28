import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KnowledgeKindSchema,
  KnowledgeProjectTypeSchema,
  UpdateStudioKnowledgeInputSchema,
  UpsertStudioKnowledgeInputSchema,
} from '@videostudio/shared';
import type { KnowledgeService } from '../services/knowledge.service.js';

export function registerKnowledgeRoutes(app: FastifyInstance, knowledge: KnowledgeService): void {
  app.get<{
    Querystring: {
      projectType?: string;
      kind?: string;
      search?: string;
      verifiedOnly?: string;
      tag?: string;
    };
  }>('/api/knowledge', async (request, reply) => {
    const projectType = request.query.projectType
      ? KnowledgeProjectTypeSchema.safeParse(request.query.projectType)
      : null;
    if (projectType && !projectType.success) {
      return reply.code(400).send({ error: 'Invalid projectType filter' });
    }
    const kind = request.query.kind ? KnowledgeKindSchema.safeParse(request.query.kind) : null;
    if (kind && !kind.success) {
      return reply.code(400).send({ error: 'Invalid kind filter' });
    }

    const entries = await knowledge.listEntries({
      projectType: projectType?.data,
      kind: kind?.data,
      search: request.query.search,
      verifiedOnly: request.query.verifiedOnly === '1' || request.query.verifiedOnly === 'true',
      tag: request.query.tag,
    });
    return { entries };
  });

  app.get<{
    Querystring: { projectIdOrSlug?: string; projectType?: string };
  }>('/api/knowledge/playbook', async (request, reply) => {
    const projectType = request.query.projectType
      ? KnowledgeProjectTypeSchema.safeParse(request.query.projectType)
      : null;
    if (projectType && !projectType.success) {
      return reply.code(400).send({ error: 'Invalid projectType' });
    }

    const playbook = await knowledge.recallPlaybook({
      projectIdOrSlug: request.query.projectIdOrSlug,
      projectType: projectType?.data,
      incrementUsage: false,
    });
    if (!playbook) return reply.code(404).send({ error: 'Project not found' });
    return { playbook };
  });

  app.post('/api/knowledge', async (request, reply) => {
    const parsed = UpsertStudioKnowledgeInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const res = await knowledge.upsertEntry(parsed.data, 'user');
    return reply.code(res.created ? 201 : 200).send(res);
  });

  app.patch<{ Params: { idOrSlug: string } }>('/api/knowledge/:idOrSlug', async (request, reply) => {
    const parsed = UpdateStudioKnowledgeInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const entry = await knowledge.updateEntry(request.params.idOrSlug, parsed.data);
    if (!entry) return reply.code(404).send({ error: 'Knowledge entry not found' });
    return { entry };
  });

  app.delete<{ Params: { idOrSlug: string } }>('/api/knowledge/:idOrSlug', async (request, reply) => {
    const deleted = await knowledge.deleteEntry(request.params.idOrSlug);
    if (!deleted) return reply.code(404).send({ error: 'Knowledge entry not found' });
    return { deleted: true };
  });

  app.post<{ Params: { idOrSlug: string } }>(
    '/api/knowledge/:idOrSlug/apply-to-project',
    async (request, reply) => {
      const parsed = z.object({ projectIdOrSlug: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'projectIdOrSlug is required' });
      }
      const res = await knowledge.applyEntryToProject(
        request.params.idOrSlug,
        parsed.data.projectIdOrSlug,
        'user',
      );
      if (!res) return reply.code(404).send({ error: 'Entry or project not found' });
      return reply.code(201).send(res);
    },
  );
}
