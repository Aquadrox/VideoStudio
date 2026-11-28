import { desc, eq, inArray, sql } from 'drizzle-orm';
import {
  slugifyEffectName,
  validateFfmpegFilterTemplate,
  type Actor,
  type CreateVideoEffectInput,
  type EffectCreator,
  type UpdateVideoEffectInput,
  type VideoEffectCategory,
  type VideoEffectDto,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import { videoEffects } from '../db/schema.js';
import type { RealtimeHub } from './realtime.service.js';
import type { StudioService } from './studio.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class EffectsService {
  constructor(
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly realtime: RealtimeHub,
  ) {}

  private toDto(row: typeof videoEffects.$inferSelect): VideoEffectDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category as VideoEffectCategory,
      description: row.description,
      icon: row.icon,
      ffmpegFilterTemplate: row.ffmpegFilterTemplate,
      cssPreviewFilter: row.cssPreviewFilter,
      paramsSchema: row.paramsSchema ?? [],
      defaultParams: row.defaultParams ?? {},
      createdBy: row.createdBy as EffectCreator,
      isBuiltin: row.isBuiltin,
      tags: row.tags ?? [],
      usageCount: row.usageCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listEffects(filter?: {
    category?: string;
    query?: string;
    createdBy?: string;
  }): Promise<VideoEffectDto[]> {
    const rows = await this.db
      .select()
      .from(videoEffects)
      .orderBy(desc(videoEffects.usageCount), desc(videoEffects.updatedAt));

    let items = rows.map((r) => this.toDto(r));
    if (filter?.category && filter.category !== 'all') {
      items = items.filter((e) => e.category === filter.category);
    }
    if (filter?.createdBy && filter.createdBy !== 'all') {
      items = items.filter((e) => e.createdBy === filter.createdBy);
    }
    if (filter?.query?.trim()) {
      const q = filter.query.trim().toLowerCase();
      items = items.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.slug.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    return items;
  }

  async getEffectsCatalogMap(): Promise<Map<string, VideoEffectDto>> {
    const all = await this.listEffects();
    return new Map(all.map((fx) => [fx.slug, fx]));
  }

  async getEffectByIdOrSlug(idOrSlug: string): Promise<VideoEffectDto | null> {
    const row = UUID_REGEX.test(idOrSlug)
      ? (await this.db.select().from(videoEffects).where(eq(videoEffects.id, idOrSlug)).limit(1))[0]
      : (await this.db.select().from(videoEffects).where(eq(videoEffects.slug, idOrSlug)).limit(1))[0];
    return row ? this.toDto(row) : null;
  }

  async createEffect(
    input: CreateVideoEffectInput,
    createdBy: EffectCreator = 'user',
  ): Promise<VideoEffectDto> {
    const check = validateFfmpegFilterTemplate(input.ffmpegFilterTemplate);
    if (!check.valid) {
      throw new Error(check.reason ?? 'Filtre FFmpeg invalide');
    }

    const baseSlug = input.slug ? slugifyEffectName(input.slug) : slugifyEffectName(input.name);
    let slug = baseSlug;
    let suffix = 2;
    while (
      (await this.db.select({ id: videoEffects.id }).from(videoEffects).where(eq(videoEffects.slug, slug)).limit(1))
        .length > 0
    ) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const mergedDefaults: Record<string, number | boolean | string> = { ...input.defaultParams };
    for (const p of input.paramsSchema ?? []) {
      if (mergedDefaults[p.key] === undefined) {
        mergedDefaults[p.key] = p.default;
      }
    }

    const [created] = await this.db
      .insert(videoEffects)
      .values({
        slug,
        name: input.name,
        category: input.category,
        description: input.description,
        icon: input.icon || '✨',
        ffmpegFilterTemplate: input.ffmpegFilterTemplate.trim(),
        cssPreviewFilter: input.cssPreviewFilter.trim(),
        paramsSchema: input.paramsSchema ?? [],
        defaultParams: mergedDefaults,
        createdBy,
        isBuiltin: createdBy === 'system',
        tags: input.tags ?? [],
      })
      .returning();

    if (!created) throw new Error('Failed to create video effect');
    const dto = this.toDto(created);

    this.realtime.broadcast({
      type: 'effects.changed',
      payload: { effectId: dto.id, slug: dto.slug },
    });

    const actor: Actor = createdBy === 'claude' ? 'claude' : createdBy === 'system' ? 'system' : 'user';
    await this.studio.logActivity({
      projectId: null,
      projectSlug: null,
      actor,
      action: 'effect.created',
      summary: `Effet custom créé : ${dto.icon} ${dto.name} (${dto.slug})`,
      entityType: 'video_effect',
      entityId: dto.id,
      entityRef: dto.slug,
    });

    return dto;
  }

  async updateEffect(
    idOrSlug: string,
    input: UpdateVideoEffectInput,
    actor: Actor = 'user',
  ): Promise<VideoEffectDto | null> {
    const existing = await this.getEffectByIdOrSlug(idOrSlug);
    if (!existing) return null;

    if (input.ffmpegFilterTemplate !== undefined) {
      const check = validateFfmpegFilterTemplate(input.ffmpegFilterTemplate);
      if (!check.valid) {
        throw new Error(check.reason ?? 'Filtre FFmpeg invalide');
      }
    }

    const nextSchema = input.paramsSchema ?? existing.paramsSchema;
    const nextDefaults: Record<string, number | boolean | string> = {
      ...(input.defaultParams ?? existing.defaultParams),
    };
    for (const p of nextSchema) {
      if (nextDefaults[p.key] === undefined) {
        nextDefaults[p.key] = p.default;
      }
    }

    const [updated] = await this.db
      .update(videoEffects)
      .set({
        name: input.name ?? existing.name,
        category: input.category ?? existing.category,
        description: input.description ?? existing.description,
        icon: input.icon ?? existing.icon,
        ffmpegFilterTemplate:
          input.ffmpegFilterTemplate !== undefined
            ? input.ffmpegFilterTemplate.trim()
            : existing.ffmpegFilterTemplate,
        cssPreviewFilter:
          input.cssPreviewFilter !== undefined
            ? input.cssPreviewFilter.trim()
            : existing.cssPreviewFilter,
        paramsSchema: nextSchema,
        defaultParams: nextDefaults,
        tags: input.tags ?? existing.tags,
        updatedAt: new Date(),
      })
      .where(eq(videoEffects.id, existing.id))
      .returning();

    if (!updated) return null;
    const dto = this.toDto(updated);

    this.realtime.broadcast({
      type: 'effects.changed',
      payload: { effectId: dto.id, slug: dto.slug },
    });

    await this.studio.logActivity({
      projectId: null,
      projectSlug: null,
      actor,
      action: 'effect.updated',
      summary: `Effet mis à jour : ${dto.icon} ${dto.name} (${dto.slug})`,
      entityType: 'video_effect',
      entityId: dto.id,
      entityRef: dto.slug,
    });

    return dto;
  }

  async deleteEffect(idOrSlug: string, actor: Actor = 'user'): Promise<boolean> {
    const existing = await this.getEffectByIdOrSlug(idOrSlug);
    if (!existing) return false;
    if (existing.isBuiltin) {
      throw new Error(`Impossible de supprimer un effet intégré (${existing.slug}). Vous pouvez le dupliquer ou créer un effet custom.`);
    }

    await this.db.delete(videoEffects).where(eq(videoEffects.id, existing.id));

    this.realtime.broadcast({
      type: 'effects.changed',
      payload: { effectId: existing.id, slug: existing.slug },
    });

    await this.studio.logActivity({
      projectId: null,
      projectSlug: null,
      actor,
      action: 'effect.deleted',
      summary: `Effet custom supprimé : ${existing.name} (${existing.slug})`,
      entityType: 'video_effect',
      entityId: existing.id,
      entityRef: existing.slug,
    });

    return true;
  }

  async incrementUsage(slugs: string[]): Promise<void> {
    const unique = Array.from(new Set(slugs.filter(Boolean)));
    if (unique.length === 0) return;
    await this.db
      .update(videoEffects)
      .set({ usageCount: sql`${videoEffects.usageCount} + 1` })
      .where(inArray(videoEffects.slug, unique));
  }
}
