import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

describe('Blue/Green zero-downtime deployment configuration', () => {
  it('defines persistent gateway, isolated postgres, and blue/green server+web slots in docker-compose.yml', async () => {
    const composeContent = await fs.readFile(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf8');

    expect(composeContent).toContain('gateway:');
    expect(composeContent).toContain('server-blue:');
    expect(composeContent).toContain('web-blue:');
    expect(composeContent).toContain('server-green:');
    expect(composeContent).toContain('web-green:');
    expect(composeContent).toContain('DEPLOY_SLOT: blue');
    expect(composeContent).toContain('DEPLOY_SLOT: green');
    expect(composeContent).toContain('postgres_data:/var/lib/postgresql/data');
    expect(composeContent).toContain('./data:/data');
    expect(composeContent).toContain('./skills:/skills');
    expect(composeContent).toContain('./backups:/backups');
    expect(composeContent).toContain('${INGEST_HOST_DIR:-./ingest}:/ingest:ro');

    // Security invariant: PostgreSQL port 5432 must NEVER be published on the host
    expect(composeContent).not.toMatch(/["']?\d+:5432["']?/);
  });

  it('configures dynamic Docker DNS resolver and atomic upstream include in docker/gateway.conf', async () => {
    const gatewayConf = await fs.readFile(path.join(REPO_ROOT, 'docker/gateway.conf'), 'utf8');

    expect(gatewayConf).toContain('resolver 127.0.0.11');
    expect(gatewayConf).toContain('include /etc/nginx/active-upstream/active-upstream.inc;');
    expect(gatewayConf).toContain('proxy_pass http://$active_server;');
    expect(gatewayConf).toContain('proxy_pass http://$active_web;');
    expect(gatewayConf).toContain('location /api/');
    expect(gatewayConf).toContain('location /ws');
    expect(gatewayConf).toContain('location /mcp');
  });

  it('passes strict shell syntax checks on update.sh, rollback.sh, init-env.sh, backup.sh, and gateway-entrypoint.sh', async () => {
    const bashScripts = [
      'scripts/update.sh',
      'scripts/rollback.sh',
      'scripts/init-env.sh',
      'scripts/backup.sh',
    ];
    for (const rel of bashScripts) {
      await expect(
        execFileAsync('bash', ['-n', path.join(REPO_ROOT, rel)]),
      ).resolves.toBeTruthy();
    }

    await expect(
      execFileAsync('sh', ['-n', path.join(REPO_ROOT, 'docker/gateway-entrypoint.sh')]),
    ).resolves.toBeTruthy();
  });
});
