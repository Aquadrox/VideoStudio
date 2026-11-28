import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AssetRelationTypeSchema,
  AssetStatusSchema,
  AssetTypeSchema,
  IngestAssetJsonInputSchema,
  QualityTierSchema,
  RecordQcInputSchema,
  StorageModeSchema,
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
      cursor?: string;
      compact?: string;
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
    const compact = request.query.compact === 'true' || request.query.compact === '1';

    const page = await studio.listAssetsPage(project.id, {
      type: typeResult?.success ? typeResult.data : undefined,
      status: statusResult?.success ? statusResult.data : undefined,
      qualityTier: tierResult?.success ? tierResult.data : undefined,
      folderPath: request.query.folderPath,
      recursive,
      tag: request.query.tag,
      search: request.query.search,
      limit: request.query.limit ? Number(request.query.limit) : undefined,
      cursor: request.query.cursor,
    });

    return {
      assets: compact ? page.assets.map((a) => studio.toCompactAssetDto(a)) : page.assets,
      nextCursor: page.nextCursor,
      total: page.total,
    };
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
        const relationParsed = fields.relationType
          ? AssetRelationTypeSchema.safeParse(fields.relationType)
          : null;
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
          relationType: relationParsed?.success ? relationParsed.data : 'revision',
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
        let referenceUri: string | undefined;

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
          referenceUri = loaded.referenceUri;
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
          referenceUri,
          folderPath: data.folderPath,
          title: data.title,
          qualityTier: data.qualityTier,
          status: data.status,
          parentAssetId: data.parentAssetId,
          parentRef: data.parentRef,
          relationType: data.relationType,
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

  // Batch folder ingestion (idempotent, supports parentMatch)
  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/ingest-folder',
    async (request, reply) => {
      const schema = z.object({
        localDir: z.string().min(1),
        glob: z.string().optional(),
        recursive: z.boolean().default(false),
        folderPath: z.string().default(''),
        storageMode: StorageModeSchema.default('reference'),
        qualityTier: QualityTierSchema.default('test'),
        relationType: AssetRelationTypeSchema.optional(),
        parentMatch: z.string().default('none'),
        tags: z.array(z.string()).default([]),
        limit: z.number().int().min(1).max(1000).default(500),
      });
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      try {
        const result = await studio.ingestFolderBatch({
          projectIdOrSlug: request.params.projectIdOrSlug,
          ...parsed.data,
          createdBy: 'user',
        });
        return result;
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : 'Folder ingestion failed',
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

  app.patch<{ Params: { id: string } }>('/api/assets/:id/qc', async (request, reply) => {
    const parsed = RecordQcInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: parsed.error.flatten(),
      });
    }
    const updated = await studio.recordAssetQc(request.params.id, parsed.data, 'user');
    if (!updated) {
      return reply.code(404).send({ error: 'Asset not found' });
    }
    return { asset: updated };
  });

  app.post<{ Params: { id: string } }>('/api/assets/:id/frame', async (request, reply) => {
    const parsed = z
      .object({
        timecodeSec: z.number().min(0).default(0),
        maxWidth: z.number().int().min(160).max(3840).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const found = await studio.getAssetById(request.params.id);
    if (!found) return reply.code(404).send({ error: 'Asset not found' });

    try {
      const absPath = media.resolveMediaFile(found.raw.filePath);
      const frame = await media.extractVideoFrame({
        absPath,
        assetType: found.asset.type,
        timecodeSec: parsed.data.timecodeSec,
        maxWidth: parsed.data.maxWidth,
      });
      return reply.type(frame.mimeType).send(frame.buffer);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Frame extraction failed',
      });
    }
  });

  app.post<{ Params: { id: string } }>('/api/assets/:id/contact-sheet', async (request, reply) => {
    const parsed = z
      .object({
        everySec: z.number().min(0.1).max(60).optional(),
        columns: z.number().int().min(1).max(12).optional(),
        tileWidth: z.number().int().min(120).max(960).optional(),
        maxFrames: z.number().int().min(1).max(120).optional(),
      })
      .safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const found = await studio.getAssetById(request.params.id);
    if (!found) return reply.code(404).send({ error: 'Asset not found' });

    try {
      const absPath = media.resolveMediaFile(found.raw.filePath);
      const sheet = await media.generateContactSheet({
        absPath,
        assetType: found.asset.type,
        ...parsed.data,
      });
      return reply.type(sheet.mimeType).send(sheet.buffer);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Contact sheet generation failed',
      });
    }
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id/content', async (request, reply) => {
    try {
      const data = await studio.readTextAssetContent(request.params.id);
      if (!data) {
        return reply.code(404).send({ error: 'Asset not found' });
      }
      return data;
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Unable to read text content',
      });
    }
  });

  app.put<{ Params: { id: string } }>('/api/assets/:id/content', async (request, reply) => {
    const parsed = z
      .object({
        content: z.string().max(5 * 1024 * 1024),
        saveMode: z.enum(['in_place', 'new_version']).default('in_place'),
        title: z.string().min(1).max(200).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation error',
        details: parsed.error.flatten(),
      });
    }
    try {
      const result = await studio.updateTextAssetContent(request.params.id, parsed.data, 'user');
      if (!result) {
        return reply.code(404).send({ error: 'Asset not found' });
      }
      return result;
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : 'Unable to save text content',
      });
    }
  });

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/documents',
    async (request, reply) => {
      const parsed = z
        .object({
          filename: z.string().min(1).max(160),
          content: z.string().max(5 * 1024 * 1024).default(''),
          title: z.string().max(200).optional(),
          folderPath: z.string().max(240).optional(),
          tags: z.array(z.string().max(48)).max(24).optional(),
          notes: z.string().max(4000).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Validation error',
          details: parsed.error.flatten(),
        });
      }
      try {
        const asset = await studio.createTextDocumentAsset(
          request.params.projectIdOrSlug,
          parsed.data,
          'user',
        );
        return reply.code(201).send({ asset });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create document';
        return reply.code(message.includes('not found') ? 404 : 400).send({ error: message });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/assets/:id', async (request, reply) => {
    const deleted = await studio.deleteAsset(request.params.id, 'user');
    if (!deleted) {
      return reply.code(404).send({ error: 'Asset not found' });
    }
    return reply.code(204).send();
  });
}
