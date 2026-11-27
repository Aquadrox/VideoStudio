import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AppConfig } from '../config.js';
import { createVideoStudioMcpServer } from '../mcp/mcp-server.js';
import type { MediaService } from '../services/media.service.js';
import type { StudioService } from '../services/studio.service.js';
import { verifyBearerToken } from '../utils/security.js';

/**
 * Exposes the VideoStudio MCP server over Streamable HTTP at `/mcp`.
 * Protected by constant-time Bearer token authentication (`MCP_AUTH_TOKEN`).
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; studio: StudioService; media: MediaService },
): void {
  const handleMcpRequest = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ) => {
    const authHeader = request.headers.authorization;
    if (!verifyBearerToken(authHeader, deps.config.mcpAuthToken)) {
      return reply.code(401).send({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized: invalid or missing MCP Bearer token' },
        id: null,
      });
    }

    // Stateless per-request transport: resilient across container restarts & concurrent Claude Code sessions
    const mcpServer = createVideoStudioMcpServer(deps.studio, deps.media);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    reply.hijack();

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err }, 'MCP Streamable HTTP error');
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader('Content-Type', 'application/json');
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal MCP server error' },
            id: null,
          }),
        );
      }
    } finally {
      reply.raw.on('close', () => {
        void transport.close();
        void mcpServer.close();
      });
    }
  };

  app.post('/mcp', handleMcpRequest);
  app.get('/mcp', handleMcpRequest);
  app.delete('/mcp', handleMcpRequest);
}
