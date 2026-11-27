import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AssetStatusSchema,
  AssetTypeSchema,
  IngestAssetJsonInputSchema,
  QualityTierSchema,
  UpdateAssetInputSchema,
} from '@videostudio/shared';
import type { MediaService } from '../services/media.service.js';
import type { StudioService } from '../services/studio.service.js';

export function registerAssetRoutes(
  app: FastifyInstance,
  studio: StudioService,
  media: MediaService,
): void {
  // --- Media Folders ---

  app.get<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/folders',
    async (request, reply) => {
      const project = await studio.getProjectByIdOrSlug(request.params.projectIdOrSlug);
      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }
      const folders = await studio.listMediaFolders(project.id);
      return { folders };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/folders',
    async (request, reply) => {
      const parsed = z.object({ path: z.string().min(1).max(200) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parsed.error.flatten(),
        });
      }
      try {
        const folder = await studio.createMediaFolder(
          request.params.projectIdOrSlug,
          parsed.data.path,
          'user',
        );
        if (!folder) {
          return reply.code(404).send({ error: 'Project not found' });
        }
        return reply.code(201).send({ folder });
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Invalid folder path',
        });
      }
    },
  );

  app.delete<{
    Params: { projectIdOrSlug: string };
    Querystring: { path?: string };
  }>('/api/projects/:projectIdOrSlug/folders', async (request, reply) => {
    const folderPath = request.query.path?.trim() ?? '';
    if (!folderPath) {
      return reply.code(400).send({ error: 'Missing path query parameter' });
    }
    const ok = await studio.deleteMediaFolder(request.params.projectIdOrSlug, folderPath);
    if (!ok) {
      return reply.code(404).send({ error: 'Project or folder not found' });
    }
    return reply.code(204).send();
  });

  // --- Assets ---

  app.get<{
    Params: { projectIdOrSlug: string };
    Querystring: {
      type?: string;
      status?: string;
      qualityTier?: string;
      folderPath?: string;
      recursive?: string;
      tag?: string;
      search?: string;
      limit?: string;
    };
  }>('/api/projects/:projectIdOrSlug/assets', async (request, reply) => {
    const project = await studio.getProjectByIdOrSlug(request.params.projectIdOrSlug);
    if (!project) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const typeResult = request.query.type
      ? AssetTypeSchema.safeParse(request.query.type)
      : null;
    const statusResult = request.query.status
      ? AssetStatusSchema.safeParse(request.query.status)
      : null;
    const tierResult = request.query.qualityTier
      ? QualityTierSchema.safeParse(request.query.qualityTier)
      : null;

    const recursive =
      request.query.recursive === 'true' || request.query.recursive === '1';

    const list = await studio.listAssets(project.id, {
      type: typeResult?.success ? typeResult.data : undefined,
      status: statusResult?.success ? statusResult.data : undefined,
      qualityTier: tierResult?.success ? tierResult.data : undefined,
      folderPath: request.query.folderPath,
      recursive,
      tag: request.query.tag,
      search: request.query.search,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
    });

    return { assets: list };
  });

  // Supports both multipart/form-data (browser upload) and JSON (sourceUrl / base64Data / localFilePath)
  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/assets',
    async (request, reply) => {
      const project = await studio.getProjectByIdOrSlug(request.params.projectIdOrSlug);
      if (!project) {
        return reply.code(404).send({ error: 'Project not found' });
      }

      if (request.isMultipart()) {
        const parts = request.parts();
        let fileBuffer: Buffer | null = null;
        let filename = 'upload.bin';
        let mimeType = 'application/octet-stream';
        const fields: Record<string, string> = {};

        for await (const part of parts) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer();
            filename = part.filename || filename;
            mimeType = part.mimetype || mimeType;
          } else {
            fields[part.fieldname] = String(part.value ?? '');
          }
        }

        if (!fileBuffer) {
          return reply.code(400).send({ error: 'No file provided in multipart upload' });
        }

        const qualityTierParsed = fields.qualityTier
          ? QualityTierSchema.safeParse(fields.qualityTier)
          : null;
        const statusParsed = fields.status ? AssetStatusSchema.safeParse(fields.status) : null;
        const tags = fields.tags
          ? fields.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [];

        const created = await studio.ingestAssetFromBuffer({
          projectIdOrSlug: project.id,
          buffer: fileBuffer,
          filename,
          mimeType,
          folderPath: fields.folderPath || undefined,
          title: fields.title || undefined,
          qualityTier: qualityTierParsed?.success ? qualityTierParsed.data : 'test',
          status: statusParsed?.success ? statusParsed.data : 'new',
          parentAssetId: fields.parentAssetId || undefined,
          parentRef: fields.parentRef || undefined,
          promptUsed: fields.promptUsed || undefined,
          negativePrompt: fields.negativePrompt || undefined,
          tags,
          notes: fields.notes || '',
          createdBy: 'user',
        });

        return reply.code(201).send({ asset: created });
      }

      const parsed = IngestAssetJsonInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parsed.error.flatten(),
        });
      }

      const data = parsed.data;
      try {
        let buffer: Buffer;
        let filename = data.filename ?? 'asset.bin';
        let mimeType = data.mimeType;
        let sourceLocalAbsPath: string | undefined;
        let ingestRelativePath: string | undefined;

        if (data.sourceUrl) {
          const fetched = await media.fetchFromUrl(data.sourceUrl);
          buffer = fetched.buffer;
          filename = data.filename ?? fetched.filename;
          mimeType = data.mimeType ?? fetched.mimeType;
        } else if (data.localFilePath) {
          const loaded = await media.readLocalIngestFile(data.localFilePath);
          buffer = loaded.buffer;
          filename = data.filename ?? loaded.filename;
          mimeType = data.mimeType ?? loaded.mimeType;
          sourceLocalAbsPath = loaded.resolvedAbsPath;
          ingestRelativePath = loaded.ingestRelativePath;
        } else {
          const cleaned = (data.base64Data ?? '').replace(/^data:[^;]+;base64,/, '');
          buffer = Buffer.from(cleaned, 'base64');
        }

        const created = await studio.ingestAssetFromBuffer({
          projectIdOrSlug: project.id,
          buffer,
          filename,
          mimeType,
          explicitType: data.type,
          storageMode: data.storageMode,
          sourceLocalAbsPath,
          ingestRelativePath,
          folderPath: data.folderPath,
          title: data.title,
          qualityTier: data.qualityTier,
          status: data.status,
          parentAssetId: data.parentAssetId,
          parentRef: data.parentRef,
          promptUsed: data.promptUsed,
          negativePrompt: data.negativePrompt,
          modelName: data.modelName,
          seed: data.seed,
          tags: data.tags,
          notes: data.notes,
          createdBy: data.createdBy,
        });

        return reply.code(201).send({ asset: created });
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Asset ingestion failed',
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const found = await studio.getAssetById(request.params.id);
    if (!found) {
      return reply.code(404).send({ error: 'Asset not found' });
    }
    const lineage = await studio.getAssetLineage(found.asset.id);
    return { asset: found.asset, lineage };
  });

  app.patch<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const parsed = UpdateAssetInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: parsed.error.flatten(),
      });
    }

    const updated = await studio.updateAsset(request.params.id, parsed.data, 'user');
    if (!updated) {
      return reply.code(404).send({ error: 'Asset not found' });
    }
    return { asset: updated };
  });

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const deleted = await studio.deleteAsset(request.params.id, 'user');
    if (!deleted) {
      return reply.code(404).send({ error: 'Asset not found' });
    }
    return reply.code(204).send();
  });
}
