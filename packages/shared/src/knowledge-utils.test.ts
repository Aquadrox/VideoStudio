import { describe, expect, it } from 'vitest';
import type { StudioKnowledgeEntryDto } from './knowledge-schemas.js';
import {
  compileStudioPlaybookBrief,
  matchesKnowledgeProjectType,
  slugifyKnowledgeTitle,
  sortKnowledgeEntries,
} from './knowledge-utils.js';

function makeEntry(overrides: Partial<StudioKnowledgeEntryDto> = {}): StudioKnowledgeEntryDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'demo-entry',
    title: 'Règle démo',
    kind: 'rule',
    projectTypes: ['all'],
    priority: 'normal',
    content: 'Toujours vérifier la continuité lumière.',
    positiveFragment: '',
    negativeFragment: '',
    recommendedModel: '',
    linkedSkillSlug: null,
    tags: [],
    learnedBy: 'claude',
    verified: false,
    pinned: false,
    sourceProjectSlug: null,
    usageCount: 0,
    lastRecalledAt: null,
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('knowledge-utils', () => {
  it('slugifies French titles with accents cleanly', () => {
    expect(slugifyKnowledgeTitle('Règle 180° — Caméras & Éclairage !')).toBe('regle-180-cameras-eclairage');
  });

  it('matches global and specific project types accurately', () => {
    expect(matchesKnowledgeProjectType(['all'], 'animation')).toBe(true);
    expect(matchesKnowledgeProjectType(['animation', 'music_video'], 'animation')).toBe(true);
    expect(matchesKnowledgeProjectType(['youtube_short'], 'animation')).toBe(false);
    expect(matchesKnowledgeProjectType(['youtube_short'], 'all')).toBe(true);
  });

  it('sorts pinned, verified, critical, and high-usage entries first', () => {
    const low = makeEntry({ id: 'a', slug: 'low', priority: 'low', usageCount: 10 });
    const crit = makeEntry({ id: 'b', slug: 'crit', priority: 'critical', verified: true });
    const pinned = makeEntry({ id: 'c', slug: 'pinned', priority: 'normal', pinned: true });

    const sorted = sortKnowledgeEntries([low, crit, pinned]);
    expect(sorted.map((x) => x.slug)).toEqual(['pinned', 'crit', 'low']);
  });

  it('compiles a Markdown Playbook brief containing sections and fragments', () => {
    const brief = compileStudioPlaybookBrief({
      projectType: 'animation',
      projectSlug: 'ombre-taverne',
      entries: [
        makeEntry({
          slug: 'hands-5-fingers',
          title: 'Mains 5 doigts naturels',
          kind: 'rule',
          priority: 'critical',
          verified: true,
          positiveFragment: 'natural 5 fingers',
          negativeFragment: 'extra fingers',
        }),
        makeEntry({
          slug: 'wan-i2v-cfg',
          title: 'Wan 2.1 CFG optimal',
          kind: 'lesson',
          content: 'Garder CFG entre 5.0 et 6.0 pour éviter les artefacts de visage.',
          recommendedModel: 'wan2.1_i2v_720p',
        }),
      ],
      rulebookCount: 1,
      promptTemplateCount: 3,
      workflowCount: 2,
      skillSlugs: ['comfy-director'],
    });

    expect(brief).toContain('# Playbook Studio — Animation (@proj-ombre-taverne)');
    expect(brief).toContain('## 1. Règles & Garde-fous à respecter');
    expect(brief).toContain('Mains 5 doigts naturels');
    expect(brief).toContain('extra fingers');
    expect(brief).toContain('## 2. Leçons apprises');
    expect(brief).toContain('wan2.1_i2v_720p');
    expect(brief).toContain('`comfy-director`');
  });
});
