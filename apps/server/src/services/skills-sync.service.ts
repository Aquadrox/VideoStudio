import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { resolveSafePath } from '../utils/security.js';

/**
 * Formats a Claude Code skill into canonical SKILL.md format with YAML frontmatter.
 */
export function formatSkillMarkdown(params: {
  slug: string;
  description: string;
  content: string;
}): string {
  const trimmed = params.content.trim();
  if (trimmed.startsWith('---')) {
    return `${trimmed}\n`;
  }
  const safeDesc = params.description.replace(/\r?\n/g, ' ').replace(/"/g, '\\"').trim();
  return `---\nname: ${params.slug}\ndescription: "${safeDesc}"\n---\n\n${trimmed}\n`;
}

export class SkillsSyncService {
  constructor(private readonly config: AppConfig) {}

  async syncSkillToDisk(params: {
    slug: string;
    description: string;
    content: string;
    syncEnabled: boolean;
  }): Promise<string | null> {
    if (!params.syncEnabled) {
      return null;
    }

    if (!/^[a-z0-9-]+$/.test(params.slug)) {
      throw new Error('Invalid skill slug for disk sync');
    }

    const skillDir = resolveSafePath(this.config.skillsSyncDir, params.slug);
    const skillFile = resolveSafePath(skillDir, 'SKILL.md');

    await fs.mkdir(skillDir, { recursive: true });
    const markdown = formatSkillMarkdown({
      slug: params.slug,
      description: params.description,
      content: params.content,
    });
    await fs.writeFile(skillFile, markdown, 'utf8');
    return path.join(params.slug, 'SKILL.md');
  }

  async removeSkillFromDisk(slug: string): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(slug)) return;
    try {
      const skillDir = resolveSafePath(this.config.skillsSyncDir, slug);
      await fs.rm(skillDir, { recursive: true, force: true });
    } catch {
      // Ignore missing directory
    }
  }
}
