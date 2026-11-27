import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { MediaService } from './media.service.js';

describe('MediaService storage modes (reference, hardlink, copy)', () => {
  let tmpRoot: string;
  let dataDir: string;
  let ingestDir: string;
  let media: MediaService;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'videostudio-media-test-'));
    dataDir = path.join(tmpRoot, 'data');
    ingestDir = path.join(tmpRoot, 'ingest');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(path.join(ingestDir, 'batch-01'), { recursive: true });

    const config: AppConfig = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      databaseUrl: 'postgresql://test:test@localhost:5432/test',
      mcpAuthToken: 'unit-test-token-123456',
      corsOrigin: '*',
      dataDir,
      ingestAllowedDir: ingestDir,
      skillsSyncDir: path.join(tmpRoot, 'skills'),
      maxUploadBytes: 50 * 1024 * 1024,
      allowedFetchHosts: [],
    };
    media = new MediaService(config);
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('supports zero-copy reference mode from ingest directory without duplicating originals or deleting them', async () => {
    const pngBuffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 229, g: 160, b: 56 } },
    })
      .png()
      .toBuffer();

    const sourcePath = path.join(ingestDir, 'batch-01', 'frame_001.png');
    await fs.writeFile(sourcePath, pngBuffer);

    const loaded = await media.readLocalIngestFile('batch-01/frame_001.png');
    expect(loaded.ingestRelativePath).toBe('batch-01/frame_001.png');

    const processed = await media.storeAndProcessMedia({
      projectSlug: 'demo',
      buffer: loaded.buffer,
      filename: loaded.filename,
      mimeType: loaded.mimeType,
      storageMode: 'reference',
      sourceLocalAbsPath: loaded.resolvedAbsPath,
      ingestRelativePath: loaded.ingestRelativePath,
    });

    expect(processed.filePath).toBe('ingest://batch-01/frame_001.png');
    expect(processed.thumbnailPath).toBeTruthy();
    expect(media.resolveMediaFile(processed.filePath)).toBe(sourcePath);

    // Originals folder in dataDir must stay empty (zero-copy!)
    const originalsDir = path.join(dataDir, 'projects', 'demo', 'originals');
    const originalsFiles = await fs.readdir(originalsDir);
    expect(originalsFiles).toHaveLength(0);

    // Deleting asset files must remove thumbnail in dataDir, NEVER the ingest:// source
    await media.deleteMediaFiles([processed.filePath, processed.thumbnailPath]);
    const sourceStillExists = await fs
      .stat(sourcePath)
      .then(() => true)
      .catch(() => false);
    expect(sourceStillExists).toBe(true);
  });

  it('supports hardlink storage mode sharing the same inode when on the same filesystem', async () => {
    const pngBuffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 40, g: 80, b: 120 } },
    })
      .png()
      .toBuffer();

    const sourcePath = path.join(ingestDir, 'batch-01', 'hardlink_test.png');
    await fs.writeFile(sourcePath, pngBuffer);

    const loaded = await media.readLocalIngestFile('batch-01/hardlink_test.png');
    const processed = await media.storeAndProcessMedia({
      projectSlug: 'demo',
      buffer: loaded.buffer,
      filename: loaded.filename,
      mimeType: loaded.mimeType,
      storageMode: 'hardlink',
      sourceLocalAbsPath: loaded.resolvedAbsPath,
      ingestRelativePath: loaded.ingestRelativePath,
    });

    expect(processed.filePath.startsWith('projects/demo/originals/')).toBe(true);
    const [srcStat, dstStat] = await Promise.all([
      fs.stat(sourcePath),
      fs.stat(media.resolveMediaFile(processed.filePath)),
    ]);
    expect(srcStat.ino).toBe(dstStat.ino);
  });
});
