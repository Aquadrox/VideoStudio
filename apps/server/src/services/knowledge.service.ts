import { desc, eq, inArray, sql } from 'drizzle-orm';
import {
  compileStudioPlaybookBrief,
  groupKnowledgeByKind,
  matchesKnowledgeProjectType,
  slugifyKnowledgeTitle,
  sortKnowledgeEntries,
  type Actor,
  type KnowledgeKind,
  type KnowledgePriority,
  type KnowledgeProjectType,
  type ProjectPlaybookDto,
  type RuleDto,
  type StudioKnowledgeEntryDto,
  type UpdateStudioKnowledgeInput,
  type UpsertStudioKnowledgeInput,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import { studioKnowledge } from '../db/schema.js';
import type { RealtimeHub } from './realtime.service.js';
import type { Stage2Service } from './stage2.service.js';
import type { StudioService } from './studio.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class KnowledgeService {
  constructor(
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly stage2: Stage2Service,
    private readonly realtime: RealtimeHub,
  ) {}

  private toDto(row: typeof studioKnowledge.$inferSelect): StudioKnowledgeEntryDto {
    const projectTypes =
      Array.isArray(row.projectTypes) && row.projectTypes.length > 0
        ? (row.projectTypes as KnowledgeProjectType[])
        : (['all'] as KnowledgeProjectType[]);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      kind: row.kind as KnowledgeKind,
      projectTypes,
      priority: row.priority as KnowledgePriority,
      content: row.content,
      positiveFragment: row.positiveFragment,
      negativeFragment: row.negativeFragment,
      recommendedModel: row.recommendedModel,
      linkedSkillSlug: row.linkedSkillSlug ?? null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      learnedBy: row.learnedBy as Actor,
      verified: row.verified,
      pinned: row.pinned,
      sourceProjectSlug: row.sourceProjectSlug ?? null,
      usageCount: row.usageCount,
      lastRecalledAt: row.lastRecalledAt ? row.lastRecalledAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listEntries(filter: {
    projectType?: KnowledgeProjectType;
    kind?: KnowledgeKind;
    search?: string;
    verifiedOnly?: boolean;
    tag?: string;
  } = {}): Promise<StudioKnowledgeEntryDto[]> {
    const rows = await this.db
      .select()
      .from(studioKnowledge)
      .orderBy(desc(studioKnowledge.updatedAt));

    let items = rows.map((r) => this.toDto(r));

    if (filter.projectType && filter.projectType !== 'all') {
      items = items.filter((e) => matchesKnowledgeProjectType(e.projectTypes, filter.projectType!));
    }
    if (filter.kind) {
      items = items.filter((e) => e.kind === filter.kind);
    }
    if (filter.verifiedOnly) {
      items = items.filter((e) => e.verified);
    }
    if (filter.tag?.trim()) {
      const needle = filter.tag.trim().toLowerCase();
      items = items.filter((e) => e.tags.some((t) => t.toLowerCase() === needle));
    }
    if (filter.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      items = items.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.slug.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          e.positiveFragment.toLowerCase().includes(q) ||
          e.recommendedModel.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return sortKnowledgeEntries(items);
  }

  async getByIdOrSlug(idOrSlug: string): Promise<StudioKnowledgeEntryDto | null> {
    const cond = UUID_REGEX.test(idOrSlug)
      ? eq(studioKnowledge.id, idOrSlug)
      : eq(studioKnowledge.slug, idOrSlug);
    const [row] = await this.db.select().from(studioKnowledge).where(cond).limit(1);
    return row ? this.toDto(row) : null;
  }

  /**
   * Idempotently creates or updates a shared Studio Knowledge entry (matched by `id` or `slug`).
   * Used by both the Web UI and Claude Code (`learn_studio_knowledge`) so learnings compound without duplicates.
   */
  async upsertEntry(
    input: UpsertStudioKnowledgeInput,
    actor: Actor = 'user',
  ): Promise<{ entry: StudioKnowledgeEntryDto; created: boolean }> {
    const normalizedSlug = input.slug?.trim() || slugifyKnowledgeTitle(input.title);
    const existing = input.id
      ? await this.getByIdOrSlug(input.id)
      : await this.getByIdOrSlug(normalizedSlug);

    const now = new Date();
    const projectTypes =
      input.projectTypes && input.projectTypes.length > 0 ? input.projectTypes : (['all'] as KnowledgeProjectType[]);

    if (existing) {
      const [updated] = await this.db
        .update(studioKnowledge)
        .set({
          title: input.title,
          kind: input.kind,
          projectTypes,
          priority: input.priority,
          content: input.content,
          positiveFragment: input.positiveFragment ?? '',
          negativeFragment: input.negativeFragment ?? '',
          recommendedModel: input.recommendedModel ?? '',
          linkedSkillSlug: input.linkedSkillSlug ?? null,
          tags: input.tags ?? [],
          verified: input.verified ?? existing.verified,
          pinned: input.pinned ?? existing.pinned,
          sourceProjectSlug:
            input.sourceProjectSlug !== undefined
              ? input.sourceProjectSlug
              : existing.sourceProjectSlug,
          updatedAt: now,
        })
        .where(eq(studioKnowledge.id, existing.id))
        .returning();

      const dto = this.toDto(updated!);
      this.realtime.broadcast({ type: 'knowledge.changed', payload: { entryId: dto.id } });
      return { entry: dto, created: false };
    }

    const [createdRow] = await this.db
      .insert(studioKnowledge)
      .values({
        slug: normalizedSlug,
        title: input.title,
        kind: input.kind,
        projectTypes,
        priority: input.priority,
        content: input.content,
        positiveFragment: input.positiveFragment ?? '',
        negativeFragment: input.negativeFragment ?? '',
        recommendedModel: input.recommendedModel ?? '',
        linkedSkillSlug: input.linkedSkillSlug ?? null,
        tags: input.tags ?? [],
        learnedBy: actor,
        verified: input.verified ?? actor === 'user',
        pinned: input.pinned ?? false,
        sourceProjectSlug: input.sourceProjectSlug ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const dto = this.toDto(createdRow!);
    this.realtime.broadcast({ type: 'knowledge.changed', payload: { entryId: dto.id } });
    return { entry: dto, created: true };
  }

  async updateEntry(
    idOrSlug: string,
    patch: UpdateStudioKnowledgeInput,
  ): Promise<StudioKnowledgeEntryDto | null> {
    const existing = await this.getByIdOrSlug(idOrSlug);
    if (!existing) return null;

    const [updated] = await this.db
      .update(studioKnowledge)
      .set({
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
        ...(patch.projectTypes !== undefined ? { projectTypes: patch.projectTypes } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.positiveFragment !== undefined ? { positiveFragment: patch.positiveFragment } : {}),
        ...(patch.negativeFragment !== undefined ? { negativeFragment: patch.negativeFragment } : {}),
        ...(patch.recommendedModel !== undefined ? { recommendedModel: patch.recommendedModel } : {}),
        ...(patch.linkedSkillSlug !== undefined ? { linkedSkillSlug: patch.linkedSkillSlug } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.verified !== undefined ? { verified: patch.verified } : {}),
        ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
        ...(patch.sourceProjectSlug !== undefined
          ? { sourceProjectSlug: patch.sourceProjectSlug }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(studioKnowledge.id, existing.id))
      .returning();

    if (!updated) return null;
    const dto = this.toDto(updated);
    this.realtime.broadcast({ type: 'knowledge.changed', payload: { entryId: dto.id } });
    return dto;
  }

  async deleteEntry(idOrSlug: string): Promise<boolean> {
    const existing = await this.getByIdOrSlug(idOrSlug);
    if (!existing) return false;
    await this.db.delete(studioKnowledge).where(eq(studioKnowledge.id, existing.id));
    this.realtime.broadcast({ type: 'knowledge.changed', payload: { entryId: existing.id } });
    return true;
  }

  /**
   * Builds a complete, project-type-aware Studio Playbook combining:
   * - Shared learned knowledge entries (`all` + `projectType`)
   * - Global rulebooks
   * - Reusable prompt templates & ComfyUI workflows
   * - Global + project-scoped Claude Code skills
   * Optionally increments `usageCount` and `lastRecalledAt` when invoked by Claude Code via MCP.
   */
  async recallPlaybook(params: {
    projectIdOrSlug?: string;
    projectType?: KnowledgeProjectType;
    incrementUsage?: boolean;
  }): Promise<ProjectPlaybookDto | null> {
    let resolvedType: KnowledgeProjectType = params.projectType ?? 'all';
    let projectId: string | undefined;
    let projectSlug: string | null = null;

    if (params.projectIdOrSlug) {
      const project = await this.studio.getProjectByIdOrSlug(params.projectIdOrSlug);
      if (!project) return null;
      projectId = project.id;
      projectSlug = project.slug;
      resolvedType = params.projectType ?? project.type;
    }

    const [entries, rulebooks, promptTemplates, comfyWorkflows, skills] = await Promise.all([
      this.listEntries({ projectType: resolvedType }),
      this.stage2.listRulebooks(),
      this.stage2.listPromptTemplates(),
      this.stage2.listComfyWorkflows(),
      this.stage2.listSkills(projectId),
    ]);

    const nowIso = new Date().toISOString();

    if (params.incrementUsage && entries.length > 0) {
      const ids = entries.map((e) => e.id);
      await this.db
        .update(studioKnowledge)
        .set({
          usageCount: sql`${studioKnowledge.usageCount} + 1`,
          lastRecalledAt: new Date(),
        })
        .where(inArray(studioKnowledge.id, ids));

      for (const e of entries) {
        e.usageCount += 1;
        e.lastRecalledAt = nowIso;
      }
    }

    const sorted = sortKnowledgeEntries(entries);
    const compiledBrief = compileStudioPlaybookBrief({
      projectType: resolvedType,
      projectSlug,
      entries: sorted,
      rulebookCount: rulebooks.length,
      promptTemplateCount: promptTemplates.length,
      workflowCount: comfyWorkflows.length,
      skillSlugs: skills.map((s) => s.slug),
    });

    return {
      projectType: resolvedType,
      projectSlug,
      recalledAt: nowIso,
      totalEntries: sorted.length,
      entries: sorted,
      byKind: groupKnowledgeByKind(sorted),
      rulebooks,
      promptTemplates,
      comfyWorkflows,
      skills,
      compiledBrief,
    };
  }

  /**
   * Applies a shared Studio Knowledge entry into a specific project's custom rules so it
   * participates in `get_active_rules` & `render_prompt_with_rules` immediately.
   */
  async applyEntryToProject(
    entryIdOrSlug: string,
    projectIdOrSlug: string,
    actor: Actor = 'user',
  ): Promise<{ rule: RuleDto; entry: StudioKnowledgeEntryDto } | null> {
    const entry = await this.getByIdOrSlug(entryIdOrSlug);
    if (!entry) return null;

    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const code = `mem-${entry.slug}`.slice(0, 60);
    const severity =
      entry.priority === 'critical'
        ? 'mandatory'
        : entry.priority === 'high'
          ? 'mandatory'
          : 'recommended';

    const rule = await this.stage2.addProjectCustomRule(
      project.id,
      {
        code,
        title: entry.title.slice(0, 160),
        category: entry.kind === 'prompt' ? 'prompt_positive' : 'style',
        severity,
        defaultValue: entry.recommendedModel || entry.kind,
        instruction: entry.content.slice(0, 4000),
        positiveFragment: entry.positiveFragment.slice(0, 2000),
        negativeFragment: entry.negativeFragment.slice(0, 2000),
        autoInject: Boolean(entry.positiveFragment || entry.negativeFragment),
        appliesToTags: entry.tags,
        enabled: true,
        sortOrder: 0,
      },
      actor,
    );

    if (!rule) return null;

    await this.db
      .update(studioKnowledge)
      .set({
        usageCount: sql`${studioKnowledge.usageCount} + 1`,
        lastRecalledAt: new Date(),
      })
      .where(eq(studioKnowledge.id, entry.id));

    return { rule, entry: { ...entry, usageCount: entry.usageCount + 1 } };
  }
}
