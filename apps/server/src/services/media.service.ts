import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { AssetType, ComfyMetadata } from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import {
  assertSafeFetchUrl,
  resolveSafePath,
  sanitizeFilename,
} from '../utils/security.js';
import {
  extractComfyMetadataFromPng,
  extractComfyMetadataFromTags,
} from './comfy-metadata.service.js';

const execFileAsync = promisify(execFile);

export interface ProcessedMediaResult {
  type: AssetType;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  filePath: string; // relative to DATA_DIR
  proxyPath: string | null; // relative to DATA_DIR
  thumbnailPath: string | null; // relative to DATA_DIR
  width: number | null;
  height: number | null;
  durationSec: number | null;
  fps: number | null;
  comfyMetadata: ComfyMetadata | null;
}

interface FfprobeOutput {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
    duration?: string;
  }>;
  format?: {
    duration?: string;
    tags?: Record<string, string>;
  };
}

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.srt': 'text/plain',
  '.vtt': 'text/vtt',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

export function inferMimeType(filename: string, providedMime?: string): string {
  if (providedMime && providedMime !== 'application/octet-stream') {
    return providedMime;
  }
  const ext = path.extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] ?? providedMime ?? 'application/octet-stream';
}

export function inferAssetType(mimeType: string, filename: string): AssetType {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith('image/')) return 'image';
  if (lowerMime.startsWith('video/')) return 'video';
  if (lowerMime.startsWith('audio/')) return 'audio';

  const ext = path.extname(filename).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'].includes(ext)) return 'audio';
  return 'document';
}

