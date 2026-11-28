import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildProductionDossierHtml,
  buildProductionDossierMarkdown,
  ProductionDossierOptionsSchema,
  type Actor,
  type AssetDto,
  type ProductionDossierOptions,
} from '@videostudio/shared';
import type { MediaService } from './media.service.js';
import type { SketchService } from './sketch.service.js';
import type { Stage3Service } from './stage3.service.js';
import type { StudioService } from './studio.service.js';

export type DossierExportFormat = 'html' | 'markdown';

export class DossierService {
  constructor(
    private readonly studio: StudioService,
    private readonly stage3: Stage3Service,
    private readonly sketches: SketchService,
    private readonly media: MediaService,
  ) {}

  private async resolveAssetImageMap(
    assetIds: Set<string>,
    embedImages: boolean,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (assetIds.size === 0) return out;

    for (const id of assetIds) {
      if (!embedImages) {
        out[id] = `/api/assets/${id}/thumb`;
        continue;
      }

      try {
        const info = await this.studio.getAssetById(id);
        if (!info) continue;
        const candidatePath = info.raw.thumbnailPath ?? (info.asset.type === 'image' ? info.raw.filePath : null);
        if (!candidatePath) {
          out[id] = `/api/assets/${id}/thumb`;
          continue;
        }
        const abs = this.media.resolveMediaFile(candidatePath);
        const stat = await fs.stat(abs);
        // Cap inline image embedding at 2.5 MB per thumbnail to keep standalone HTML crisp & fast
        if (stat.size > 2.5 * 1024 * 1024) {
          out[id] = `/api/assets/${id}/thumb`;
          continue;
        }
        const buf = await fs.readFile(abs);
        const ext = path.extname(abs).toLowerCase();
        const mime =
          ext === '.webp'
            ? 'image/webp'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.svg'
                ? 'image/svg+xml'
                : 'image/png';
        out[id] = `data:${mime};base64,${buf.toString('base64')}`;
      } catch {
        out[id] = `/api/assets/${id}/thumb`;
      }
    }

    return out;
  }

  async generateDossier(
    projectIdOrSlug: string,
    format: DossierExportFormat,
    optionsInput?: Partial<ProductionDossierOptions>,
    embedImages = false,
  ): Promise<{ filename: string; mimeType: string; content: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const options = ProductionDossierOptionsSchema.parse(optionsInput ?? {});
    const [script, bible, scenes, sketchList] = await Promise.all([
      this.stage3.getProjectScript(project.id),
      this.stage3.listBibleEntities(project.id),
      this.stage3.getStoryboard(project.id),
      this.sketches.listSketches(project.id),
    ]);

    const referencedAssetIds = new Set<string>();
    for (const ent of bible) {
      if (ent.referenceAssetIds?.[0]) referencedAssetIds.add(ent.referenceAssetIds[0]);
    }
    for (const sk of sketchList) {
      if (sk.assetId) referencedAssetIds.add(sk.assetId);
    }
    for (const scene of scenes) {
      for (const shot of scene.shots) {
        if (shot.keyframeAssetId) referencedAssetIds.add(shot.keyframeAssetId);
      }
    }

    const assetImageMap =
      format === 'html'
        ? await this.resolveAssetImageMap(referencedAssetIds, embedImages)
        : undefined;

    const data = {
      project,
      script,
      bible,
      scenes,
      sketches: sketchList,
      assetImageMap,
      generatedAtIso: new Date().toISOString(),
    };

    const suffix = options.layout === 'pitch_deck' ? 'pitch-deck' : 'dossier-production';

    if (format === 'markdown') {
      return {
        filename: `${project.slug}-${suffix}.md`,
        mimeType: 'text/markdown; charset=utf-8',
        content: buildProductionDossierMarkdown(data, options),
      };
    }

    return {
      filename: `${project.slug}-${suffix}.html`,
      mimeType: 'text/html; charset=utf-8',
      content: buildProductionDossierHtml(data, options),
    };
  }

  async saveDossierAsAsset(
    projectIdOrSlug: string,
    format: DossierExportFormat,
    optionsInput?: Partial<ProductionDossierOptions>,
    actor: Actor = 'user',
  ): Promise<{ asset: AssetDto; filename: string } | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const options = ProductionDossierOptionsSchema.parse(optionsInput ?? {});
    // Embed images when saving HTML to media so it opens completely standalone
    const generated = await this.generateDossier(project.id, format, options, format === 'html');
    if (!generated) return null;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const ext = format === 'markdown' ? 'md' : 'html';
    const base = generated.filename.replace(/\.(md|html)$/i, '');
    const filename = `${base}-${stamp}.${ext}`;
    const label =
      options.layout === 'pitch_deck'
        ? `Pitch Deck (${ext.toUpperCase()})`
        : `Dossier de Production (${ext.toUpperCase()})`;

    const asset = await this.studio.ingestAssetFromBuffer({
      projectIdOrSlug: project.id,
      buffer: Buffer.from(generated.content, 'utf8'),
      filename,
      mimeType: format === 'markdown' ? 'text/markdown' : 'text/html',
      explicitType: 'document',
      folderPath: 'exports',
      title: `${label} — ${project.name}`,
      qualityTier: 'final_master',
      tags: ['dossier', options.layout, ext],
      notes: `Généré automatiquement par VideoStudio (${options.layout}).`,
      createdBy: actor,
    });

    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'dossier.exported',
      summary: `${label} enregistré dans /exports (${asset.handle})`,
      entityType: 'asset',
      entityId: asset.id,
      entityRef: asset.handle,
    });

    return { asset, filename };
  }
}
