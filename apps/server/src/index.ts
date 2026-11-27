import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, ensureDatabaseSchema } from './db/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const { pool, db } = createDatabase(config.databaseUrl);

  await ensureDatabaseSchema(pool);

  const { app } = await buildApp({ config, db, pool });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down cleanly...`);
    await app.close();
    await pool.end();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    `VideoStudio Server listening on http://${config.host}:${config.port} (MCP: /mcp, WS: /ws)`,
  );
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