function parseFrameRate(raw?: string): number | null {
  if (!raw || raw === '0/0') return null;
  if (raw.includes('/')) {
    const [numStr, denStr] = raw.split('/');
    const num = Number(numStr);
    const den = Number(denStr);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return Math.round((num / den) * 100) / 100;
    }
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export class MediaService {
  constructor(private readonly config: AppConfig) {}

  async ensureStorageRoot(): Promise<void> {
    await fs.mkdir(resolveSafePath(this.config.dataDir, 'projects'), { recursive: true });
  }

  async checkFfmpegAvailable(): Promise<boolean> {
    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  getAllowedIngestRoots(): string[] {
    return [this.config.ingestAllowedDir, ...this.config.ingestExtraDirs];
  }

  resolveMediaFile(relativePath: string): string {
    if (relativePath.startsWith('ingest://')) {
      const ingestRel = relativePath.slice('ingest://'.length);
      return resolveSafePath(this.config.ingestAllowedDir, ingestRel);
    }
    if (relativePath.startsWith('ingest-root://')) {
      const rest = relativePath.slice('ingest-root://'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx <= 0) {
        throw new Error('Invalid ingest-root URI');
      }
      const rootIdx = Number(rest.slice(0, slashIdx));
      const rel = rest.slice(slashIdx + 1);
      const roots = this.getAllowedIngestRoots();
      const rootDir = roots[rootIdx];
      if (!Number.isInteger(rootIdx) || !rootDir) {
        throw new Error(`Unknown ingest root index: ${rootIdx}`);
      }
      return resolveSafePath(rootDir, rel);
    }
    return resolveSafePath(this.config.dataDir, relativePath);
  }

  resolveAllowedIngestPath(targetPath: string): {
    absPath: string;
    rootIdx: number;
    relPath: string;
    referenceUri: string;
  } {
    const roots = this.getAllowedIngestRoots();
    if (path.isAbsolute(targetPath)) {
      const normalizedTarget = path.resolve(targetPath);
      for (let i = 0; i < roots.length; i += 1) {
        const root = roots[i]!;
        const rel = path.relative(root, normalizedTarget);
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
          const safeAbs = resolveSafePath(root, rel);
          return {
            absPath: safeAbs,
            rootIdx: i,
            relPath: rel,
            referenceUri: i === 0 ? `ingest://${rel}` : `ingest-root://${i}/${rel}`,
          };
        }
      }
      throw new Error(
        `Path is outside allowed ingest roots (configure INGEST_ALLOWED_DIR / INGEST_EXTRA_DIRS)`,
      );
    }

    const safeAbs = resolveSafePath(this.config.ingestAllowedDir, targetPath);
    const rel = path.relative(this.config.ingestAllowedDir, safeAbs);
    return {
      absPath: safeAbs,
      rootIdx: 0,
      relPath: rel,
      referenceUri: `ingest://${rel}`,
    };
  }

  async fetchFromUrl(
    sourceUrl: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const parsedUrl = assertSafeFetchUrl(sourceUrl, this.config.allowedFetchHosts);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch sourceUrl (HTTP ${response.status})`);
      }

      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const declaredSize = Number(contentLengthHeader);
        if (Number.isFinite(declaredSize) && declaredSize > this.config.maxUploadBytes) {
          throw new Error(`Remote file exceeds MAX_UPLOAD_MB limit`);
        }
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > this.config.maxUploadBytes) {
        throw new Error(`Remote file exceeds MAX_UPLOAD_MB limit`);
      }

      // ComfyUI `/view?filename=...` often puts the filename in query params
      const queryFilename = parsedUrl.searchParams.get('filename');
      const pathFilename = path.basename(parsedUrl.pathname);
      const rawFilename = queryFilename || pathFilename || 'comfy-output.png';
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim();

      return {
        buffer,
        filename: sanitizeFilename(rawFilename),
        mimeType: inferMimeType(rawFilename, contentType),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async readLocalIngestFile(localFilePath: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    resolvedAbsPath: string;
    ingestRelativePath: string;
    referenceUri: string;
  }> {
    let located = this.resolveAllowedIngestPath(localFilePath);

    // If relative path was not found in primary ingest dir, try extra roots
    if (!path.isAbsolute(localFilePath)) {
      try {
        await fs.access(located.absPath);
      } catch {
        const roots = this.getAllowedIngestRoots();
        for (let i = 1; i < roots.length; i += 1) {
          const candidate = resolveSafePath(roots[i]!, localFilePath);
          try {
            await fs.access(candidate);
            const rel = path.relative(roots[i]!, candidate);
            located = {
              absPath: candidate,
              rootIdx: i,
              relPath: rel,
              referenceUri: `ingest-root://${i}/${rel}`,
            };
            break;
          } catch {
            // Try next root
          }
        }
      }
    }

    const stat = await fs.stat(located.absPath);
    if (!stat.isFile()) {
      throw new Error('localFilePath is not a file');
    }
    if (stat.size > this.config.maxUploadBytes) {
      throw new Error('Local file exceeds MAX_UPLOAD_MB limit');
    }

    const buffer = await fs.readFile(located.absPath);
    const filename = sanitizeFilename(path.basename(located.absPath));
    return {
      buffer,
      filename,
      mimeType: inferMimeType(filename),
      resolvedAbsPath: located.absPath,
      ingestRelativePath: located.relPath,
      referenceUri: located.referenceUri,
    };
  }

  async scanIngestFolder(params: {
    localDir: string;
    glob?: string;
    recursive?: boolean;
    limit?: number;
  }): Promise<Array<{ absPath: string; relToDir: string; filename: string; referenceUri: string }>> {
    const locatedDir = this.resolveAllowedIngestPath(params.localDir);
    const stat = await fs.stat(locatedDir.absPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${params.localDir}`);
    }

    const globRegex = params.glob ? globToRegExp(params.glob) : null;
    const maxFiles = Math.max(1, Math.min(params.limit ?? 500, 1000));
    const results: Array<{ absPath: string; relToDir: string; filename: string; referenceUri: string }> = [];
    const rootDir = this.getAllowedIngestRoots()[locatedDir.rootIdx]!;

    const walk = async (dirAbs: string): Promise<void> => {
      if (results.length >= maxFiles) return;
      const entries = await fs.readdir(dirAbs, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (results.length >= maxFiles) break;
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dirAbs, entry.name);
        if (entry.isDirectory()) {
          if (params.recursive) {
            await walk(full);
          }
        } else if (entry.isFile()) {
          const relToDir = path.relative(locatedDir.absPath, full).replace(/\\/g, '/');
          if (globRegex && !globRegex.test(entry.name) && !globRegex.test(relToDir)) {
            continue;
          }
          const relToRoot = path.relative(rootDir, full).replace(/\\/g, '/');
          const referenceUri =
            locatedDir.rootIdx === 0
              ? `ingest://${relToRoot}`
              : `ingest-root://${locatedDir.rootIdx}/${relToRoot}`;
          results.push({
            absPath: full,
            relToDir,
            filename: entry.name,
            referenceUri,
          });
        }
      }
    };

    await walk(locatedDir.absPath);
    return results;
  }

  async storeAndProcessMedia(params: {
    projectSlug: string;
    buffer: Buffer;
    filename: string;
    mimeType?: string;
    explicitType?: AssetType;
    storageMode?: 'copy' | 'hardlink' | 'reference';
    sourceLocalAbsPath?: string;
    ingestRelativePath?: string;
    referenceUri?: string;
  }): Promise<ProcessedMediaResult> {
    const safeName = sanitizeFilename(params.filename);
    const mimeType = inferMimeType(safeName, params.mimeType);
    const type = params.explicitType ?? inferAssetType(mimeType, safeName);
    const uid = crypto.randomUUID();
    const storageMode = params.storageMode ?? 'copy';

    const originalsRelDir = path.join('projects', params.projectSlug, 'originals');
    const proxiesRelDir = path.join('projects', params.projectSlug, 'proxies');
    const thumbsRelDir = path.join('projects', params.projectSlug, 'thumbnails');

    await Promise.all([
      fs.mkdir(resolveSafePath(this.config.dataDir, originalsRelDir), { recursive: true }),
      fs.mkdir(resolveSafePath(this.config.dataDir, proxiesRelDir), { recursive: true }),
      fs.mkdir(resolveSafePath(this.config.dataDir, thumbsRelDir), { recursive: true }),
    ]);

    let originalRelPath: string;
    let originalAbsPath: string;

    if (
      storageMode === 'reference' &&
      (params.referenceUri || params.ingestRelativePath) &&
      params.sourceLocalAbsPath
    ) {
      // Zero-copy reference mode: stream original directly from read-only ingest mount
      originalRelPath = params.referenceUri ?? `ingest://${params.ingestRelativePath}`;
      originalAbsPath = params.sourceLocalAbsPath;
    } else {
      originalRelPath = path.join(originalsRelDir, `${uid}-${safeName}`);
      originalAbsPath = resolveSafePath(this.config.dataDir, originalRelPath);

      if (storageMode === 'hardlink' && params.sourceLocalAbsPath) {
        try {
          await fs.link(params.sourceLocalAbsPath, originalAbsPath);
        } catch {
          // Cross-device link (EXDEV) or read-only source: fall back safely to copy
          await fs.writeFile(originalAbsPath, params.buffer);
        }
      } else {
        await fs.writeFile(originalAbsPath, params.buffer);
      }
    }

    let proxyPath: string | null = null;
    let thumbnailPath: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let durationSec: number | null = null;
    let fps: number | null = null;
    let comfyMetadata: ComfyMetadata | null = null;

    if (type === 'image') {
      comfyMetadata = extractComfyMetadataFromPng(params.buffer);

      try {
        const meta = await sharp(params.buffer).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;

        const thumbRel = path.join(thumbsRelDir, `${uid}.webp`);
        await sharp(params.buffer)
          .rotate()
          .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(resolveSafePath(this.config.dataDir, thumbRel));
        thumbnailPath = thumbRel;

        const proxyRel = path.join(proxiesRelDir, `${uid}.webp`);
        await sharp(params.buffer)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 88 })
          .toFile(resolveSafePath(this.config.dataDir, proxyRel));
        proxyPath = proxyRel;
      } catch {
        // Non-raster or unsupported image format: keep original only
      }
    } else if (type === 'video') {
      const probe = await this.probeMedia(originalAbsPath);
      if (probe) {
        const videoStream = probe.streams?.find((s) => s.codec_type === 'video');
        width = videoStream?.width ?? null;
        height = videoStream?.height ?? null;
        fps = parseFrameRate(videoStream?.avg_frame_rate ?? videoStream?.r_frame_rate);
        const durStr = probe.format?.duration ?? videoStream?.duration;
        durationSec = durStr && Number.isFinite(Number(durStr)) ? Number(durStr) : null;
        comfyMetadata = extractComfyMetadataFromTags(probe.format?.tags);
      }

      // Generate video poster thumbnail
      const thumbRel = path.join(thumbsRelDir, `${uid}.jpg`);
      const thumbAbs = resolveSafePath(this.config.dataDir, thumbRel);
      const thumbOk = await this.runFfmpeg([
        '-y',
        '-i',
        originalAbsPath,
        '-ss',
        '00:00:00.25',
        '-vframes',
        '1',
        '-vf',
        'scale=480:-2',
        '-q:v',
        '4',
        thumbAbs,
      ]);
      if (thumbOk) {
        thumbnailPath = thumbRel;
      }

      // Generate lightweight H.264 720p web proxy for smooth LAN playback
      const proxyRel = path.join(proxiesRelDir, `${uid}.mp4`);
      const proxyAbs = resolveSafePath(this.config.dataDir, proxyRel);
      const proxyOk = await this.runFfmpeg([
        '-y',
        '-i',
        originalAbsPath,
        '-vf',
        'scale=\'min(1280,iw)\':-2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '24',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        proxyAbs,
      ]);
      if (proxyOk) {
        proxyPath = proxyRel;
      }
    } else if (type === 'audio') {
      const probe = await this.probeMedia(originalAbsPath);
      if (probe?.format?.duration && Number.isFinite(Number(probe.format.duration))) {
        durationSec = Number(probe.format.duration);
      }
    }

    return {
      type,
      originalFilename: safeName,
      mimeType,
      fileSize: params.buffer.length,
      filePath: originalRelPath,
      proxyPath,
      thumbnailPath,
      width,
      height,
      durationSec,
      fps,
      comfyMetadata,
    };
  }

  async deleteMediaFiles(paths: Array<string | null | undefined>): Promise<void> {
    await Promise.all(
      paths
        .filter(
          (p): p is string =>
            typeof p === 'string' &&
            p.length > 0 &&
            !p.startsWith('ingest://') &&
            !p.startsWith('ingest-root://'),
        )
        .map(async (relPath) => {
          try {
            const abs = resolveSafePath(this.config.dataDir, relPath);
            await fs.unlink(abs);
          } catch {
            // File already removed or missing
          }
        }),
    );
  }

  async extractVideoFrame(params: {
    absPath: string;
    assetType: AssetType;
    timecodeSec: number;
    maxWidth?: number;
  }): Promise<{ buffer: Buffer; mimeType: string; width: number | null; height: number | null }> {
    const maxWidth = Math.max(160, Math.min(params.maxWidth ?? 1280, 3840));

    if (params.assetType === 'image') {
      const pipeline = sharp(params.absPath)
        .rotate()
        .resize({ width: maxWidth, withoutEnlargement: true })
        .jpeg({ quality: 88 });
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
      return {
        buffer: data,
        mimeType: 'image/jpeg',
        width: info.width ?? null,
        height: info.height ?? null,
      };
    }

    const tmpDir = resolveSafePath(this.config.dataDir, '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `frame-${crypto.randomUUID()}.jpg`);

    try {
      const tc = Math.max(0, params.timecodeSec).toFixed(3);
      const ok = await this.runFfmpeg([
        '-y',
        '-ss',
        tc,
        '-i',
        params.absPath,
        '-vframes',
        '1',
        '-vf',
        `scale='min(${maxWidth},iw)':-2`,
        '-q:v',
        '2',
        outPath,
      ]);
      if (!ok) {
        throw new Error(`FFmpeg failed to extract frame at t=${tc}s`);
      }
      const buffer = await fs.readFile(outPath);
      const meta = await sharp(buffer).metadata().catch(() => null);
      return {
        buffer,
        mimeType: 'image/jpeg',
        width: meta?.width ?? null,
        height: meta?.height ?? null,
      };
    } finally {
      await fs.unlink(outPath).catch(() => undefined);
    }
  }

  async generateContactSheet(params: {
    absPath: string;
    assetType: AssetType;
    everySec?: number;
    columns?: number;
    tileWidth?: number;
    maxFrames?: number;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    width: number | null;
    height: number | null;
    everySec: number;
    columns: number;
    rows: number;
    frameCount: number;
    durationSec: number | null;
  }> {
    const everySec = Math.max(0.1, Math.min(params.everySec ?? 0.5, 60));
    const columns = Math.max(1, Math.min(params.columns ?? 4, 12));
    const tileWidth = Math.max(120, Math.min(params.tileWidth ?? 360, 960));
    const maxFrames = Math.max(1, Math.min(params.maxFrames ?? 36, 120));

    if (params.assetType === 'image') {
      const frame = await this.extractVideoFrame({
        absPath: params.absPath,
        assetType: 'image',
        timecodeSec: 0,
        maxWidth: tileWidth * 2,
      });
      return {
        ...frame,
        everySec: 0,
        columns: 1,
        rows: 1,
        frameCount: 1,
        durationSec: null,
      };
    }

    const probe = await this.probeMedia(params.absPath);
    const durRaw = probe?.format?.duration ?? probe?.streams?.find((s) => s.codec_type === 'video')?.duration;
    const durationSec = durRaw && Number.isFinite(Number(durRaw)) ? Number(durRaw) : null;
    const estimatedFrames = durationSec ? Math.max(1, Math.min(maxFrames, Math.ceil(durationSec / everySec))) : Math.min(maxFrames, 16);
    const rows = Math.max(1, Math.ceil(estimatedFrames / columns));

    const tmpDir = resolveSafePath(this.config.dataDir, '.tmp');
    await fs.mkdir(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, `sheet-${crypto.randomUUID()}.jpg`);

    try {
      const fpsExpr = `1/${everySec}`;
      const vf = `fps=${fpsExpr},scale=${tileWidth}:-2,tile=${columns}x${rows}:padding=4:margin=4:color=0x111317`;
      const ok = await this.runFfmpeg([
        '-y',
        '-i',
        params.absPath,
        '-vf',
        vf,
        '-frames:v',
        '1',
        '-q:v',
        '3',
        outPath,
      ]);
      if (!ok) {
        throw new Error('FFmpeg failed to generate contact sheet');
      }
      const buffer = await fs.readFile(outPath);
      const meta = await sharp(buffer).metadata().catch(() => null);
      return {
        buffer,
        mimeType: 'image/jpeg',
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        everySec,
        columns,
        rows,
        frameCount: estimatedFrames,
        durationSec,
      };
    } finally {
      await fs.unlink(outPath).catch(() => undefined);
    }
  }

  async executeFfmpeg(args: string[], timeoutMs = 600_000): Promise<void> {
    await execFileAsync('ffmpeg', args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
  }

  private async probeMedia(absPath: string): Promise<FfprobeOutput | null> {
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', absPath],
        { timeout: 15_000 },
      );
      return JSON.parse(stdout) as FfprobeOutput;
    } catch {
      return null;
    }
  }

  private async runFfmpeg(args: string[]): Promise<boolean> {
    try {
      await execFileAsync('ffmpeg', args, { timeout: 180_000 });
      return true;
    } catch {
      return false;
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/<<<DOUBLE_STAR>>>/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}
