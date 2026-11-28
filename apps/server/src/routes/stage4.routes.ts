import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AddTimelineClipInputSchema,
  NleExportFormatSchema,
  PatchTimelineClipInputSchema,
  PatchTimelineClipsInputSchema,
  RenderTimelineRangeInputSchema,
  SaveProjectSubtitlesInputSchema,
  SplitTimelineClipInputSchema,
  StartTimelineRenderInputSchema,
  TimelineQualityModeSchema,
  UpsertTimelineInputSchema,
} from '@videostudio/shared';
import type { Stage4Service } from '../services/stage4.service.js';

export function registerStage4Routes(app: FastifyInstance, stage4: Stage4Service): void {
  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline',
    async (request, reply) => {
      const timeline = await stage4.getTimeline(request.params.projectIdOrSlug);
      if (!timeline) return reply.code(404).send({ error: 'Project not found' });
      return { timeline };
    },
  );

  app.put<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline',
    async (request, reply) => {
      const parsed = UpsertTimelineInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const timeline = await stage4.saveTimeline(request.params.projectIdOrSlug, parsed.data, 'user');
      if (!timeline) return reply.code(404).send({ error: 'Project not found' });
      return { timeline };
    },
  );

  // --- Surgical CapCut Clip Editing Endpoints ---

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/patch',
    async (request, reply) => {
      const parsed = PatchTimelineClipsInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const res = await stage4.patchTimelineClips(
          request.params.projectIdOrSlug,
          parsed.data,
          'user',
        );
        if (!res) return reply.code(404).send({ error: 'Project not found' });
        return res;
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to patch timeline clips',
        });
      }
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/clips',
    async (request, reply) => {
      const parsed = AddTimelineClipInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const res = await stage4.addClip(request.params.projectIdOrSlug, parsed.data, 'user');
        if (!res) return reply.code(404).send({ error: 'Project not found' });
        return reply.code(201).send(res);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to add clip',
        });
      }
    },
  );

  app.patch<{ Params: { projectIdOrSlug: string; clipId: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/clips/:clipId',
    async (request, reply) => {
      const parsed = PatchTimelineClipInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const res = await stage4.updateClip(
          request.params.projectIdOrSlug,
          request.params.clipId,
          parsed.data,
          'user',
        );
        if (!res) return reply.code(404).send({ error: 'Clip or project not found' });
        return res;
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to update clip',
        });
      }
    },
  );

  app.post<{ Params: { projectIdOrSlug: string; clipId: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/clips/:clipId/split',
    async (request, reply) => {
      const parsed = SplitTimelineClipInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const res = await stage4.splitClip(
          request.params.projectIdOrSlug,
          request.params.clipId,
          parsed.data.splitAtSec,
          'user',
        );
        if (!res) return reply.code(404).send({ error: 'Clip or project not found' });
        return res;
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to split clip',
        });
      }
    },
  );

  app.delete<{
    Params: { projectIdOrSlug: string; clipId: string };
    Querystring: { ripple?: string };
  }>('/api/projects/:projectIdOrSlug/timeline/clips/:clipId', async (request, reply) => {
    const ripple = request.query.ripple === '1' || request.query.ripple === 'true';
    const res = await stage4.deleteClip(
      request.params.projectIdOrSlug,
      request.params.clipId,
      { ripple },
      'user',
    );
    if (!res) return reply.code(404).send({ error: 'Clip or project not found' });
    return res;
  });

  app.delete<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/render-cache',
    async (request, reply) => {
      const res = await stage4.clearRenderCache(request.params.projectIdOrSlug);
      if (!res) return reply.code(404).send({ error: 'Project not found' });
      return res;
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/from-storyboard',
    async (request, reply) => {
      const parsed = z
        .object({ includeAudio: z.boolean().default(true) })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const timeline = await stage4.buildTimelineFromStoryboard(
        request.params.projectIdOrSlug,
        parsed.data,
        'user',
      );
      if (!timeline) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send({ timeline });
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/quality-mode',
    async (request, reply) => {
      const parsed = z
        .object({ mode: TimelineQualityModeSchema })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const res = await stage4.swapTimelineQualityMode(
        request.params.projectIdOrSlug,
        parsed.data.mode,
        'user',
      );
      if (!res) return reply.code(404).send({ error: 'Project not found' });
      return res;
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/render',
    async (request, reply) => {
      const parsed = StartTimelineRenderInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const res = await stage4.startServerRender(
          request.params.projectIdOrSlug,
          parsed.data,
          'user',
        );
        if (!res) return reply.code(404).send({ error: 'Project not found' });
        return reply.code(202).send(res);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to start render',
        });
      }
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/timeline/render-range',
    async (request, reply) => {
      const parsed = RenderTimelineRangeInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const res = await stage4.startRangeRender(
          request.params.projectIdOrSlug,
          parsed.data,
          'user',
        );
        if (!res) return reply.code(404).send({ error: 'Project not found' });
        return reply.code(202).send(res);
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Failed to start range preview render',
        });
      }
    },
  );

  app.get<{
    Params: { projectIdOrSlug: string };
    Querystring: { format?: string; download?: string };
  }>('/api/projects/:projectIdOrSlug/timeline/export', async (request, reply) => {
    const formatParsed = NleExportFormatSchema.safeParse(request.query.format ?? 'otio');
    if (!formatParsed.success) {
      return reply.code(400).send({ error: 'format must be otio, fcpxml, or edl' });
    }
    const exported = await stage4.exportNle(request.params.projectIdOrSlug, formatParsed.data);
    if (!exported) return reply.code(404).send({ error: 'Project not found' });

    if (request.query.download === '1' || request.query.download === 'true') {
      return reply
        .header('Content-Disposition', `attachment; filename="${exported.filename}"`)
        .type(exported.mimeType)
        .send(exported.content);
    }

    return {
      format: formatParsed.data,
      filename: exported.filename,
      content: exported.content,
    };
  });

  // --- Synchronized Subtitles (SRT / VTT / LRC & Burn-in) ---

  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/subtitles',
    async (request, reply) => {
      const subtitles = await stage4.getSubtitles(request.params.projectIdOrSlug);
      if (!subtitles) return reply.code(404).send({ error: 'Project not found' });
      return { subtitles };
    },
  );

  app.put<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/subtitles',
    async (request, reply) => {
      const parsed = SaveProjectSubtitlesInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const subtitles = await stage4.saveSubtitles(request.params.projectIdOrSlug, parsed.data, 'user');
      if (!subtitles) return reply.code(404).send({ error: 'Project not found' });
      return { subtitles };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/subtitles/import',
    async (request, reply) => {
      const parsed = z
        .object({
          source: z.enum(['raw', 'audio_track', 'storyboard']),
          content: z.string().max(1_000_000).optional(),
          audioTrackId: z.string().uuid().optional(),
          replace: z.boolean().default(true),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const res = await stage4.importSubtitles(request.params.projectIdOrSlug, parsed.data, 'user');
      if (!res) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send(res);
    },
  );

  app.get<{
    Params: { projectIdOrSlug: string };
    Querystring: { format?: string; download?: string };
  }>('/api/projects/:projectIdOrSlug/subtitles/export', async (request, reply) => {
    const fmt = request.query.format === 'vtt' ? 'vtt' : 'srt';
    const exported = await stage4.exportSubtitles(request.params.projectIdOrSlug, fmt);
    if (!exported) return reply.code(404).send({ error: 'Project not found' });

    if (request.query.download === '1' || request.query.download === 'true') {
      return reply
        .header('Content-Disposition', `attachment; filename="${exported.filename}"`)
        .type(exported.mimeType)
        .send(exported.content);
    }

    return {
      format: fmt,
      filename: exported.filename,
      content: exported.content,
    };
  });

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/subtitles/save-asset',
    async (request, reply) => {
      const parsed = z
        .object({ format: z.enum(['srt', 'vtt']).default('srt') })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const saved = await stage4.saveSubtitlesAsset(
        request.params.projectIdOrSlug,
        parsed.data.format,
        'user',
      );
      if (!saved) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send(saved);
    },
  );
}
