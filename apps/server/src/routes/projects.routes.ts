import type { FastifyInstance } from 'fastify';
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
} from '@videostudio/shared';
import type { StudioService } from '../services/studio.service.js';

export function registerProjectRoutes(
  app: FastifyInstance,
  studio: StudioService,
): void {
  app.get('/api/projects', async () => {
    const items = await studio.listProjects();
    return { projects: items };
  });

  app.get<{ Params: { idOrSlug: string } }>('/api/projects/:idOrSlug', async (request, reply) => {
    const project = await studio.getProjectByIdOrSlug(request.params.idOrSlug);
    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }
    return { project };
  });

  app.post('/api/projects', async (request, reply) => {
    const parsed = CreateProjectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: parsed.error.flatten(),
      });
    }

    const project = await studio.createProject(parsed.data, 'user');
    return reply.code(201).send({ project });
  });

  app.patch<{ Params: { idOrSlug: string } }>(
    '/api/projects/:idOrSlug',
    async (request, reply) => {
      const parsed = UpdateProjectInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parsed.error.flatten(),
        });
      }

      const updated = await studio.updateProject(request.params.idOrSlug, parsed.data, 'user');
      if (!updated) {
        return reply.code(404).send({ error: 'Project not found' });
      }
      return { project: updated };
    },
  );

  app.delete<{ Params: { idOrSlug: string } }>(
    '/api/projects/:idOrSlug',
    async (request, reply) => {
      const deleted = await studio.deleteProject(request.params.idOrSlug);
      if (!deleted) {
        return reply.code(404).send({ error: 'Project not found' });
      }
      return reply.code(204).send();
    },
  );
}
