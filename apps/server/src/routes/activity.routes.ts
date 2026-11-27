import type { FastifyInstance } from 'fastify';
import type { StudioService } from '../services/studio.service.js';

export function registerActivityAndRefRoutes(
  app: FastifyInstance,
  studio: StudioService,
): void {
  app.get<{ Querystring: { project?: string; limit?: string } }>(
    '/api/activities',
    async (request) => {
      const limit = request.query.limit ? Number(request.query.limit) : 80;
      const items = await studio.listActivities(request.query.project, limit);
      return { activities: items };
    },
  );

  app.get<{ Querystring: { project?: string; limit?: string } }>(
    '/api/jobs',
    async (request) => {
      const limit = request.query.limit ? Number(request.query.limit) : 30;
      const items = await studio.listJobs(request.query.project, limit);
      return { jobs: items };
    },
  );

  app.get<{ Querystring: { ref?: string; project?: string } }>(
    '/api/refs/resolve',
    async (request, reply) => {
      if (!request.query.ref) {
        return reply.code(400).send({ error: 'Query parameter "ref" is required' });
      }
      const resolved = await studio.resolveReference(
        request.query.ref,
        request.query.project,
      );
      if (!resolved) {
        return reply.code(404).send({ error: `Reference not found: ${request.query.ref}` });
      }
      return { resolved };
    },
  );
}
