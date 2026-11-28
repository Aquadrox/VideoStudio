import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { DossierService } from '../services/dossier.service.js';
import { registerDossierRoutes } from './dossier.routes.js';

describe('dossier.routes', () => {
  it('returns print-ready HTML dossier, Markdown dossier, and saves to project media', async () => {
    const app = Fastify();
    const mockDossier = {
      generateDossier: vi.fn().mockImplementation(async (_proj, format) => {
        if (format === 'markdown') {
          return {
            filename: 'demo-dossier-production.md',
            mimeType: 'text/markdown; charset=utf-8',
            content: '# Dossier de Production — Demo\n',
          };
        }
        return {
          filename: 'demo-pitch-deck.html',
          mimeType: 'text/html; charset=utf-8',
          content: '<!doctype html><html><body>Demo Pitch</body></html>',
        };
      }),
      saveDossierAsAsset: vi.fn().mockResolvedValue({
        filename: 'demo-dossier-production.html',
        asset: { id: 'a1', handle: '@doc-001', title: 'Dossier' },
      }),
    } as unknown as DossierService;

    registerDossierRoutes(app, mockDossier);

    const htmlRes = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/dossier?format=html&layout=pitch_deck',
    });
    expect(htmlRes.statusCode).toBe(200);
    expect(htmlRes.headers['content-type']).toContain('text/html');
    expect(htmlRes.body).toContain('Demo Pitch');

    const mdRes = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/dossier?format=markdown',
    });
    expect(mdRes.statusCode).toBe(200);
    expect(mdRes.json().filename).toBe('demo-dossier-production.md');

    const saveRes = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/dossier/save',
      payload: { format: 'html', layout: 'pitch_deck' },
    });
    expect(saveRes.statusCode).toBe(201);
    expect(saveRes.json().asset.handle).toBe('@doc-001');
  });
});
