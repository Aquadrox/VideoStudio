import { describe, expect, it } from 'vitest';
import {
  computeTextStats,
  detectLogLineLevel,
  getTextDocumentLanguage,
  isEditableTextFile,
  renderMarkdownToSafeHtml,
} from './text-document-utils.js';

describe('text-document-utils', () => {
  it('recognizes editable text formats (.md, .txt, .log, .json, .srt, etc.) and rejects binaries', () => {
    expect(isEditableTextFile('notes.md', 'text/markdown')).toBe(true);
    expect(isEditableTextFile('render.log', 'application/octet-stream')).toBe(true);
    expect(isEditableTextFile('prompts.txt')).toBe(true);
    expect(isEditableTextFile('workflow.json', 'application/json')).toBe(true);
    expect(isEditableTextFile('lyrics.lrc')).toBe(true);
    expect(isEditableTextFile('frame.png', 'image/png')).toBe(false);
    expect(isEditableTextFile('clip.mp4', 'video/mp4')).toBe(false);
  });

  it('infers document language accurately', () => {
    expect(getTextDocumentLanguage('README.md')).toBe('markdown');
    expect(getTextDocumentLanguage('comfy.log')).toBe('log');
    expect(getTextDocumentLanguage('data.json')).toBe('json');
    expect(getTextDocumentLanguage('subtitles.srt')).toBe('subtitles');
    expect(getTextDocumentLanguage('script.py')).toBe('code');
    expect(getTextDocumentLanguage('notes.txt')).toBe('plaintext');
  });

  it('computes accurate lines, words, characters, and UTF-8 bytes', () => {
    const stats = computeTextStats('Bonjour vidéo\nDeuxième ligne');
    expect(stats.lines).toBe(2);
    expect(stats.words).toBe(4);
    expect(stats.bytes).toBeGreaterThan(stats.characters);
  });

  it('detects log severity levels for .log highlighting', () => {
    expect(detectLogLineLevel('2026-11-27 [ERROR] ComfyUI OOM on node 14')).toBe('error');
    expect(detectLogLineLevel('WARNING: slow disk throughput')).toBe('warn');
    expect(detectLogLineLevel('[INFO] Render completed OK')).toBe('info');
    expect(detectLogLineLevel('DEBUG: seed=42')).toBe('debug');
    expect(detectLogLineLevel('plain message line')).toBe('plain');
  });

  it('renders Markdown richly while escaping HTML/XSS safely', () => {
    const html = renderMarkdownToSafeHtml(
      [
        '# Scène 01',
        '',
        'Texte **gras**, *italique*, `code` et <script>alert(1)</script>.',
        '- [x] Valider cadrage',
        '- [ ] Exporter PNG',
        '',
        '> Note réalisateur',
        '',
        '```json',
        '{"ok": true}',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<h1>Scène 01</h1>');
    expect(html).toContain('<strong>gras</strong>');
    expect(html).toContain('<em>italique</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('md-task-item checked');
    expect(html).toContain('<blockquote>Note réalisateur</blockquote>');
    expect(html).toContain('<pre class="md-code-block" data-lang="json">');
  });
});
