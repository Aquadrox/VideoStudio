import type {
  KnowledgeKind,
  KnowledgePriority,
  KnowledgeProjectType,
  ProjectPlaybookDto,
  StudioKnowledgeEntryDto,
} from './knowledge-schemas.js';

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  rule: 'Règle',
  prompt: 'Prompt',
  skill: 'Skill / Procédure',
  lesson: 'Leçon / Retour XP',
  preset: 'Preset Technique',
};

export const KNOWLEDGE_PROJECT_TYPE_LABELS: Record<KnowledgeProjectType, string> = {
  all: 'Tous les projets (Global)',
  youtube_long: 'YouTube Long',
  youtube_short: 'YouTube Short',
  music_video: 'Clip Musical',
  animation: 'Animation',
  commercial: 'Publicité / Commercial',
  experimental: 'Expérimental',
};

const PRIORITY_RANK: Record<KnowledgePriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Normalizes a knowledge slug from an arbitrary title.
 */
export function slugifyKnowledgeTitle(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `knowledge-${Date.now().toString(36)}`;
}

/**
 * Returns true if an entry scoped to `entryTypes` applies to `targetType`.
 */
export function matchesKnowledgeProjectType(
  entryTypes: KnowledgeProjectType[],
  targetType: KnowledgeProjectType,
): boolean {
  if (targetType === 'all') return true;
  if (entryTypes.includes('all')) return true;
  return entryTypes.includes(targetType);
}

/**
 * Sorts studio knowledge entries for recall: pinned -> verified -> priority -> usageCount -> updatedAt desc.
 */
export function sortKnowledgeEntries(entries: StudioKnowledgeEntryDto[]): StudioKnowledgeEntryDto[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    const pDiff = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/**
 * Groups entries by kind.
 */
export function groupKnowledgeByKind(
  entries: StudioKnowledgeEntryDto[],
): ProjectPlaybookDto['byKind'] {
  const out: ProjectPlaybookDto['byKind'] = {
    rule: [],
    prompt: [],
    skill: [],
    lesson: [],
    preset: [],
  };
  for (const e of entries) {
    out[e.kind].push(e);
  }
  return out;
}

/**
 * Compiles a concise, actionable Markdown brief for Claude Code or human directors
 * summarizing all recalled studio memory, rules, prompts, skills, and lessons for a project type.
 */
export function compileStudioPlaybookBrief(params: {
  projectType: KnowledgeProjectType;
  projectSlug: string | null;
  entries: StudioKnowledgeEntryDto[];
  rulebookCount: number;
  promptTemplateCount: number;
  workflowCount: number;
  skillSlugs: string[];
}): string {
  const lines: string[] = [];
  const typeLabel = KNOWLEDGE_PROJECT_TYPE_LABELS[params.projectType] ?? params.projectType;
  lines.push(`# Playbook Studio — ${typeLabel}${params.projectSlug ? ` (@proj-${params.projectSlug})` : ''}`);
  lines.push('');
  lines.push(
    `> ${params.entries.length} connaissance(s) rappelée(s) · ${params.rulebookCount} rulebook(s) · ${params.promptTemplateCount} template(s) prompt · ${params.workflowCount} workflow(s) ComfyUI · ${params.skillSlugs.length} skill(s)`,
  );
  lines.push('');

  const grouped = groupKnowledgeByKind(sortKnowledgeEntries(params.entries));
  const sections: Array<[KnowledgeKind, string]> = [
    ['rule', '## 1. Règles & Garde-fous à respecter'],
    ['lesson', '## 2. Leçons apprises & Retours d\'expérience'],
    ['prompt', '## 3. Recettes de Prompts validées'],
    ['preset', '## 4. Presets Techniques & Workflows'],
    ['skill', '## 5. Skills & Procédures recommandées'],
  ];

  for (const [kind, heading] of sections) {
    const items = grouped[kind];
    if (items.length === 0) continue;
    lines.push(heading);
    lines.push('');
    for (const item of items) {
      const badges = [
        item.priority === 'critical' ? 'CRITIQUE' : item.priority === 'high' ? 'HAUTE' : null,
        item.verified ? 'Vérifié' : null,
        item.pinned ? 'Épinglé' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      lines.push(`- **${item.title}**${badges ? ` [${badges}]` : ''} (\`${item.slug}\`)`);
      lines.push(`  ${item.content.replace(/\n+/g, '\n  ')}`);
      if (item.recommendedModel) {
        lines.push(`  - Modèle recommandé : \`${item.recommendedModel}\``);
      }
      if (item.positiveFragment) {
        lines.push(`  - Positif (+) : \`${item.positiveFragment}\``);
      }
      if (item.negativeFragment) {
        lines.push(`  - Négatif (-) : \`${item.negativeFragment}\``);
      }
      if (item.linkedSkillSlug) {
        lines.push(`  - Skill associé : \`${item.linkedSkillSlug}\``);
      }
    }
    lines.push('');
  }

  if (params.skillSlugs.length > 0) {
    lines.push('## Skills disponibles dans le studio');
    lines.push(params.skillSlugs.map((s) => `\`${s}\``).join(', '));
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}
