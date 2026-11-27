import { describe, expect, it } from 'vitest';
import {
  assertSafeFetchUrl,
  resolveSafePath,
  sanitizeFilename,
  verifyBearerToken,
} from './security.js';

describe('security utilities', () => {
  it('verifies bearer tokens in constant time', () => {
    expect(verifyBearerToken('Bearer super-secret-token', 'super-secret-token')).toBe(true);
    expect(verifyBearerToken('bearer super-secret-token', 'super-secret-token')).toBe(true);
    expect(verifyBearerToken('Bearer wrong-token', 'super-secret-token')).toBe(false);
    expect(verifyBearerToken('Basic abc', 'super-secret-token')).toBe(false);
    expect(verifyBearerToken(undefined, 'super-secret-token')).toBe(false);
  });

  it('blocks path traversal outside rootDir', () => {
    expect(resolveSafePath('/data/studio', 'projects', 'demo', 'img.png')).toBe(
      '/data/studio/projects/demo/img.png',
    );
    expect(() => resolveSafePath('/data/studio', '../../etc/passwd')).toThrow(
      /Path traversal/,
    );
    expect(() => resolveSafePath('/data/studio', 'foo\0bar.png')).toThrow(/null byte/);
  });

  it('sanitizes filenames cleanly', () => {
    expect(sanitizeFilename('../../my shot (final)?.png')).toBe('my_shot_(final)_.png');
    expect(sanitizeFilename('...')).toBe('asset.bin');
  });

  it('allows LAN ComfyUI URLs while blocking metadata SSRF targets and honoring allowlist', () => {
    const lanUrl = assertSafeFetchUrl('http://192.168.1.50:8188/view?filename=out.png');
    expect(lanUrl.hostname).toBe('192.168.1.50');

    expect(() => assertSafeFetchUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      /Blocked/,
    );
    expect(() => assertSafeFetchUrl('file:///etc/passwd')).toThrow(/Unsupported URL protocol/);

    expect(
      assertSafeFetchUrl('http://192.168.1.50:8188/view?filename=out.png', ['192.168.1.50:8188'])
        .host,
    ).toBe('192.168.1.50:8188');

    expect(() =>
      assertSafeFetchUrl('http://192.168.1.99:8188/view?filename=out.png', ['192.168.1.50:8188']),
    ).toThrow(/ALLOWED_FETCH_HOSTS/);
  });
});
