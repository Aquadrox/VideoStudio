import { describe, expect, it } from 'vitest';
import {
  extractTemplateVariables,
  renderPromptTemplate,
  resolveProjectRules,
  selectInjectableRuleFragments,
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
    autoInject: true,
    appliesToTags: [],
    enabled: true,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

describe('resolveProjectRules (global rulebooks + project custom rules + overrides + autoInject/tags)', () => {
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
  });

  it('applies overrides to BOTH global rules AND project-specific custom rules (fixes bug #1)', () => {
    const customRule = makeRule({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      rulebookId: null,
      projectId: '22222222-2222-2222-2222-222222222222',
      code: 'hidden-hands',
      title: 'Mains cachées',
      category: 'style',
      defaultValue: 'Mouffles',
      instruction: 'Cacher les mains dans des mouffles.',
      positiveFragment: 'fluffy mittens',
      autoInject: true,
    });

    const customRuleOverride: ProjectRuleOverrideDto = {
      id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      projectId: '22222222-2222-2222-2222-222222222222',
      ruleId: customRule.id,
      enabledOverride: null,
      severityOverride: null,
      valueOverride: 'Informatif uniquement',
      instructionOverride: 'Privilégier les mains cachées quand pertinent, sans forcer les mouffles.',
      positiveFragmentOverride: '',
      negativeFragmentOverride: null,
      autoInjectOverride: false,
      appliesToTagsOverride: null,
      updatedAt: NOW,
    };

    const res = resolveProjectRules({
      attachedRulebooks: [],
      overrides: [customRuleOverride],
      projectCustomRules: [customRule],
    });

    const resolvedCustom = res.resolvedRules[0];
    expect(resolvedCustom?.isOverridden).toBe(true);
    expect(resolvedCustom?.source).toBe('override');
    expect(resolvedCustom?.autoInject).toBe(false);
    expect(resolvedCustom?.value).toBe('Informatif uniquement');
    expect(res.mergedPositiveFragments).toBe('');
  });

  it('excludes informative-only rules (autoInject=false) and scopes tag-filtered rules (fixes bug #2)', () => {
    const informativeRule = makeRule({
      id: '12121212-1212-1212-1212-121212121212',
      rulebookId: null,
      projectId: '22222222-2222-2222-2222-222222222222',
      code: 'general-tip',
      title: 'Note informative',
      instruction: 'Conseil narratif uniquement',
      positiveFragment: 'should-not-inject',
      autoInject: false,
    });

    const skirtRuleForElena = makeRule({
      id: '34343434-3434-3434-3434-343434343434',
      rulebookId: null,
      projectId: '22222222-2222-2222-2222-222222222222',
      code: 'elena-outfit',
      title: 'Tenue Elena',
      instruction: 'Elena porte une jupe longue.',
      positiveFragment: 'long skirt',
      autoInject: true,
      appliesToTags: ['elena'],
    });

    // Render for Caspian -> MUST NOT include "long skirt" or "should-not-inject"
    const caspian = resolveProjectRules({
      attachedRulebooks: [globalBook],
      overrides: [],
      projectCustomRules: [informativeRule, skirtRuleForElena],
      contextTags: ['caspian'],
    });
    expect(caspian.mergedPositiveFragments).toContain('5 fingers');
    expect(caspian.mergedPositiveFragments).not.toContain('long skirt');
    expect(caspian.mergedPositiveFragments).not.toContain('should-not-inject');

    // Render for Elena -> MUST include "long skirt"
    const elenaFragments = selectInjectableRuleFragments(caspian.resolvedRules, ['elena']);
    expect(elenaFragments.positive).toContain('long skirt');
    expect(elenaFragments.positive).not.toContain('should-not-inject');
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
      autoInjectOverride: null,
      appliesToTagsOverride: null,
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
