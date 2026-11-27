import crypto from 'node:crypto';
import path from 'node:path';

/**
 * Constant-time verification of an Authorization: Bearer <token> header.
 */
export function verifyBearerToken(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (!authorizationHeader || !expectedToken) {
    return false;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const provided = match?.[1];
  if (!provided) {
    return false;
  }

  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Resolves a path strictly within `rootDir`, preventing path traversal attacks.
 */
export function resolveSafePath(rootDir: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (segment.includes('\0')) {
      throw new Error('Invalid path: null byte detected');
    }
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);

  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error('Path traversal attempt blocked');
  }

  return resolvedTarget;
}

/**
 * Sanitizes a filename so it is safe on Linux/macOS/Windows filesystems.
 */
export function sanitizeFilename(filename: string): string {
  const base = path.basename(filename).replace(/[\0<>:"/\\|?*]+/g, '_');
  const trimmed = base.replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 160);
  return trimmed.length > 0 ? trimmed : 'asset.bin';
}

const BLOCKED_METADATA_HOSTS = new Set([
  '169.254.169.254',
  '169.254.170.2',
  'metadata.google.internal',
  'metadata.goog',
  '100.100.100.200',
]);

/**
 * Validates a URL before server-side fetching (e.g. ComfyUI LAN output URL).
 * Blocks non-HTTP(S) schemes and cloud metadata endpoints, and enforces
 * ALLOWED_FETCH_HOSTS when configured.
 */
export function assertSafeFetchUrl(urlString: string, allowedHosts: string[] = []): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid sourceUrl');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const hostWithPort = parsed.host.toLowerCase();

  if (
    BLOCKED_METADATA_HOSTS.has(hostname) ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('fe80:')
  ) {
    throw new Error('Blocked unsafe link-local or metadata host');
  }

  if (allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some(
      (allowed) => allowed === hostname || allowed === hostWithPort,
    );
    if (!isAllowed) {
      throw new Error(`Host "${hostWithPort}" is not in ALLOWED_FETCH_HOSTS`);
    }
  }

  return parsed;
}
