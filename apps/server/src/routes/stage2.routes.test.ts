import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Stage2Service } from '../services/stage2.service.js';
import { registerStage2Routes } from './stage2.routes.js';

describe('Stage 2 REST routes validation & contract', () => {
  it('validates annotation payloads (rejects out-of-range coordinates or empty comment)', async () => {
    const mockStage2 = {
      createAnnotation: vi.fn(),
    } as unknown as Stage2Service;

    const app = Fastify({ logger: false });
    registerStage2Routes(app, mockStage2);

    const invalidCoords = await app.inject({
      method: 'POST',
      url: '/api/assets/11111111-1111-1111-1111-111111111111/annotations',
      payload: { x: 1.5, y: 0.2, comment: 'Fix hand' },
    });
    expect(invalidCoords.statusCode).toBe(400);

    const emptyComment = await app.inject({
      method: 'POST',
      url: '/api/assets/11111111-1111-1111-1111-111111111111/annotations',
      payload: { x: 0.4, y: 0.6, comment: '   ' },
    });
    expect(emptyComment.statusCode).toBe(400);

    await app.close();
  });

  it('forwards valid per-project rule override and prompt render requests to Stage2Service', async () => {
    const upsertProjectRuleOverride = vi.fn().mockResolvedValue({
      projectId: '11111111-1111-1111-1111-111111111111',
      projectSlug: 'cartoon-ep1',
      attachedRulebookIds: [],
      resolvedRules: [],
      activeRulesCount: 1,
      mergedPositiveFragments: '4 fingers per hand',
      mergedNegativeFragments: '5 fingers',
    });

    const renderPromptWithProjectRules = vi.fn().mockResolvedValue({
      positive: 'Cartoon hero, 4 fingers per hand',
      negative: '5 fingers',
      missingVariables: [],
      appliedRulesCount: 1,
      template: { id: '22222222-2222-2222-2222-222222222222', slug: 'hero-shot' },
    });

    const app = Fastify({ logger: false });
    registerStage2Routes(app, {
      upsertProjectRuleOverride,
      renderPromptWithProjectRules,
    } as unknown as Stage2Service);

    const overrideRes = await app.inject({
      method: 'PUT',
      url: '/api/projects/cartoon-ep1/rules/33333333-3333-3333-3333-333333333333/override',
      payload: {
        valueOverride: '4 doigts (cartoon)',
        positiveFragmentOverride: '4 fingers per hand',
      },
    });
    expect(overrideRes.statusCode).toBe(200);
    expect(upsertProjectRuleOverride).toHaveBeenCalledWith(
      'cartoon-ep1',
      '33333333-3333-3333-3333-333333333333',
      expect.objectContaining({ valueOverride: '4 doigts (cartoon)' }),
      'user',
    );

    const renderRes = await app.inject({
      method: 'POST',
      url: '/api/prompts/hero-shot/render',
      payload: {
        projectIdOrSlug: 'cartoon-ep1',
        variables: { character: 'Cartoon hero' },
      },
    });
    expect(renderRes.statusCode).toBe(200);
    expect(renderRes.json().rendered.positive).toContain('4 fingers per hand');

    await app.close();
  });
});
