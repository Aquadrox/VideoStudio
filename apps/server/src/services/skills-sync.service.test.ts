import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../config.js';
import { formatSkillMarkdown, SkillsSyncService } from './skills-sync.service.js';

describe('SkillsSyncService', () => {
  let tmpDir: string | null = null;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('adds YAML frontmatter when missing and preserves existing frontmatter', () => {
    const generated = formatSkillMarkdown({
      slug: 'comfy-upscale-4k',
      description: 'Upscale validated drafts to 4K',
      content: '# Steps\n1. Load video\n2. Run SeedVR2',
    });
    expect(generated).toContain('name: comfy-upscale-4k');
    expect(generated).toContain('description: "Upscale validated drafts to 4K"');
    expect(generated).toContain('# Steps');

    const alreadyFormatted = '---\nname: custom\ndescription: test\n---\nBody';
    expect(
      formatSkillMarkdown({ slug: 'custom', description: 'test', content: alreadyFormatted }),
    ).toBe(`${alreadyFormatted}\n`);
  });

  it('writes and deletes SKILL.md safely inside SKILLS_SYNC_DIR and rejects invalid slugs', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'videostudio-skills-'));
    const svc = new SkillsSyncService({ skillsSyncDir: tmpDir } as AppConfig);

    const relPath = await svc.syncSkillToDisk({
      slug: 'fix-hands-inpaint',
      description: 'Fix hand anatomy in ComfyUI',
      content: 'Use inpaint workflow with 5 fingers rule.',
      syncEnabled: true,
    });
    expect(relPath).toBe(path.join('fix-hands-inpaint', 'SKILL.md'));

    const written = await fs.readFile(path.join(tmpDir, 'fix-hands-inpaint', 'SKILL.md'), 'utf8');
    expect(written).toContain('name: fix-hands-inpaint');
    expect(written).toContain('5 fingers rule');

    await expect(
      svc.syncSkillToDisk({
        slug: '../escape',
        description: 'bad',
        content: 'bad',
        syncEnabled: true,
      }),
    ).rejects.toThrow(/Invalid skill slug/);

    await svc.removeSkillFromDisk('fix-hands-inpaint');
    await expect(fs.stat(path.join(tmpDir, 'fix-hands-inpaint'))).rejects.toThrow();
  });
});
