import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeService } from '../services/knowledge.service.js';
import { registerKnowledgeRoutes } from './knowledge.routes.js';

describe('knowledge.routes', () => {
  it('supports list, upsert, update, delete, playbook recall, and apply-to-project', async () => {
    const app = Fastify();
    const sampleEntry = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'animation-cfg-5',
      title: 'Wan 2.1 CFG optimal',
      kind: 'lesson',
      projectTypes: ['animation'],
      priority: 'high',
      content: 'Utiliser CFG 5.5 pour préserver les visages.',
      positiveFragment: '',
      negativeFragment: '',
      recommendedModel: 'wan2.1',
      linkedSkillSlug: null,
      tags: ['wan'],
      learnedBy: 'claude',
      verified: true,
      pinned: false,
      sourceProjectSlug: 'demo',
      usageCount: 3,
      lastRecalledAt: '2026-11-28T10:00:00.000Z',
      createdAt: '2026-11-28T10:00:00.000Z',
      updatedAt: '2026-11-28T10:00:00.000Z',
    };

    const mockKnowledge = {
      listEntries: vi.fn().mockResolvedValue([sampleEntry]),
      upsertEntry: vi.fn().mockResolvedValue({ entry: sampleEntry, created: true }),
      updateEntry: vi.fn().mockResolvedValue({ ...sampleEntry, pinned: true }),
      deleteEntry: vi.fn().mockResolvedValue(true),
      recallPlaybook: vi.fn().mockResolvedValue({
        projectType: 'animation',
        projectSlug: 'demo',
        recalledAt: '2026-11-28T10:00:00.000Z',
        totalEntries: 1,
        entries: [sampleEntry],
        byKind: { rule: [], prompt: [], skill: [], lesson: [sampleEntry], preset: [] },
        rulebooks: [],
        promptTemplates: [],
        comfyWorkflows: [],
        skills: [],
        compiledBrief: '# Playbook Studio — Animation',
      }),
      applyEntryToProject: vi.fn().mockResolvedValue({
        rule: { id: 'r1', code: 'mem-animation-cfg-5' },
        entry: sampleEntry,
      }),
    } as unknown as KnowledgeService;

    registerKnowledgeRoutes(app, mockKnowledge);

    const listRes = await app.inject({ method: 'GET', url: '/api/knowledge?projectType=animation&kind=lesson' });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().entries).toHaveLength(1);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/knowledge',
      payload: {
        title: 'Wan 2.1 CFG optimal',
        kind: 'lesson',
        projectTypes: ['animation'],
        content: 'Utiliser CFG 5.5 pour préserver les visages.',
      },
    });
    expect(createRes.statusCode).toBe(201);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/knowledge/${sampleEntry.id}`,
      payload: { pinned: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().entry.pinned).toBe(true);

    const playbookRes = await app.inject({
      method: 'GET',
      url: '/api/knowledge/playbook?projectType=animation',
    });
    expect(playbookRes.statusCode).toBe(200);
    expect(playbookRes.json().playbook.compiledBrief).toContain('Playbook Studio');

    const applyRes = await app.inject({
      method: 'POST',
      url: `/api/knowledge/${sampleEntry.id}/apply-to-project`,
      payload: { projectIdOrSlug: 'demo' },
    });
    expect(applyRes.statusCode).toBe(201);
    expect(applyRes.json().rule.code).toBe('mem-animation-cfg-5');

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/knowledge/${sampleEntry.id}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().deleted).toBe(true);

    await app.close();
  });
});
