import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { inferMimeType, type MediaService } from '../services/media.service.js';
import type { StudioService } from '../services/studio.service.js';

export function registerMediaRoutes(
  app: FastifyInstance,
  studio: StudioService,
  media: MediaService,
): void {
  app.get<{ Params: { assetId: string; variant: string } }>(
    '/api/media/:assetId/:variant',
    async (request, reply) => {
      const { assetId, variant } = request.params;
      if (variant !== 'original' && variant !== 'proxy' && variant !== 'thumbnail') {
        return reply.code(400).send({ error: 'Invalid media variant' });
      }

      const found = await studio.getAssetById(assetId);
      if (!found) {
        return reply.code(404).send({ error: 'Asset not found' });
      }

      const relPath =
        variant === 'original'
          ? found.raw.filePath
          : variant === 'proxy'
            ? found.raw.proxyPath ?? found.raw.filePath
            : found.raw.thumbnailPath ?? found.raw.proxyPath ?? found.raw.filePath;

      const absPath = media.resolveMediaFile(relPath);

      let stat: fs.Stats;
      try {
        stat = await fsPromises.stat(absPath);
      } catch {
        return reply.code(404).send({ error: 'Media file missing on disk' });
      }

      const fileSize = stat.size;
      const contentType =
        variant === 'original'
          ? found.raw.mimeType
          : inferMimeType(path.basename(absPath));

      const rangeHeader = request.headers.range;
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');

      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
        if (!match) {
          return reply.code(416).header('Content-Range', `bytes */${fileSize}`).send();
        }

        const start = match[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;

        if (
          Number.isNaN(start) ||
          Number.isNaN(end) ||
          start > end ||
          start >= fileSize ||
          end >= fileSize
        ) {
          return reply.code(416).header('Content-Range', `bytes */${fileSize}`).send();
        }

        const chunkSize = end - start + 1;
        reply.code(206);
        reply.header('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        reply.header('Content-Length', chunkSize);
        reply.header('Content-Type', contentType);
        return reply.send(fs.createReadStream(absPath, { start, end }));
      }

      reply.header('Content-Length', fileSize);
      reply.header('Content-Type', contentType);
      return reply.send(fs.createReadStream(absPath));
    },
  );
}
