import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import type { MediaService } from '../services/media.service.js';
import type { Stage2Service } from '../services/stage2.service.js';
import type { Stage3Service } from '../services/stage3.service.js';
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
    skillsSyncDir: '/tmp/videostudio-test-skills',
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
      stage2: {} as Stage2Service,
      stage3: {} as Stage3Service,
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

  it('responds to authenticated MCP initialize and tools/list requests including Stage 2 & Stage 3 tools', async () => {
    const app = Fastify({ logger: false });
    registerMcpRoutes(app, {
      config: createTestConfig(),
      studio: {} as StudioService,
      media: {} as MediaService,
      stage2: {} as Stage2Service,
      stage3: {} as Stage3Service,
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
      // Stage 1
      expect(toolsText).toContain('register_asset');
      expect(toolsText).toContain('resolve_reference');
      expect(toolsText).toContain('update_project');
      expect(toolsText).toContain('list_media_folders');
      expect(toolsText).toContain('create_media_folder');
      expect(toolsText).toContain('sync_agent_tasks');
      expect(toolsText).toContain('update_agent_task');
      expect(toolsText).toContain('list_agent_tasks');
      expect(toolsText).toContain('clear_agent_tasks');
      // Stage 2
      expect(toolsText).toContain('get_pending_feedback');
      expect(toolsText).toContain('get_active_rules');
      expect(toolsText).toContain('update_rule');
      expect(toolsText).toContain('delete_rule');
      expect(toolsText).toContain('save_skill');
      // Stage 3
      expect(toolsText).toContain('update_script');
      expect(toolsText).toContain('upsert_bible_entity');
      expect(toolsText).toContain('create_shot');
      expect(toolsText).toContain('upsert_audio_track');
      expect(toolsText).toContain('update_youtube_package');
      expect(toolsText).toContain('prepare_youtube_pack');
      expect(toolsText).toContain('init_project_git_repo');
      expect(toolsText).toContain('sync_and_commit_project_repo');
    } finally {
      await app.close();
    }
  });
});
