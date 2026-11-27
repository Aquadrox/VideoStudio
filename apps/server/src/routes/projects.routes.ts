import type { FastifyInstance } from 'fastify';
import {
  CreateProjectInputSchema,
  SyncAgentTasksInputSchema,
  UpdateAgentTaskInputSchema,
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

  // --- Agent Live Task List ---

  app.get<{ Params: { idOrSlug: string } }>(
    '/api/projects/:idOrSlug/tasks',
    async (request, reply) => {
      const project = await studio.getProjectByIdOrSlug(request.params.idOrSlug);
      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }
      const tasks = await studio.listAgentTasks(project.id);
      return { tasks };
    },
  );

  app.put<{ Params: { idOrSlug: string } }>(
    '/api/projects/:idOrSlug/tasks',
    async (request, reply) => {
      const parsed = SyncAgentTasksInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parsed.error.flatten(),
        });
      }
      const tasks = await studio.syncAgentTasks(request.params.idOrSlug, parsed.data, 'user');
      if (!tasks) {
        return reply.code(404).send({ error: 'Project not found' });
      }
      return { tasks };
    },
  );

  app.patch<{ Params: { idOrSlug: string; taskIdOrKey: string } }>(
    '/api/projects/:idOrSlug/tasks/:taskIdOrKey',
    async (request, reply) => {
      const parsed = UpdateAgentTaskInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parsed.error.flatten(),
        });
      }
      const updated = await studio.updateAgentTask(
        request.params.idOrSlug,
        request.params.taskIdOrKey,
        parsed.data,
        'user',
      );
      if (!updated) {
        return reply.code(404).send({ error: 'Project or task not found' });
      }
      return { task: updated };
    },
  );

  app.delete<{
    Params: { idOrSlug: string };
    Querystring: { scope?: string };
  }>('/api/projects/:idOrSlug/tasks', async (request, reply) => {
    const scope = request.query.scope === 'all' ? 'all' : 'completed';
    const tasks = await studio.clearAgentTasks(request.params.idOrSlug, scope);
    if (!tasks) {
      return reply.code(404).send({ error: 'Project not found' });
    }
    return { tasks };
  });
}
