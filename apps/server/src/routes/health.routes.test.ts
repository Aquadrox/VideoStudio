import Fastify from 'fastify';
import type pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaService } from '../services/media.service.js';
import type { RealtimeHub } from '../services/realtime.service.js';
import { registerHealthRoutes } from './health.routes.js';

describe('Health route with Blue/Green slot reporting', () => {
  const origSlot = process.env.DEPLOY_SLOT;

  afterEach(() => {
    if (origSlot === undefined) {
      delete process.env.DEPLOY_SLOT;
    } else {
      process.env.DEPLOY_SLOT = origSlot;
    }
  });

  it('reports active DEPLOY_SLOT (blue/green) and ok status when DB is up', async () => {
    process.env.DEPLOY_SLOT = 'green';
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, {
      pool: { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as unknown as pg.Pool,
      media: { checkFfmpegAvailable: vi.fn().mockResolvedValue(true) } as unknown as MediaService,
      realtime: { clientCount: 2 } as unknown as RealtimeHub,
      getInFlightRequests: () => 3,
    });

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('0.5.4');
    expect(body.slot).toBe('green');
    expect(body.inFlightRequests).toBe(3);
    expect(body.services.database).toBe('up');
    expect(body.services.ffmpeg).toBe('available');
    expect(body.services.mcpMode).toBe('stateless');
    await app.close();
  });

  it('falls back to standalone slot and returns 503 degraded when DB is down', async () => {
    delete process.env.DEPLOY_SLOT;
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, {
      pool: { query: vi.fn().mockRejectedValue(new Error('conn refused')) } as unknown as pg.Pool,
      media: { checkFfmpegAvailable: vi.fn().mockResolvedValue(false) } as unknown as MediaService,
      realtime: { clientCount: 0 } as unknown as RealtimeHub,
    });

    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.slot).toBe('standalone');
    expect(body.services.database).toBe('down');
    await app.close();
  });
});
