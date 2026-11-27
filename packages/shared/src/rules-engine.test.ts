import { describe, expect, it } from 'vitest';
import {
  extractTemplateVariables,
  renderPromptTemplate,
  resolveProjectRules,
} from './rules-engine.js';
import type { ProjectRuleOverrideDto, RulebookDto, RuleDto } from './stage2-schemas.js';

const NOW = '2026-11-27T10:00:00.000Z';

function makeRule(partial: Partial<RuleDto> & { id: string; code: string; title: string }): RuleDto {
  return {
    rulebookId: '11111111-1111-1111-1111-111111111111',
    projectId: null,
    category: 'anatomy',
    severity: 'mandatory',
    defaultValue: '',
    instruction: 'Default instruction',
    positiveFragment: '',
    negativeFragment: '',
    enabled: true,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

describe('resolveProjectRules (global rulebooks + per-project overrides)', () => {
  const handsRule = makeRule({
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    code: 'hands-fingers',
    title: 'Nombre de doigts par main',
    defaultValue: '5 doigts',
    instruction: 'Les personnages humains doivent toujours avoir exactement 5 doigts naturels par main.',
    positiveFragment: 'anatomically correct hands, 5 fingers',
    negativeFragment: 'extra fingers, fused fingers, 6 fingers',
  });

  const watermarkRule = makeRule({
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    code: 'no-watermark',
    title: 'Aucun texte ni filigrane',
    category: 'style',
    defaultValue: 'Interdit',
    instruction: 'Aucune signature, logo ou texte parasite dans les rendus.',
    negativeFragment: 'watermark, text, signature, logo',
    sortOrder: 1,
  });

  const globalBook: RulebookDto = {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'standards-ia',
    name: 'Standards IA',
    description: 'Pack global par défaut',
    isDefault: true,
    rules: [handsRule, watermarkRule],
    createdAt: NOW,
    updatedAt: NOW,
  };

  it('inherits global rules verbatim when no project override exists (5 doigts)', () => {
    const res = resolveProjectRules({
      attachedRulebooks: [globalBook],
      overrides: [],
      projectCustomRules: [],
    });

    expect(res.activeRulesCount).toBe(2);
    expect(res.resolvedRules[0]?.value).toBe('5 doigts');
    expect(res.resolvedRules[0]?.source).toBe('rulebook');
    expect(res.resolvedRules[0]?.isOverridden).toBe(false);
    expect(res.mergedPositiveFragments).toContain('5 fingers');
    expect(res.mergedNegativeFragments).toContain('extra fingers');
    expect(res.mergedNegativeFragments).toContain('watermark');
  });

  it('overrides 5 doigts -> 4 doigts on a cartoon project without altering the global pack', () => {
    const cartoonOverride: ProjectRuleOverrideDto = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      projectId: '22222222-2222-2222-2222-222222222222',
      ruleId: handsRule.id,
      enabledOverride: null,
      severityOverride: null,
      valueOverride: '4 doigts (style cartoon)',
      instructionOverride: 'Style cartoon : chaque main doit avoir exactement 4 doigts.',
      positiveFragmentOverride: 'cartoon hands, 4 fingers per hand',
      negativeFragmentOverride: '5 fingers, 6 fingers, realistic hands',
      updatedAt: NOW,
    };

    const customRule = makeRule({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      rulebookId: null,
      projectId: '22222222-2222-2222-2222-222222222222',
      code: 'cel-shading',
      title: 'Contours encrés cel-shading',
      category: 'style',
      defaultValue: 'Obligatoire',
      instruction: 'Conserver un trait noir net style animation 2D.',
      positiveFragment: 'bold clean ink outlines, cel shaded',
    });

    const res = resolveProjectRules({
      attachedRulebooks: [globalBook],
      overrides: [cartoonOverride],
      projectCustomRules: [customRule],
    });

    expect(res.activeRulesCount).toBe(3);
    const hands = res.resolvedRules.find((r) => r.code === 'hands-fingers');
    expect(hands?.value).toBe('4 doigts (style cartoon)');
    expect(hands?.source).toBe('override');
    expect(hands?.isOverridden).toBe(true);
    expect(res.mergedPositiveFragments).toContain('4 fingers per hand');
    expect(res.mergedPositiveFragments).toContain('cel shaded');
    expect(res.mergedPositiveFragments).not.toContain('5 fingers');
    expect(res.mergedNegativeFragments).toContain('5 fingers');
  });

  it('excludes fragments from rules disabled via project override', () => {
    const disableOverride: ProjectRuleOverrideDto = {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      projectId: '33333333-3333-3333-3333-333333333333',
      ruleId: handsRule.id,
      enabledOverride: false,
      severityOverride: null,
      valueOverride: null,
      instructionOverride: null,
      positiveFragmentOverride: null,
      negativeFragmentOverride: null,
      updatedAt: NOW,
    };

    const res = resolveProjectRules({
      attachedRulebooks: [globalBook],
      overrides: [disableOverride],
      projectCustomRules: [],
    });

    expect(res.activeRulesCount).toBe(1);
    expect(res.mergedPositiveFragments).toBe('');
    expect(res.mergedNegativeFragments).toBe('watermark, text, signature, logo');
  });
});

describe('prompt template extraction & rendering', () => {
  it('extracts unique variables and renders with defaults + active project rules', () => {
    const tpl = 'Cinematic shot of {{character}} in {{location}}, {{lighting}} lighting';
    expect(extractTemplateVariables(tpl)).toEqual(['character', 'location', 'lighting']);

    const rendered = renderPromptTemplate({
      positiveTemplate: tpl,
      negativeTemplate: 'lowres, {{avoid}}',
      defaults: { lighting: 'warm tungsten', avoid: 'blurry' },
      variables: { character: 'Elena' },
      rulePositiveFragments: '5 fingers, film grain',
      ruleNegativeFragments: 'extra fingers, watermark',
    });

    expect(rendered.positive).toBe(
      'Cinematic shot of Elena in {{location}}, warm tungsten lighting, 5 fingers, film grain',
    );
    expect(rendered.negative).toBe('lowres, blurry, extra fingers, watermark');
    expect(rendered.missingVariables).toEqual(['location']);
  });
});
