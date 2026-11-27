import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import type { MediaService } from '../services/media.service.js';
import type { StudioService } from '../services/studio.service.js';
import { registerMcpRoutes } from './mcp.routes.js';

function createTestConfig(): AppConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    mcpAuthToken: 'unit-test-token-123456',
    corsOrigin: '*',
    dataDir: '/tmp/videostudio-test-data',
    ingestAllowedDir: '/tmp/videostudio-test-ingest',
    maxUploadBytes: 10 * 1024 * 1024,
    allowedFetchHosts: [],
  };
}

describe('MCP Streamable HTTP route', () => {
  it('rejects requests without a valid Bearer token with 401', async () => {
    const app = Fastify({ logger: false });
    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio: {} as StudioService,
      media: {} as MediaService,
    });

    const missingAuth = await app.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(missingAuth.statusCode).toBe(401);

    const wrongAuth = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer wrong-secret' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(wrongAuth.statusCode).toBe(401);

    await app.close();
  });

  it('responds to authenticated MCP initialize and tools/list requests over HTTP', async () => {
    const app = Fastify({ logger: false });
    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio: {} as StudioService,
      media: {} as MediaService,
    });

    const address = await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      const initRes = await fetch(`${address}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer unit-test-token-123456',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'vitest-client', version: '1.0.0' },
          },
        }),
      });

      expect(initRes.status).toBe(200);
      const initText = await initRes.text();
      expect(initText).toContain('"name":"videostudio"');

      const toolsRes = await fetch(`${address}/mcp`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer unit-test-token-123456',
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
      });

      expect(toolsRes.status).toBe(200);
      const toolsText = await toolsRes.text();
      expect(toolsText).toContain('register_asset');
      expect(toolsText).toContain('resolve_reference');
      expect(toolsText).toContain('start_job');
    } finally {
      await app.close();
    }
  });
});
