import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ProductionDossierOptionsSchema } from '@videostudio/shared';
import type { DossierService } from '../services/dossier.service.js';

const DossierFormatSchema = z.enum(['html', 'markdown']);

function parseBoolQuery(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value === 'true';
}

export function registerDossierRoutes(app: FastifyInstance, dossier: DossierService): void {
  app.get<{
    Params: { projectIdOrSlug: string };
    Querystring: {
      format?: string;
      layout?: string;
      download?: string;
      standalone?: string;
      includeScript?: string;
      includeBible?: string;
      includeSketchBoard?: string;
      includeStoryboard?: string;
      includePrompts?: string;
      includeBriefs?: string;
      subtitle?: string;
      director?: string;
    };
  }>('/api/projects/:projectIdOrSlug/dossier', async (request, reply) => {
    const formatParsed = DossierFormatSchema.safeParse(request.query.format ?? 'html');
    if (!formatParsed.success) {
      return reply.code(400).send({ error: 'format must be html or markdown' });
    }

    const optsParsed = ProductionDossierOptionsSchema.safeParse({
      layout: request.query.layout ?? 'dossier',
      includeScript: parseBoolQuery(request.query.includeScript, true),
      includeBible: parseBoolQuery(request.query.includeBible, true),
      includeSketchBoard: parseBoolQuery(request.query.includeSketchBoard, true),
      includeStoryboard: parseBoolQuery(request.query.includeStoryboard, true),
      includePrompts: parseBoolQuery(request.query.includePrompts, true),
      includeBriefs: parseBoolQuery(request.query.includeBriefs, true),
      subtitle: request.query.subtitle,
      director: request.query.director,
    });
    if (!optsParsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: optsParsed.error.flatten() });
    }

    const standalone = parseBoolQuery(request.query.standalone, false);
    const result = await dossier.generateDossier(
      request.params.projectIdOrSlug,
      formatParsed.data,
      optsParsed.data,
      standalone,
    );
    if (!result) return reply.code(404).send({ error: 'Project not found' });

    if (parseBoolQuery(request.query.download, false)) {
      return reply
        .header('Content-Disposition', `attachment; filename="${result.filename}"`)
        .type(result.mimeType)
        .send(result.content);
    }

    if (formatParsed.data === 'html') {
      return reply.type(result.mimeType).send(result.content);
    }

    return {
      format: formatParsed.data,
      filename: result.filename,
      content: result.content,
    };
  });

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/dossier/save',
    async (request, reply) => {
      const bodySchema = ProductionDossierOptionsSchema.extend({
        format: DossierFormatSchema.default('html'),
      });
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const { format, ...options } = parsed.data;
      const saved = await dossier.saveDossierAsAsset(
        request.params.projectIdOrSlug,
        format,
        options,
        'user',
      );
      if (!saved) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send(saved);
    },
  );
}
