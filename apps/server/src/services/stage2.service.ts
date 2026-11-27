import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  buildAssetHandle,
  extractTemplateVariables,
  renderPromptTemplate,
  resolveProjectRules,
  selectInjectableRuleFragments,
  slugifyProjectName,
  type Actor,
  type AnnotationDto,
  type AnnotationShapeType,
  type AnnotationStatus,
  type ComfyWorkflowCategory,
  type ComfyWorkflowDto,
  type CreateAnnotationInput,
  type CreateComfyWorkflowInput,
  type CreatePromptTemplateInput,
  type CreateRulebookInput,
  type CreateRuleInput,
  type ProjectRuleOverrideDto,
  type ProjectRulesBundle,
  type PromptCategory,
  type PromptTemplateDto,
  type RenderedPromptResult,
  type RulebookDto,
  type RuleCategory,
  type RuleDto,
  type RuleSeverity,
  type SkillDto,
  type SkillScope,
  type SkillVersionDto,
  type UpdateAnnotationInput,
  type UpdateComfyWorkflowInput,
  type UpdatePromptTemplateInput,
  type UpdateRuleInput,
  type UpsertProjectRuleOverrideInput,
  type UpsertSkillInput,
} from '@videostudio/shared';
import type { Database } from '../db/index.js';
import {
  annotations,
  assets,
  comfyWorkflows,
  projectRulebookLinks,
  projectRuleOverrides,
  projects,
  promptTemplates,
  rulebooks,
  rules,
  scenes,
  shots,
  skills,
  skillVersions,
} from '../db/schema.js';
import type { RealtimeHub } from './realtime.service.js';
import type { SkillsSyncService } from './skills-sync.service.js';
import type { StudioService } from './studio.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Stage2Service {
  constructor(
    private readonly db: Database,
    private readonly studio: StudioService,
    private readonly realtime: RealtimeHub,
    private readonly skillsSync: SkillsSyncService,
  ) {}

  // ==========================================================================
  // 1. Visual Annotations & Feedback Inbox
  // ==========================================================================

  async listAssetAnnotations(assetId: string): Promise<AnnotationDto[]> {
    if (!UUID_REGEX.test(assetId)) return [];
    const rows = await this.db
      .select({
        annotation: annotations,
        assetRef: assets.refCode,
        assetTitle: assets.title,
      })
      .from(annotations)
      .innerJoin(assets, eq(assets.id, annotations.assetId))
      .where(eq(annotations.assetId, assetId))
      .orderBy(asc(annotations.createdAt));

    return rows.map((r) => this.toAnnotationDto(r.annotation, r.assetRef, r.assetTitle));
  }

  async listProjectFeedback(
    projectIdOrSlug: string,
    status: AnnotationStatus | 'all' = 'open',
    since?: string,
  ): Promise<AnnotationDto[]> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return [];

    const conditions = [eq(annotations.projectId, project.id)];
    if (status !== 'all') {
      conditions.push(eq(annotations.status, status));
    }
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        conditions.push(gt(annotations.createdAt, sinceDate));
      }
    }

    const rows = await this.db
      .select({
        annotation: annotations,
        assetRef: assets.refCode,
        assetTitle: assets.title,
      })
      .from(annotations)
      .innerJoin(assets, eq(assets.id, annotations.assetId))
      .where(and(...conditions))
      .orderBy(desc(annotations.createdAt));

    return rows.map((r) => this.toAnnotationDto(r.annotation, r.assetRef, r.assetTitle));
  }

  async createAnnotation(
    assetId: string,
    input: CreateAnnotationInput,
  ): Promise<AnnotationDto | null> {
    const found = await this.studio.getAssetById(assetId);
    if (!found) return null;

    // Auto-link annotation to matching Storyboard shot via timecodeSec (or linked asset)
    let linkedShotId: string | null = null;
    let linkedShotCode: string | null = null;
    if (typeof input.timecodeSec === 'number' && Number.isFinite(input.timecodeSec)) {
      const matched = await this.findShotAtTimecode(found.asset.projectId, input.timecodeSec);
      if (matched) {
        linkedShotId = matched.id;
        linkedShotCode = matched.shotCode;
      }
    }
    if (!linkedShotId) {
      try {
        const directShots = await this.db
          .select({
            id: shots.id,
            shotCode: shots.shotCode,
            keyframeAssetId: shots.keyframeAssetId,
            videoAssetId: shots.videoAssetId,
          })
          .from(shots)
          .where(eq(shots.projectId, found.asset.projectId));
        const direct = directShots.find(
          (s) => s.keyframeAssetId === found.asset.id || s.videoAssetId === found.asset.id,
        );
        if (direct) {
          linkedShotId = direct.id;
          linkedShotCode = direct.shotCode;
        }
      } catch {
        // Ignore if shots table absent
      }
    }

    const [created] = await this.db
      .insert(annotations)
      .values({
        assetId: found.asset.id,
        projectId: found.asset.projectId,
        author: input.author,
        frameNumber: input.frameNumber ?? null,
        timecodeSec: input.timecodeSec ?? null,
        shotId: linkedShotId,
        shotCode: linkedShotCode,
        shapeType: input.shapeType,
        x: input.x,
        y: input.y,
        w: input.w ?? null,
        h: input.h ?? null,
        color: input.color,
        comment: input.comment,
        status: 'open',
      })
      .returning();

    if (!created) return null;

    const dto = this.toAnnotationDto(created, found.asset.refCode, found.asset.title);
    this.realtime.broadcast({
      type: 'annotation.changed',
      payload: { assetId: found.asset.id, projectId: found.asset.projectId },
    });

    await this.studio.logActivity({
      projectId: found.asset.projectId,
      projectSlug: found.asset.projectSlug,
      actor: input.author,
      action: 'annotation.created',
      summary: `Annotation sur ${found.asset.handle}${linkedShotCode ? ` (plan @${linkedShotCode})` : ''} : ${input.comment.slice(0, 120)}`,
      entityType: 'asset',
      entityId: found.asset.id,
      entityRef: found.asset.handle,
    });

    return dto;
  }

  private async findShotAtTimecode(
    projectId: string,
    timecodeSec: number,
  ): Promise<{ id: string; shotCode: string } | null> {
    try {
      const [sceneRows, shotRows] = await Promise.all([
        this.db
          .select({ id: scenes.id, sortOrder: scenes.sortOrder, sceneNumber: scenes.sceneNumber })
          .from(scenes)
          .where(eq(scenes.projectId, projectId))
          .orderBy(asc(scenes.sortOrder), asc(scenes.sceneNumber)),
        this.db
          .select({
            id: shots.id,
            sceneId: shots.sceneId,
            shotCode: shots.shotCode,
            startSec: shots.startSec,
            durationSec: shots.durationSec,
            sortOrder: shots.sortOrder,
          })
          .from(shots)
          .where(eq(shots.projectId, projectId))
          .orderBy(asc(shots.sortOrder), asc(shots.shotCode)),
      ]);

      const sceneOrder = new Map<string, number>();
      sceneRows.forEach((sc, idx) => sceneOrder.set(sc.id, idx));

      const ordered = [...shotRows].sort((a, b) => {
        const sa = sceneOrder.get(a.sceneId) ?? 0;
        const sb = sceneOrder.get(b.sceneId) ?? 0;
        if (sa !== sb) return sa - sb;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.shotCode.localeCompare(b.shotCode);
      });

      let cursor = 0;
      for (const sh of ordered) {
        const start = sh.startSec ?? cursor;
        const end = start + Math.max(0.05, sh.durationSec);
        if (timecodeSec >= start && timecodeSec < end) {
          return { id: sh.id, shotCode: sh.shotCode };
        }
        cursor = end;
      }
      return null;
    } catch {
      return null;
    }
  }

  async updateAnnotation(
    annotationId: string,
    input: UpdateAnnotationInput,
    actor: Actor = 'user',
  ): Promise<AnnotationDto | null> {
    if (!UUID_REGEX.test(annotationId)) return null;

    const patch: Record<string, unknown> = {};
    if (input.comment !== undefined) patch.comment = input.comment;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'resolved') {
        patch.resolvedBy = input.resolvedBy ?? actor;
        patch.resolvedAt = new Date();
      } else {
        patch.resolvedBy = null;
        patch.resolvedAt = null;
      }
    }

    const [updated] = await this.db
      .update(annotations)
      .set(patch)
      .where(eq(annotations.id, annotationId))
      .returning();

    if (!updated) return null;

    const foundAsset = await this.studio.getAssetById(updated.assetId);
    const dto = this.toAnnotationDto(
      updated,
      foundAsset?.asset.refCode ?? 'asset',
      foundAsset?.asset.title ?? 'Asset',
    );

    this.realtime.broadcast({
      type: 'annotation.changed',
      payload: { assetId: updated.assetId, projectId: updated.projectId },
    });

    if (input.status === 'resolved' && foundAsset) {
      await this.studio.logActivity({
        projectId: updated.projectId,
        projectSlug: foundAsset.asset.projectSlug,
        actor,
        action: 'annotation.resolved',
        summary: `Feedback résolu sur ${foundAsset.asset.handle}`,
        entityType: 'asset',
        entityId: foundAsset.asset.id,
        entityRef: foundAsset.asset.handle,
      });
    }

    return dto;
  }

  async deleteAnnotation(annotationId: string): Promise<boolean> {
    if (!UUID_REGEX.test(annotationId)) return false;
    const [deleted] = await this.db
      .delete(annotations)
      .where(eq(annotations.id, annotationId))
      .returning();

    if (!deleted) return false;

    this.realtime.broadcast({
      type: 'annotation.changed',
      payload: { assetId: deleted.assetId, projectId: deleted.projectId },
    });
    return true;
  }

  // ==========================================================================
  // 2. Rulebooks, Rules & Per-Project Overrides
  // ==========================================================================

  async listRulebooks(): Promise<RulebookDto[]> {
    const books = await this.db
      .select()
      .from(rulebooks)
      .orderBy(desc(rulebooks.isDefault), asc(rulebooks.name));

    const allRules = await this.db
      .select()
      .from(rules)
      .where(isNull(rules.projectId))
      .orderBy(asc(rules.sortOrder), asc(rules.code));

    const rulesByBook = new Map<string, RuleDto[]>();
    for (const r of allRules) {
      if (!r.rulebookId) continue;
      const list = rulesByBook.get(r.rulebookId) ?? [];
      list.push(this.toRuleDto(r));
      rulesByBook.set(r.rulebookId, list);
    }

    return books.map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      description: b.description,
      isDefault: b.isDefault,
      rules: rulesByBook.get(b.id) ?? [],
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));
  }

  async createRulebook(input: CreateRulebookInput): Promise<RulebookDto> {
    const baseSlug = input.slug ? input.slug.toLowerCase() : slugifyProjectName(input.name);
    const slug = await this.ensureUniqueRulebookSlug(baseSlug);

    const [created] = await this.db
      .insert(rulebooks)
      .values({
        slug,
        name: input.name,
        description: input.description,
        isDefault: input.isDefault,
      })
      .returning();

    if (!created) throw new Error('Failed to create rulebook');

    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: null } });

    return {
      id: created.id,
      slug: created.slug,
      name: created.name,
      description: created.description,
      isDefault: created.isDefault,
      rules: [],
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async deleteRulebook(rulebookId: string): Promise<boolean> {
    if (!UUID_REGEX.test(rulebookId)) return false;
    const [deleted] = await this.db
      .delete(rulebooks)
      .where(eq(rulebooks.id, rulebookId))
      .returning();
    if (!deleted) return false;
    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: null } });
    return true;
  }

  async addRuleToRulebook(rulebookId: string, input: CreateRuleInput): Promise<RuleDto | null> {
    if (!UUID_REGEX.test(rulebookId)) return null;
    const [created] = await this.db
      .insert(rules)
      .values({
        rulebookId,
        projectId: null,
        code: input.code,
        title: input.title,
        category: input.category,
        severity: input.severity,
        defaultValue: input.defaultValue,
        instruction: input.instruction,
        positiveFragment: input.positiveFragment,
        negativeFragment: input.negativeFragment,
        autoInject: input.autoInject,
        appliesToTags: input.appliesToTags,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
      })
      .returning();

    if (!created) return null;
    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: null } });
    return this.toRuleDto(created);
  }

  async updateRule(ruleId: string, input: UpdateRuleInput): Promise<RuleDto | null> {
    if (!UUID_REGEX.test(ruleId)) return null;
    const [updated] = await this.db
      .update(rules)
      .set({
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        ...(input.defaultValue !== undefined ? { defaultValue: input.defaultValue } : {}),
        ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
        ...(input.positiveFragment !== undefined
          ? { positiveFragment: input.positiveFragment }
          : {}),
        ...(input.negativeFragment !== undefined
          ? { negativeFragment: input.negativeFragment }
          : {}),
        ...(input.autoInject !== undefined ? { autoInject: input.autoInject } : {}),
        ...(input.appliesToTags !== undefined ? { appliesToTags: input.appliesToTags } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(rules.id, ruleId))
      .returning();

    if (!updated) return null;
    this.realtime.broadcast({
      type: 'rules.changed',
      payload: { projectId: updated.projectId },
    });
    return this.toRuleDto(updated);
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    if (!UUID_REGEX.test(ruleId)) return false;
    const [deleted] = await this.db.delete(rules).where(eq(rules.id, ruleId)).returning();
    if (!deleted) return false;
    this.realtime.broadcast({
      type: 'rules.changed',
      payload: { projectId: deleted.projectId },
    });
    return true;
  }

  async attachDefaultRulebooksToProject(projectId: string): Promise<void> {
    const defaults = await this.db
      .select({ id: rulebooks.id })
      .from(rulebooks)
      .where(eq(rulebooks.isDefault, true));

    for (const book of defaults) {
      await this.db
        .insert(projectRulebookLinks)
        .values({ projectId, rulebookId: book.id })
        .onConflictDoNothing();
    }
  }

  async setProjectRulebooks(
    projectIdOrSlug: string,
    rulebookIds: string[],
  ): Promise<ProjectRulesBundle | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    await this.db
      .delete(projectRulebookLinks)
      .where(eq(projectRulebookLinks.projectId, project.id));

    for (const rbId of rulebookIds) {
      if (!UUID_REGEX.test(rbId)) continue;
      await this.db
        .insert(projectRulebookLinks)
        .values({ projectId: project.id, rulebookId: rbId })
        .onConflictDoNothing();
    }

    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: project.id } });
    return this.getResolvedProjectRules(project.id);
  }

  async addProjectCustomRule(
    projectIdOrSlug: string,
    input: CreateRuleInput,
    actor: Actor = 'user',
  ): Promise<RuleDto | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const [created] = await this.db
      .insert(rules)
      .values({
        rulebookId: null,
        projectId: project.id,
        code: input.code,
        title: input.title,
        category: input.category,
        severity: input.severity,
        defaultValue: input.defaultValue,
        instruction: input.instruction,
        positiveFragment: input.positiveFragment,
        negativeFragment: input.negativeFragment,
        autoInject: input.autoInject,
        appliesToTags: input.appliesToTags,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
      })
      .returning();

    if (!created) return null;

    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: project.id } });
    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'rules.custom_added',
      summary: `Règle projet ajoutée : ${created.title} (${created.code})`,
      entityType: 'rule',
      entityId: created.id,
    });
    return this.toRuleDto(created);
  }

  async upsertProjectRuleOverride(
    projectIdOrSlug: string,
    ruleId: string,
    input: UpsertProjectRuleOverrideInput,
    actor: Actor = 'user',
  ): Promise<ProjectRulesBundle | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project || !UUID_REGEX.test(ruleId)) return null;

    const existing = await this.db
      .select()
      .from(projectRuleOverrides)
      .where(
        and(
          eq(projectRuleOverrides.projectId, project.id),
          eq(projectRuleOverrides.ruleId, ruleId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await this.db
        .update(projectRuleOverrides)
        .set({
          ...(input.enabledOverride !== undefined
            ? { enabledOverride: input.enabledOverride }
            : {}),
          ...(input.severityOverride !== undefined
            ? { severityOverride: input.severityOverride }
            : {}),
          ...(input.valueOverride !== undefined ? { valueOverride: input.valueOverride } : {}),
          ...(input.instructionOverride !== undefined
            ? { instructionOverride: input.instructionOverride }
            : {}),
          ...(input.positiveFragmentOverride !== undefined
            ? { positiveFragmentOverride: input.positiveFragmentOverride }
            : {}),
          ...(input.negativeFragmentOverride !== undefined
            ? { negativeFragmentOverride: input.negativeFragmentOverride }
            : {}),
          ...(input.autoInjectOverride !== undefined
            ? { autoInjectOverride: input.autoInjectOverride }
            : {}),
          ...(input.appliesToTagsOverride !== undefined
            ? { appliesToTagsOverride: input.appliesToTagsOverride }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(projectRuleOverrides.id, existing[0].id));
    } else {
      await this.db.insert(projectRuleOverrides).values({
        projectId: project.id,
        ruleId,
        enabledOverride: input.enabledOverride ?? null,
        severityOverride: input.severityOverride ?? null,
        valueOverride: input.valueOverride ?? null,
        instructionOverride: input.instructionOverride ?? null,
        positiveFragmentOverride: input.positiveFragmentOverride ?? null,
        negativeFragmentOverride: input.negativeFragmentOverride ?? null,
        autoInjectOverride: input.autoInjectOverride ?? null,
        appliesToTagsOverride: input.appliesToTagsOverride ?? null,
      });
    }

    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: project.id } });
    await this.studio.logActivity({
      projectId: project.id,
      projectSlug: project.slug,
      actor,
      action: 'rules.overridden',
      summary: `Surcharge de règle mise à jour sur @proj-${project.slug}`,
      entityType: 'rule',
      entityId: ruleId,
    });

    return this.getResolvedProjectRules(project.id);
  }

  async clearProjectRuleOverride(
    projectIdOrSlug: string,
    ruleId: string,
  ): Promise<ProjectRulesBundle | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project || !UUID_REGEX.test(ruleId)) return null;

    await this.db
      .delete(projectRuleOverrides)
      .where(
        and(
          eq(projectRuleOverrides.projectId, project.id),
          eq(projectRuleOverrides.ruleId, ruleId),
        ),
      );

    this.realtime.broadcast({ type: 'rules.changed', payload: { projectId: project.id } });
    return this.getResolvedProjectRules(project.id);
  }

  async getResolvedProjectRules(
    projectIdOrSlug: string,
    contextTags?: string[],
  ): Promise<ProjectRulesBundle | null> {
    const project = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
    if (!project) return null;

    const links = await this.db
      .select()
      .from(projectRulebookLinks)
      .where(eq(projectRulebookLinks.projectId, project.id));

    const attachedIds = links.map((l) => l.rulebookId);
    const allBooks = await this.listRulebooks();
    const attachedRulebooks = allBooks.filter((b) => attachedIds.includes(b.id));

    const overrideRows = await this.db
      .select()
      .from(projectRuleOverrides)
      .where(eq(projectRuleOverrides.projectId, project.id));

    const overrides: ProjectRuleOverrideDto[] = overrideRows.map((o) => ({
      id: o.id,
      projectId: o.projectId,
      ruleId: o.ruleId,
      enabledOverride: o.enabledOverride,
      severityOverride: o.severityOverride as RuleSeverity | null,
      valueOverride: o.valueOverride,
      instructionOverride: o.instructionOverride,
      positiveFragmentOverride: o.positiveFragmentOverride,
      negativeFragmentOverride: o.negativeFragmentOverride,
      autoInjectOverride: o.autoInjectOverride,
      appliesToTagsOverride: o.appliesToTagsOverride ?? null,
      updatedAt: o.updatedAt.toISOString(),
    }));

    const customRows = await this.db
      .select()
      .from(rules)
      .where(eq(rules.projectId, project.id))
      .orderBy(asc(rules.sortOrder), asc(rules.code));

    const resolved = resolveProjectRules({
      attachedRulebooks,
      overrides,
      projectCustomRules: customRows.map((r) => this.toRuleDto(r)),
      contextTags,
    });

    return {
      projectId: project.id,
      projectSlug: project.slug,
      attachedRulebookIds: attachedIds,
      ...resolved,
    };
  }

  // ==========================================================================
  // 3. Prompt Templates & ComfyUI Workflows Library
  // ==========================================================================

  async listPromptTemplates(category?: PromptCategory): Promise<PromptTemplateDto[]> {
    const rows = await this.db
      .select()
      .from(promptTemplates)
      .where(category ? eq(promptTemplates.category, category) : undefined)
      .orderBy(desc(promptTemplates.updatedAt));

    return rows.map((r) => this.toPromptDto(r));
  }

  async getPromptTemplate(idOrSlug: string): Promise<PromptTemplateDto | null> {
    const cond = UUID_REGEX.test(idOrSlug)
      ? eq(promptTemplates.id, idOrSlug)
      : eq(promptTemplates.slug, idOrSlug.toLowerCase());
    const rows = await this.db.select().from(promptTemplates).where(cond).limit(1);
    return rows[0] ? this.toPromptDto(rows[0]) : null;
  }

  async createPromptTemplate(
    input: CreatePromptTemplateInput,
    actor: Actor = 'user',
  ): Promise<PromptTemplateDto> {
    const baseSlug = input.slug ? input.slug.toLowerCase() : slugifyProjectName(input.name);
    const slug = await this.ensureUniquePromptSlug(baseSlug);

    // Auto-discover variables from template strings if not explicitly passed
    const discoveredNames = extractTemplateVariables(
      input.positiveTemplate,
      input.negativeTemplate,
    );
    const existingByName = new Map(input.variables.map((v) => [v.name, v]));
    const mergedVars = discoveredNames.map(
      (name) => existingByName.get(name) ?? { name, defaultValue: '' },
    );
    for (const v of input.variables) {
      if (!discoveredNames.includes(v.name)) mergedVars.push(v);
    }

    const [created] = await this.db
      .insert(promptTemplates)
      .values({
        slug,
        name: input.name,
        category: input.category,
        targetModel: input.targetModel,
        positiveTemplate: input.positiveTemplate,
        negativeTemplate: input.negativeTemplate,
        variables: mergedVars,
        tags: input.tags,
        notes: input.notes,
      })
      .returning();

    if (!created) throw new Error('Failed to create prompt template');
    const dto = this.toPromptDto(created);
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'prompt' } });
    await this.studio.logActivity({
      actor,
      action: 'prompt.created',
      summary: `Template de prompt créé : ${dto.name} (${dto.handle})`,
      entityType: 'prompt',
      entityId: dto.id,
      entityRef: dto.handle,
    });
    return dto;
  }

  async updatePromptTemplate(
    idOrSlug: string,
    input: UpdatePromptTemplateInput,
  ): Promise<PromptTemplateDto | null> {
    const existing = await this.getPromptTemplate(idOrSlug);
    if (!existing) return null;

    const nextPos = input.positiveTemplate ?? existing.positiveTemplate;
    const nextNeg = input.negativeTemplate ?? existing.negativeTemplate;
    const nextVarsInput = input.variables ?? existing.variables;
    const discovered = extractTemplateVariables(nextPos, nextNeg);
    const byName = new Map(nextVarsInput.map((v) => [v.name, v]));
    const mergedVars = discovered.map((name) => byName.get(name) ?? { name, defaultValue: '' });

    const [updated] = await this.db
      .update(promptTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.targetModel !== undefined ? { targetModel: input.targetModel } : {}),
        positiveTemplate: nextPos,
        negativeTemplate: nextNeg,
        variables: mergedVars,
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(promptTemplates.id, existing.id))
      .returning();

    if (!updated) return null;
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'prompt' } });
    return this.toPromptDto(updated);
  }

  async deletePromptTemplate(idOrSlug: string): Promise<boolean> {
    const existing = await this.getPromptTemplate(idOrSlug);
    if (!existing) return false;
    await this.db.delete(promptTemplates).where(eq(promptTemplates.id, existing.id));
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'prompt' } });
    return true;
  }

  async renderPromptWithProjectRules(params: {
    templateIdOrSlug: string;
    projectIdOrSlug?: string;
    variables?: Record<string, string>;
    includeProjectRules?: boolean;
    tags?: string[];
  }): Promise<(RenderedPromptResult & { template: PromptTemplateDto; appliedRulesCount: number }) | null> {
    const tpl = await this.getPromptTemplate(params.templateIdOrSlug);
    if (!tpl) return null;

    const defaults: Record<string, string> = {};
    for (const v of tpl.variables) {
      if (v.defaultValue) defaults[v.name] = v.defaultValue;
    }

    let rulePositiveFragments = '';
    let ruleNegativeFragments = '';
    let appliedRulesCount = 0;

    if (params.projectIdOrSlug && params.includeProjectRules !== false) {
      const bundle = await this.getResolvedProjectRules(params.projectIdOrSlug, params.tags);
      if (bundle) {
        const selected = selectInjectableRuleFragments(bundle.resolvedRules, params.tags);
        rulePositiveFragments = selected.positive;
        ruleNegativeFragments = selected.negative;
        appliedRulesCount = selected.injectedRulesCount;
      }
    }

    const rendered = renderPromptTemplate({
      positiveTemplate: tpl.positiveTemplate,
      negativeTemplate: tpl.negativeTemplate,
      variables: params.variables,
      defaults,
      rulePositiveFragments,
      ruleNegativeFragments,
    });

    return {
      ...rendered,
      template: tpl,
      appliedRulesCount,
    };
  }

  // --- ComfyUI Workflows ---

  async listComfyWorkflows(category?: ComfyWorkflowCategory): Promise<ComfyWorkflowDto[]> {
    const rows = await this.db
      .select()
      .from(comfyWorkflows)
      .where(category ? eq(comfyWorkflows.category, category) : undefined)
      .orderBy(desc(comfyWorkflows.updatedAt));

    return rows.map((r) => this.toWorkflowDto(r));
  }

  async createComfyWorkflow(
    input: CreateComfyWorkflowInput,
    actor: Actor = 'user',
  ): Promise<ComfyWorkflowDto> {
    const baseSlug = input.slug ? input.slug.toLowerCase() : slugifyProjectName(input.name);
    const slug = await this.ensureUniqueWorkflowSlug(baseSlug);

    const [created] = await this.db
      .insert(comfyWorkflows)
      .values({
        slug,
        name: input.name,
        description: input.description,
        category: input.category,
        version: 1,
        workflowJson: input.workflowJson,
        inputNotes: input.inputNotes,
        tags: input.tags,
      })
      .returning();

    if (!created) throw new Error('Failed to save ComfyUI workflow');
    const dto = this.toWorkflowDto(created);
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'workflow' } });
    await this.studio.logActivity({
      actor,
      action: 'workflow.saved',
      summary: `Workflow ComfyUI enregistré : ${dto.name} (${dto.handle})`,
      entityType: 'workflow',
      entityId: dto.id,
      entityRef: dto.handle,
    });
    return dto;
  }

  async updateComfyWorkflow(
    idOrSlug: string,
    input: UpdateComfyWorkflowInput,
  ): Promise<ComfyWorkflowDto | null> {
    const cond = UUID_REGEX.test(idOrSlug)
      ? eq(comfyWorkflows.id, idOrSlug)
      : eq(comfyWorkflows.slug, idOrSlug.toLowerCase());
    const found = await this.db.select().from(comfyWorkflows).where(cond).limit(1);
    const existing = found[0];
    if (!existing) return null;

    const [updated] = await this.db
      .update(comfyWorkflows)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.workflowJson !== undefined
          ? { workflowJson: input.workflowJson, version: existing.version + 1 }
          : {}),
        ...(input.inputNotes !== undefined ? { inputNotes: input.inputNotes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        updatedAt: new Date(),
      })
      .where(eq(comfyWorkflows.id, existing.id))
      .returning();

    if (!updated) return null;
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'workflow' } });
    return this.toWorkflowDto(updated);
  }

  async deleteComfyWorkflow(idOrSlug: string): Promise<boolean> {
    const cond = UUID_REGEX.test(idOrSlug)
      ? eq(comfyWorkflows.id, idOrSlug)
      : eq(comfyWorkflows.slug, idOrSlug.toLowerCase());
    const [deleted] = await this.db.delete(comfyWorkflows).where(cond).returning();
    if (!deleted) return false;
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'workflow' } });
    return true;
  }

  // ==========================================================================
  // 4. Claude Code Skills Hub (SKILL.md versioning & local disk sync)
  // ==========================================================================

  async listSkills(projectIdOrSlug?: string): Promise<SkillDto[]> {
    let projectId: string | undefined;
    if (projectIdOrSlug) {
      const proj = await this.studio.getProjectByIdOrSlug(projectIdOrSlug);
      if (proj) projectId = proj.id;
    }

    const rows = await this.db
      .select({ skill: skills, projectSlug: projects.slug })
      .from(skills)
      .leftJoin(projects, eq(projects.id, skills.projectId))
      .orderBy(desc(skills.updatedAt));

    return rows
      .filter((r) => !projectId || r.skill.scope === 'global' || r.skill.projectId === projectId)
      .map((r) => this.toSkillDto(r.skill, r.projectSlug ?? null));
  }

  async getSkillWithVersions(
    idOrSlug: string,
  ): Promise<{ skill: SkillDto; versions: SkillVersionDto[] } | null> {
    const cond = UUID_REGEX.test(idOrSlug)
      ? eq(skills.id, idOrSlug)
      : eq(skills.slug, idOrSlug.toLowerCase());

    const rows = await this.db
      .select({ skill: skills, projectSlug: projects.slug })
      .from(skills)
      .leftJoin(projects, eq(projects.id, skills.projectId))
      .where(cond)
      .limit(1);

    const match = rows[0];
    if (!match) return null;

    const versionRows = await this.db
      .select()
      .from(skillVersions)
      .where(eq(skillVersions.skillId, match.skill.id))
      .orderBy(desc(skillVersions.version));

    return {
      skill: this.toSkillDto(match.skill, match.projectSlug ?? null),
      versions: versionRows.map((v) => ({
        id: v.id,
        skillId: v.skillId,
        version: v.version,
        content: v.content,
        changeSummary: v.changeSummary,
        author: v.author as Actor,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async upsertSkill(input: UpsertSkillInput): Promise<SkillDto> {
    const slug = (input.slug ?? slugifyProjectName(input.name)).toLowerCase();
    const existingRows = await this.db
      .select()
      .from(skills)
      .where(eq(skills.slug, slug))
      .limit(1);

    const existing = existingRows[0];
    const syncedPath = await this.skillsSync.syncSkillToDisk({
      slug,
      description: input.description,
      content: input.content,
      syncEnabled: input.syncEnabled,
    });

    let savedRow: typeof skills.$inferSelect;
    let nextVersion: number;

    if (existing) {
      nextVersion = existing.version + 1;
      const [updated] = await this.db
        .update(skills)
        .set({
          name: input.name,
          description: input.description,
          scope: input.scope,
          projectId: input.scope === 'project' ? (input.projectId ?? null) : null,
          content: input.content,
          version: nextVersion,
          syncEnabled: input.syncEnabled,
          syncedPath,
          updatedAt: new Date(),
        })
        .where(eq(skills.id, existing.id))
        .returning();
      if (!updated) throw new Error('Failed to update skill');
      savedRow = updated;
    } else {
      nextVersion = 1;
      const [created] = await this.db
        .insert(skills)
        .values({
          slug,
          name: input.name,
          description: input.description,
          scope: input.scope,
          projectId: input.scope === 'project' ? (input.projectId ?? null) : null,
          content: input.content,
          version: 1,
          syncEnabled: input.syncEnabled,
          syncedPath,
        })
        .returning();
      if (!created) throw new Error('Failed to create skill');
      savedRow = created;
    }

    await this.db.insert(skillVersions).values({
      skillId: savedRow.id,
      version: nextVersion,
      content: input.content,
      changeSummary: input.changeSummary,
      author: input.author,
    });

    let projectSlug: string | null = null;
    if (savedRow.projectId) {
      const p = await this.studio.getProjectByIdOrSlug(savedRow.projectId);
      projectSlug = p?.slug ?? null;
    }

    const dto = this.toSkillDto(savedRow, projectSlug);
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'skill' } });
    await this.studio.logActivity({
      projectId: savedRow.projectId,
      projectSlug,
      actor: input.author,
      action: existing ? 'skill.updated' : 'skill.created',
      summary: `Skill ${dto.handle} (v${dto.version}) : ${input.changeSummary}`,
      entityType: 'skill',
      entityId: dto.id,
      entityRef: dto.handle,
    });

    return dto;
  }

  async deleteSkill(idOrSlug: string): Promise<boolean> {
    const cond = UUID_REGEX.test(idOrSlug)
      ? eq(skills.id, idOrSlug)
      : eq(skills.slug, idOrSlug.toLowerCase());
    const [deleted] = await this.db.delete(skills).where(cond).returning();
    if (!deleted) return false;
    await this.skillsSync.removeSkillFromDisk(deleted.slug);
    this.realtime.broadcast({ type: 'library.changed', payload: { kind: 'skill' } });
    return true;
  }

  // --- Helpers ---

  private async ensureUniqueRulebookSlug(base: string): Promise<string> {
    let candidate = base;
    let i = 2;
    while (true) {
      const found = await this.db
        .select({ id: rulebooks.id })
        .from(rulebooks)
        .where(eq(rulebooks.slug, candidate))
        .limit(1);
      if (found.length === 0) return candidate;
      candidate = `${base}-${i++}`;
    }
  }

  private async ensureUniquePromptSlug(base: string): Promise<string> {
    let candidate = base;
    let i = 2;
    while (true) {
      const found = await this.db
        .select({ id: promptTemplates.id })
        .from(promptTemplates)
        .where(eq(promptTemplates.slug, candidate))
        .limit(1);
      if (found.length === 0) return candidate;
      candidate = `${base}-${i++}`;
    }
  }

  private async ensureUniqueWorkflowSlug(base: string): Promise<string> {
    let candidate = base;
    let i = 2;
    while (true) {
      const found = await this.db
        .select({ id: comfyWorkflows.id })
        .from(comfyWorkflows)
        .where(eq(comfyWorkflows.slug, candidate))
        .limit(1);
      if (found.length === 0) return candidate;
      candidate = `${base}-${i++}`;
    }
  }

  private toAnnotationDto(
    row: typeof annotations.$inferSelect,
    assetRefCode: string,
    assetTitle: string,
  ): AnnotationDto {
    return {
      id: row.id,
      assetId: row.assetId,
      projectId: row.projectId,
      assetRef: buildAssetHandle(assetRefCode),
      assetTitle,
      author: row.author as Actor,
      frameNumber: row.frameNumber,
      timecodeSec: row.timecodeSec,
      shotId: row.shotId ?? null,
      shotCode: row.shotCode ?? null,
      shapeType: row.shapeType as AnnotationShapeType,
      x: row.x,
      y: row.y,
      w: row.w,
      h: row.h,
      color: row.color,
      comment: row.comment,
      status: row.status as AnnotationStatus,
      resolvedBy: (row.resolvedBy as Actor | null) ?? null,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toRuleDto(row: typeof rules.$inferSelect): RuleDto {
    return {
      id: row.id,
      rulebookId: row.rulebookId,
      projectId: row.projectId,
      code: row.code,
      title: row.title,
      category: row.category as RuleCategory,
      severity: row.severity as RuleSeverity,
      defaultValue: row.defaultValue,
      instruction: row.instruction,
      positiveFragment: row.positiveFragment,
      negativeFragment: row.negativeFragment,
      autoInject: row.autoInject,
      appliesToTags: row.appliesToTags ?? [],
      enabled: row.enabled,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toPromptDto(row: typeof promptTemplates.$inferSelect): PromptTemplateDto {
    return {
      id: row.id,
      slug: row.slug,
      handle: `@prompt-${row.slug}`,
      name: row.name,
      category: row.category as PromptCategory,
      targetModel: row.targetModel,
      positiveTemplate: row.positiveTemplate,
      negativeTemplate: row.negativeTemplate,
      variables: row.variables ?? [],
      tags: row.tags ?? [],
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toWorkflowDto(row: typeof comfyWorkflows.$inferSelect): ComfyWorkflowDto {
    return {
      id: row.id,
      slug: row.slug,
      handle: `@wf-${row.slug}`,
      name: row.name,
      description: row.description,
      category: row.category as ComfyWorkflowCategory,
      version: row.version,
      workflowJson: row.workflowJson,
      inputNotes: row.inputNotes,
      tags: row.tags ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toSkillDto(
    row: typeof skills.$inferSelect,
    projectSlug: string | null,
  ): SkillDto {
    return {
      id: row.id,
      slug: row.slug,
      handle: `skill://${row.slug}`,
      name: row.name,
      description: row.description,
      scope: row.scope as SkillScope,
      projectId: row.projectId,
      projectSlug,
      content: row.content,
      version: row.version,
      syncEnabled: row.syncEnabled,
      syncedPath: row.syncedPath,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // Keep inArray imported cleanly for future queries
  protected readonly _inArray = inArray;
}
