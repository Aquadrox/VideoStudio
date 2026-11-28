import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { AssetDto } from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import { MediaService } from '../services/media.service.js';
import type { StudioService } from '../services/studio.service.js';
import { registerAssetRoutes } from './assets.routes.js';

function makeDocAsset(overrides: Partial<AssetDto> = {}): AssetDto {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    projectSlug: 'demo',
    refCode: 'doc-001',
    handle: '@doc-001',
    uri: 'studio://projects/demo/assets/doc-001',
    folderPath: 'notes',
    title: 'Notes de montage',
    type: 'document',
    status: 'new',
    qualityTier: 'draft_lowres',
    rating: 0,
    parentAssetId: null,
    relationType: 'revision',
    versionNumber: 1,
    originalFilename: 'notes.md',
    mimeType: 'text/markdown',
    fileSize: 42,
    width: null,
    height: null,
    durationSec: null,
    fps: null,
    promptUsed: null,
    negativePrompt: null,
    modelName: null,
    seed: null,
    comfyMetadata: null,
    tags: ['document'],
    notes: '',
    qcChecks: {},
    qcStatus: 'pending',
    qcNotes: '',
    createdBy: 'user',
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    urls: {
      original: '/api/assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/file',
      proxy: null,
      thumbnail: null,
    },
    ...overrides,
  };
}

describe('Text document REST routes & MediaService text I/O', () => {
  it('reads, updates, and creates text documents via REST routes', async () => {
    const doc = makeDocAsset();
    const mockStudio = {
      readTextAssetContent: vi.fn(async (id: string) =>
        id === doc.id
          ? {
              asset: doc,
              content: '# Plan\n\nPremière note.',
              sizeBytes: 24,
              language: 'markdown',
              isExternalReference: false,
              updatedAt: doc.updatedAt,
            }
          : null,
      ),
      updateTextAssetContent: vi.fn(async (id: string, params: { content: string; saveMode?: string }) =>
        id === doc.id
          ? {
              asset: { ...doc, fileSize: Buffer.byteLength(params.content, 'utf8') },
              savedMode: params.saveMode === 'new_version' ? 'new_version' : 'in_place',
            }
          : null,
      ),
      createTextDocumentAsset: vi.fn(async (_project: string, params: { filename: string; content: string }) =>
        makeDocAsset({
          originalFilename: params.filename,
          title: params.filename,
          fileSize: Buffer.byteLength(params.content, 'utf8'),
        }),
      ),
    } as unknown as StudioService;

    const app = Fastify({ logger: false });
    registerAssetRoutes(app, mockStudio, {} as MediaService);

    const readRes = await app.inject({
      method: 'GET',
      url: `/api/assets/${doc.id}/content`,
    });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().language).toBe('markdown');
    expect(readRes.json().content).toContain('# Plan');

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/assets/${doc.id}/content`,
      payload: {
        content: '# Plan v2\n\nContenu mis à jour.',
        saveMode: 'in_place',
      },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().savedMode).toBe('in_place');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/documents',
      payload: {
        filename: 'render.log',
        content: '[INFO] Render started\n[ERROR] Sample error',
        folderPath: 'logs',
      },
    });
    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().asset.originalFilename).toBe('render.log');

    await app.close();
  });

  it('safely reads/writes managed text files and blocks overwriting external ingest references', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-text-test-'));
    try {
      const config = {
        dataDir: tmpDir,
        ingestAllowedDir: tmpDir,
        ingestExtraDirs: [],
        maxUploadBytes: 10 * 1024 * 1024,
        allowedFetchHosts: [],
      } as unknown as AppConfig;
      const media = new MediaService(config);

      await fs.writeFile(path.join(tmpDir, 'notes.md'), '# Initial', 'utf8');
      const loaded = await media.readTextFileContent('notes.md');
      expect(loaded.content).toBe('# Initial');
      expect(loaded.isExternalReference).toBe(false);

      await media.writeManagedTextFile('notes.md', '# Updated');
      const reloaded = await media.readTextFileContent('notes.md');
      expect(reloaded.content).toBe('# Updated');

      // Refuses overwriting read-only external ingest references
      await expect(media.writeManagedTextFile('ingest://notes.md', 'nope')).rejects.toThrow();

      // Refuses binary files containing NUL bytes
      await fs.writeFile(path.join(tmpDir, 'bin.dat'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
      await expect(media.readTextFileContent('bin.dat')).rejects.toThrow(/binaire/i);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
