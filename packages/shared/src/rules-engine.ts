import type {
  ProjectRuleOverrideDto,
  ResolvedProjectRule,
  RulebookDto,
  RuleDto,
} from './stage2-schemas.js';

export interface ResolveRulesInput {
  attachedRulebooks: RulebookDto[];
  overrides: ProjectRuleOverrideDto[];
  projectCustomRules: RuleDto[];
}

export interface ResolvedRulesOutput {
  resolvedRules: ResolvedProjectRule[];
  activeRulesCount: number;
  mergedPositiveFragments: string;
  mergedNegativeFragments: string;
}

/**
 * Deterministically resolves the effective ruleset for a project by combining:
 * 1. Global rules from attached rulebooks
 * 2. Per-project overrides (e.g. overriding "5 doigts" -> "4 doigts" on a cartoon project)
 * 3. Project-specific custom rules
 */
export function resolveProjectRules(input: ResolveRulesInput): ResolvedRulesOutput {
  const overrideMap = new Map<string, ProjectRuleOverrideDto>();
  for (const ov of input.overrides) {
    overrideMap.set(ov.ruleId, ov);
  }

  const resolved: ResolvedProjectRule[] = [];

  for (const book of input.attachedRulebooks) {
    const sortedRules = [...book.rules].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
    for (const rule of sortedRules) {
      const ov = overrideMap.get(rule.id);
      const isOverridden = Boolean(
        ov &&
          (ov.enabledOverride !== null ||
            ov.severityOverride !== null ||
            ov.valueOverride !== null ||
            ov.instructionOverride !== null ||
            ov.positiveFragmentOverride !== null ||
            ov.negativeFragmentOverride !== null),
      );

      resolved.push({
        ruleId: rule.id,
        code: rule.code,
        title: rule.title,
        category: rule.category,
        severity: ov?.severityOverride ?? rule.severity,
        value: ov?.valueOverride ?? rule.defaultValue,
        instruction: ov?.instructionOverride ?? rule.instruction,
        positiveFragment: ov?.positiveFragmentOverride ?? rule.positiveFragment,
        negativeFragment: ov?.negativeFragmentOverride ?? rule.negativeFragment,
        enabled: ov?.enabledOverride ?? rule.enabled,
        source: isOverridden ? 'override' : 'rulebook',
        rulebookName: book.name,
        isOverridden,
      });
    }
  }

  const sortedCustom = [...input.projectCustomRules].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
  for (const custom of sortedCustom) {
    resolved.push({
      ruleId: custom.id,
      code: custom.code,
      title: custom.title,
      category: custom.category,
      severity: custom.severity,
      value: custom.defaultValue,
      instruction: custom.instruction,
      positiveFragment: custom.positiveFragment,
      negativeFragment: custom.negativeFragment,
      enabled: custom.enabled,
      source: 'project_custom',
      rulebookName: null,
      isOverridden: false,
    });
  }

  const activeRules = resolved.filter((r) => r.enabled);
  const posFragments = uniqueNonEmpty(activeRules.map((r) => r.positiveFragment));
  const negFragments = uniqueNonEmpty(activeRules.map((r) => r.negativeFragment));

  return {
    resolvedRules: resolved,
    activeRulesCount: activeRules.length,
    mergedPositiveFragments: posFragments.join(', '),
    mergedNegativeFragments: negFragments.join(', '),
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const val of values) {
    const trimmed = val.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Extracts all unique `{{variable_name}}` placeholders from template strings.
 */
export function extractTemplateVariables(...templates: string[]): string[] {
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  for (const tpl of templates) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(tpl)) !== null) {
      if (match[1]) found.add(match[1]);
    }
  }
  return Array.from(found);
}

export interface RenderPromptInput {
  positiveTemplate: string;
  negativeTemplate?: string;
  variables?: Record<string, string>;
  defaults?: Record<string, string>;
  rulePositiveFragments?: string;
  ruleNegativeFragments?: string;
}

export interface RenderedPromptResult {
  positive: string;
  negative: string;
  missingVariables: string[];
}

/**
 * Renders a prompt template by substituting `{{var}}` values and optionally
 * appending active project rule positive/negative fragments.
 */
export function renderPromptTemplate(input: RenderPromptInput): RenderedPromptResult {
  const values = { ...(input.defaults ?? {}), ...(input.variables ?? {}) };
  const missing = new Set<string>();

  const replaceVars = (tpl: string): string =>
    tpl.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_full, key: string) => {
      const val = values[key];
      if (val === undefined || val === '') {
        missing.add(key);
        return `{{${key}}}`;
      }
      return val;
    });

  const basePos = replaceVars(input.positiveTemplate).trim();
  const baseNeg = replaceVars(input.negativeTemplate ?? '').trim();

  const positive = [basePos, input.rulePositiveFragments?.trim() ?? '']
    .filter(Boolean)
    .join(', ');

  const negative = [baseNeg, input.ruleNegativeFragments?.trim() ?? '']
    .filter(Boolean)
    .join(', ');

  return {
    positive,
    negative,
    missingVariables: Array.from(missing),
  };
}
