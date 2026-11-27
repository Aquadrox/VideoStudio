import fs from 'node:fs/promises';
import {
  formatYoutubeChapters,
  type UploadYouTubeDraftInput,
  type YouTubeUploadResultDto,
  type YouTubeUploadStatusDto,
} from '@videostudio/shared';
import type { AppConfig } from '../config.js';
import type { MediaService } from './media.service.js';
import type { Stage3Service } from './stage3.service.js';
import type { StudioService } from './studio.service.js';

export class YouTubeUploadService {
  constructor(
    private readonly config: AppConfig,
    private readonly studio: StudioService,
    private readonly stage3: Stage3Service,
    private readonly media: MediaService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getStatus(): YouTubeUploadStatusDto {
    const missingEnvVars: string[] = [];
    if (!this.config.youtubeOAuth?.clientId) missingEnvVars.push('YOUTUBE_CLIENT_ID');
    if (!this.config.youtubeOAuth?.clientSecret) missingEnvVars.push('YOUTUBE_CLIENT_SECRET');
    if (!this.config.youtubeOAuth?.refreshToken) missingEnvVars.push('YOUTUBE_REFRESH_TOKEN');

    return {
      configured: missingEnvVars.length === 0,
      missingEnvVars,
    };
  }

  async uploadDraftVideo(
    projectIdOrSlug: string,
    input: UploadYouTubeDraftInput,
  ): Promise<YouTubeUploadResultDto> {
    const status = this.getStatus();
    if (!status.configured || !this.config.youtubeOAuth) {
      throw new Error(
        `YouTube Data API v3 is not configured. Missing env vars: ${status.missingEnvVars.join(', ')}`,
      );
    }

    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) {
      throw new Error(`Project not found: ${projectIdOrSlug}`);
    }

    const pkg = await this.stage3.getYouTubePackage(project.id);

    // Resolve target video asset
    let videoAssetRecord: Awaited<ReturnType<StudioService['getAssetById']>> = null;
    if (input.videoAssetId) {
      videoAssetRecord = await this.studio.getAssetById(input.videoAssetId);
    } else if (input.videoAssetRef) {
      const resolved = await this.studio.resolveReference(project.id, input.videoAssetRef);
      if (resolved?.asset) {
        videoAssetRecord = await this.studio.getAssetById(resolved.asset.id);
      }
    } else {
      const videos = await this.studio.listAssets(project.id, { type: 'video' });
      const preferred =
        videos.find((v) => v.qualityTier === 'final_master' || v.status === 'winner') ??
        videos.find((v) => v.status === 'approved') ??
        videos[0];
      if (preferred) {
        videoAssetRecord = await this.studio.getAssetById(preferred.id);
      }
    }

    if (!videoAssetRecord || videoAssetRecord.asset.type !== 'video') {
      throw new Error('No video asset found to upload to YouTube');
    }

    const videoAbsPath = this.media.resolveMediaFile(videoAssetRecord.raw.filePath);
    const videoBuffer = await fs.readFile(videoAbsPath);
    const videoMime = videoAssetRecord.asset.mimeType || 'video/mp4';

    // Assemble metadata from YouTube package
    const title =
      (pkg?.titles[input.titleIndex] ?? pkg?.titles[0] ?? project.name).trim().slice(0, 100) ||
      project.name;

    const descriptionParts: string[] = [];
    if (pkg?.description?.trim()) {
      descriptionParts.push(pkg.description.trim());
    }
    if (pkg && pkg.chapters.length > 0) {
      const chaptersText = formatYoutubeChapters(pkg.chapters).text;
      if (chaptersText && !descriptionParts.join('\n').includes(chaptersText)) {
        descriptionParts.push(chaptersText);
      }
    }
    if (pkg && pkg.hashtags.length > 0) {
      const hashes = pkg.hashtags
        .map((h) => (h.startsWith('#') ? h : `#${h}`))
        .join(' ');
      if (hashes && !descriptionParts.join('\n').includes(hashes)) {
        descriptionParts.push(hashes);
      }
    }
    const description = descriptionParts.join('\n\n').slice(0, 5000);
    const tags = (pkg?.tags ?? []).slice(0, 30);

    // 1. Exchange OAuth2 refresh token for access token
    const accessToken = await this.fetchAccessToken(this.config.youtubeOAuth);

    // 2. Initiate YouTube Data API v3 resumable upload session
    const initResponse = await this.fetchImpl(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(videoBuffer.byteLength),
          'X-Upload-Content-Type': videoMime,
        },
        body: JSON.stringify({
          snippet: {
            title,
            description,
            tags,
            defaultLanguage: pkg?.language || 'fr',
          },
          status: {
            privacyStatus: input.privacyStatus,
            selfDeclaredMadeForKids: false,
            containsSyntheticMedia: pkg?.aiDisclosure ?? true,
          },
        }),
      },
    );

    if (!initResponse.ok) {
      const errBody = await initResponse.text().catch(() => '');
      throw new Error(
        `YouTube upload init failed (HTTP ${initResponse.status}): ${errBody.slice(0, 240)}`,
      );
    }

    const uploadUrl = initResponse.headers.get('location');
    if (!uploadUrl) {
      throw new Error('YouTube API did not return a resumable upload Location header');
    }

    // 3. Upload video binary payload
    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': videoMime,
        'Content-Length': String(videoBuffer.byteLength),
      },
      body: new Uint8Array(videoBuffer),
    });

    if (!uploadResponse.ok) {
      const errBody = await uploadResponse.text().catch(() => '');
      throw new Error(
        `YouTube video upload failed (HTTP ${uploadResponse.status}): ${errBody.slice(0, 240)}`,
      );
    }

    const uploadedJson = (await uploadResponse.json()) as { id?: string };
    const videoId = uploadedJson.id;
    if (!videoId) {
      throw new Error('YouTube API upload succeeded but returned no video ID');
    }

    // 4. Optional A/B thumbnail upload
    let thumbnailUploaded = false;
    if (input.thumbnailIndex !== null && pkg && pkg.thumbnailAssetIds[input.thumbnailIndex]) {
      const thumbAssetId = pkg.thumbnailAssetIds[input.thumbnailIndex]!;
      const thumbRecord = await this.studio.getAssetById(thumbAssetId);
      if (thumbRecord && thumbRecord.asset.type === 'image') {
        try {
          const thumbAbs = this.media.resolveMediaFile(thumbRecord.raw.filePath);
          const thumbBuf = await fs.readFile(thumbAbs);
          const thumbResp = await this.fetchImpl(
            `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': thumbRecord.asset.mimeType || 'image/jpeg',
                'Content-Length': String(thumbBuf.byteLength),
              },
              body: new Uint8Array(thumbBuf),
            },
          );
          thumbnailUploaded = thumbResp.ok;
        } catch {
          thumbnailUploaded = false;
        }
      }
    }

    const result: YouTubeUploadResultDto = {
      videoId,
      studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
      watchUrl: `https://youtu.be/${videoId}`,
      title,
      privacyStatus: input.privacyStatus,
      thumbnailUploaded,
      uploadedAt: new Date().toISOString(),
    };

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor: 'user',
      action: 'youtube.draft_uploaded',
      summary: `Brouillon YouTube (${input.privacyStatus}) envoyé : ${title}`,
      entityType: 'asset',
      entityId: videoAssetRecord.asset.id,
      entityRef: videoAssetRecord.asset.handle,
      metadata: {
        videoId,
        studioUrl: result.studioUrl,
        thumbnailUploaded,
      },
    });

    return result;
  }

  private async fetchAccessToken(oauth: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<string> {
    const body = new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
      refresh_token: oauth.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await this.fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(
        `YouTube OAuth2 token refresh failed (HTTP ${response.status}): ${errText.slice(0, 200)}`,
      );
    }

    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error('YouTube OAuth2 token endpoint did not return access_token');
    }
    return json.access_token;
  }
}
