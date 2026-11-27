import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AnnotationStatusSchema,
  ComfyWorkflowCategorySchema,
  CreateAnnotationInputSchema,
  CreateComfyWorkflowInputSchema,
  CreatePromptTemplateInputSchema,
  CreateRulebookInputSchema,
  CreateRuleInputSchema,
  PromptCategorySchema,
  UpdateAnnotationInputSchema,
  UpdateComfyWorkflowInputSchema,
  UpdatePromptTemplateInputSchema,
  UpdateRuleInputSchema,
  UpsertProjectRuleOverrideInputSchema,
  UpsertSkillInputSchema,
} from '@videostudio/shared';
import type { Stage2Service } from '../services/stage2.service.js';

export function registerStage2Routes(
  app: FastifyInstance,
  stage2: Stage2Service,
): void {
  // ==========================================================================
  // 1. Visual Annotations & Project Feedback Inbox
  // ==========================================================================

  app.get<{ Params: { assetId: string } }>(
    '/api/assets/:assetId/annotations',
    async (request) => {
      const items = await stage2.listAssetAnnotations(request.params.assetId);
      return { annotations: items };
    },
  );

  app.post<{ Params: { assetId: string } }>(
    '/api/assets/:assetId/annotations',
    async (request, reply) => {
      const parsed = CreateAnnotationInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const created = await stage2.createAnnotation(request.params.assetId, parsed.data);
      if (!created) return reply.code(404).send({ error: 'Asset not found' });
      return reply.code(201).send({ annotation: created });
    },
  );

  app.patch<{ Params: { id: string } }>('/api/annotations/:id', async (request, reply) => {
    const parsed = UpdateAnnotationInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const updated = await stage2.updateAnnotation(request.params.id, parsed.data, 'user');
    if (!updated) return reply.code(404).send({ error: 'Annotation not found' });
    return { annotation: updated };
  });

  app.delete<{ Params: { id: string } }>('/api/annotations/:id', async (request, reply) => {
    const ok = await stage2.deleteAnnotation(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Annotation not found' });
    return reply.code(204).send();
  });

  app.get<{
    Params: { projectIdOrSlug: string };
    Querystring: { status?: string; since?: string };
  }>('/api/projects/:projectIdOrSlug/feedback', async (request) => {
    const st = request.query.status;
    const parsedStatus =
      st === 'all' ? 'all' : AnnotationStatusSchema.safeParse(st).data ?? 'open';
    const items = await stage2.listProjectFeedback(
      request.params.projectIdOrSlug,
      parsedStatus,
      request.query.since,
    );
    return { feedback: items };
  });

  // ==========================================================================
  // 2. Rulebooks, Rules & Per-Project Overrides
  // ==========================================================================

  app.get('/api/rulebooks', async () => {
    const items = await stage2.listRulebooks();
    return { rulebooks: items };
  });

  app.post('/api/rulebooks', async (request, reply) => {
    const parsed = CreateRulebookInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const created = await stage2.createRulebook(parsed.data);
    return reply.code(201).send({ rulebook: created });
  });

  app.delete<{ Params: { id: string } }>('/api/rulebooks/:id', async (request, reply) => {
    const ok = await stage2.deleteRulebook(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Rulebook not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { rulebookId: string } }>(
    '/api/rulebooks/:rulebookId/rules',
    async (request, reply) => {
      const parsed = CreateRuleInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const created = await stage2.addRuleToRulebook(request.params.rulebookId, parsed.data);
      if (!created) return reply.code(404).send({ error: 'Rulebook not found' });
      return reply.code(201).send({ rule: created });
    },
  );

  app.patch<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const parsed = UpdateRuleInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const updated = await stage2.updateRule(request.params.id, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'Rule not found' });
    return { rule: updated };
  });

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const ok = await stage2.deleteRule(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Rule not found' });
    return reply.code(204).send();
  });

  app.get<{
    Params: { projectIdOrSlug: string };
    Querystring: { tags?: string };
  }>('/api/projects/:projectIdOrSlug/rules', async (request, reply) => {
    const contextTags = request.query.tags
      ? request.query.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : undefined;
    const bundle = await stage2.getResolvedProjectRules(
      request.params.projectIdOrSlug,
      contextTags,
    );
    if (!bundle) return reply.code(404).send({ error: 'Project not found' });
    return { rulesBundle: bundle };
  });

  app.put<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/rulebooks',
    async (request, reply) => {
      const parsed = z.object({ rulebookIds: z.array(z.string().uuid()) }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const bundle = await stage2.setProjectRulebooks(
        request.params.projectIdOrSlug,
        parsed.data.rulebookIds,
      );
      if (!bundle) return reply.code(404).send({ error: 'Project not found' });
      return { rulesBundle: bundle };
    },
  );

  app.post<{ Params: { projectIdOrSlug: string } }>(
    '/api/projects/:projectIdOrSlug/rules',
    async (request, reply) => {
      const parsed = CreateRuleInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const created = await stage2.addProjectCustomRule(
        request.params.projectIdOrSlug,
        parsed.data,
        'user',
      );
      if (!created) return reply.code(404).send({ error: 'Project not found' });
      return reply.code(201).send({ rule: created });
    },
  );

  app.put<{ Params: { projectIdOrSlug: string; ruleId: string } }>(
    '/api/projects/:projectIdOrSlug/rules/:ruleId/override',
    async (request, reply) => {
      const parsed = UpsertProjectRuleOverrideInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const bundle = await stage2.upsertProjectRuleOverride(
        request.params.projectIdOrSlug,
        request.params.ruleId,
        parsed.data,
        'user',
      );
      if (!bundle) return reply.code(404).send({ error: 'Project or rule not found' });
      return { rulesBundle: bundle };
    },
  );

  app.delete<{ Params: { projectIdOrSlug: string; ruleId: string } }>(
    '/api/projects/:projectIdOrSlug/rules/:ruleId/override',
    async (request, reply) => {
      const bundle = await stage2.clearProjectRuleOverride(
        request.params.projectIdOrSlug,
        request.params.ruleId,
      );
      if (!bundle) return reply.code(404).send({ error: 'Project or rule not found' });
      return { rulesBundle: bundle };
    },
  );

  // ==========================================================================
  // 3. Prompt Templates & ComfyUI Workflows
  // ==========================================================================

  app.get<{ Querystring: { category?: string } }>('/api/prompts', async (request) => {
    const cat = request.query.category
      ? PromptCategorySchema.safeParse(request.query.category).data
      : undefined;
    const items = await stage2.listPromptTemplates(cat);
    return { prompts: items };
  });

  app.post('/api/prompts', async (request, reply) => {
    const parsed = CreatePromptTemplateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const created = await stage2.createPromptTemplate(parsed.data, 'user');
    return reply.code(201).send({ prompt: created });
  });

  app.patch<{ Params: { idOrSlug: string } }>('/api/prompts/:idOrSlug', async (request, reply) => {
    const parsed = UpdatePromptTemplateInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const updated = await stage2.updatePromptTemplate(request.params.idOrSlug, parsed.data);
    if (!updated) return reply.code(404).send({ error: 'Prompt template not found' });
    return { prompt: updated };
  });

  app.delete<{ Params: { idOrSlug: string } }>('/api/prompts/:idOrSlug', async (request, reply) => {
    const ok = await stage2.deletePromptTemplate(request.params.idOrSlug);
    if (!ok) return reply.code(404).send({ error: 'Prompt template not found' });
    return reply.code(204).send();
  });

  app.post<{ Params: { idOrSlug: string } }>(
    '/api/prompts/:idOrSlug/render',
    async (request, reply) => {
      const parsed = z
        .object({
          projectIdOrSlug: z.string().optional(),
          variables: z.record(z.string()).optional(),
          includeProjectRules: z.boolean().default(true),
          tags: z.array(z.string()).optional(),
        })
        .safeParse(request.body ?? {});

      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const rendered = await stage2.renderPromptWithProjectRules({
        templateIdOrSlug: request.params.idOrSlug,
        projectIdOrSlug: parsed.data.projectIdOrSlug,
        variables: parsed.data.variables,
        includeProjectRules: parsed.data.includeProjectRules,
        tags: parsed.data.tags,
      });
      if (!rendered) return reply.code(404).send({ error: 'Prompt template not found' });
      return { rendered };
    },
  );

  app.get<{ Querystring: { category?: string } }>('/api/workflows', async (request) => {
    const cat = request.query.category
      ? ComfyWorkflowCategorySchema.safeParse(request.query.category).data
      : undefined;
    const items = await stage2.listComfyWorkflows(cat);
    return { workflows: items };
  });

  app.post('/api/workflows', async (request, reply) => {
    const parsed = CreateComfyWorkflowInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const created = await stage2.createComfyWorkflow(parsed.data, 'user');
    return reply.code(201).send({ workflow: created });
  });

  app.patch<{ Params: { idOrSlug: string } }>(
    '/api/workflows/:idOrSlug',
    async (request, reply) => {
      const parsed = UpdateComfyWorkflowInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
      }
      const updated = await stage2.updateComfyWorkflow(request.params.idOrSlug, parsed.data);
      if (!updated) return reply.code(404).send({ error: 'Workflow not found' });
      return { workflow: updated };
    },
  );

  app.delete<{ Params: { idOrSlug: string } }>(
    '/api/workflows/:idOrSlug',
    async (request, reply) => {
      const ok = await stage2.deleteComfyWorkflow(request.params.idOrSlug);
      if (!ok) return reply.code(404).send({ error: 'Workflow not found' });
      return reply.code(204).send();
    },
  );

  // ==========================================================================
  // 4. Claude Code Skills Hub
  // ==========================================================================

  app.get<{ Querystring: { project?: string } }>('/api/skills', async (request) => {
    const items = await stage2.listSkills(request.query.project);
    return { skills: items };
  });

  app.get<{ Params: { idOrSlug: string } }>('/api/skills/:idOrSlug', async (request, reply) => {
    const detail = await stage2.getSkillWithVersions(request.params.idOrSlug);
    if (!detail) return reply.code(404).send({ error: 'Skill not found' });
    return detail;
  });

  app.post('/api/skills', async (request, reply) => {
    const parsed = UpsertSkillInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation error', details: parsed.error.flatten() });
    }
    const saved = await stage2.upsertSkill(parsed.data);
    return reply.code(201).send({ skill: saved });
  });

  app.delete<{ Params: { idOrSlug: string } }>('/api/skills/:idOrSlug', async (request, reply) => {
    const ok = await stage2.deleteSkill(request.params.idOrSlug);
    if (!ok) return reply.code(404).send({ error: 'Skill not found' });
    return reply.code(204).send();
  });
}
