export type TextDocumentLanguage =
  | 'markdown'
  | 'log'
  | 'json'
  | 'subtitles'
  | 'yaml'
  | 'code'
  | 'plaintext';

export const TEXT_DOCUMENT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.text',
  '.log',
  '.out',
  '.err',
  '.json',
  '.jsonl',
  '.ndjson',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.env',
  '.srt',
  '.vtt',
  '.lrc',
  '.ass',
  '.sub',
  '.csv',
  '.tsv',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.fountain',
  '.prompt',
  '.prompts',
  '.nfo',
]);

export function getFileExtensionLower(filename: string): string {
  const clean = filename.trim();
  const lastDot = clean.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === clean.length - 1) return '';
  return clean.slice(lastDot).toLowerCase();
}

export function isEditableTextFile(filename: string, mimeType?: string): boolean {
  const lowerMime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (lowerMime.startsWith('text/')) return true;
  if (
    lowerMime === 'application/json' ||
    lowerMime === 'application/xml' ||
    lowerMime === 'application/javascript' ||
    lowerMime === 'application/x-yaml' ||
    lowerMime === 'application/yaml' ||
    lowerMime === 'application/x-sh'
  ) {
    return true;
  }
  const ext = getFileExtensionLower(filename);
  return TEXT_DOCUMENT_EXTENSIONS.has(ext);
}

export function getTextDocumentLanguage(
  filename: string,
  mimeType?: string,
): TextDocumentLanguage {
  const ext = getFileExtensionLower(filename);
  const lowerMime = (mimeType ?? '').toLowerCase();
  if (ext === '.md' || ext === '.markdown' || lowerMime.includes('markdown')) {
    return 'markdown';
  }
  if (ext === '.log' || ext === '.out' || ext === '.err') {
    return 'log';
  }
  if (ext === '.json' || ext === '.jsonl' || ext === '.ndjson' || lowerMime.includes('json')) {
    return 'json';
  }
  if (ext === '.srt' || ext === '.vtt' || ext === '.lrc' || ext === '.ass' || ext === '.sub') {
    return 'subtitles';
  }
  if (ext === '.yaml' || ext === '.yml' || ext === '.toml' || ext === '.ini') {
    return 'yaml';
  }
  if (
    [
      '.js',
      '.mjs',
      '.cjs',
      '.ts',
      '.tsx',
      '.jsx',
      '.py',
      '.sh',
      '.bash',
      '.zsh',
      '.sql',
      '.css',
      '.scss',
      '.html',
      '.htm',
      '.xml',
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'plaintext';
}

export interface TextDocumentStats {
  lines: number;
  words: number;
  characters: number;
  bytes: number;
}

export function computeTextStats(content: string): TextDocumentStats {
  const lines = content.length === 0 ? 1 : content.split(/\r?\n/).length;
  const trimmed = content.trim();
  const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
  const characters = content.length;
  const bytes = new TextEncoder().encode(content).byteLength;
  return { lines, words, characters, bytes };
}

export type LogLineLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain';

export function detectLogLineLevel(line: string): LogLineLevel {
  if (/\b(FATAL|ERROR|ERR|EXCEPTION|TRACEBACK|CRITICAL|FAIL(?:ED)?)\b/i.test(line)) {
    return 'error';
  }
  if (/\b(WARN(?:ING)?|DEPRECATED|CAUTION)\b/i.test(line)) {
    return 'warn';
  }
  if (/\b(INFO|OK|SUCCESS|DONE|READY|STARTED)\b/i.test(line)) {
    return 'info';
  }
  if (/\b(DEBUG|TRACE|VERBOSE)\b/i.test(line)) {
    return 'debug';
  }
  return 'plain';
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(raw: string): string {
  let html = escapeHtml(raw);
  // Inline code first so markers inside backticks aren't parsed
  const codeSpans: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_match, code: string) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${code}</code>`);
    return `@@CODESPAN_${idx}@@`;
  });

  // Safe links [label](https://...)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // Bold + italic
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Restore inline code spans
  html = html.replace(/@@CODESPAN_(\d+)@@/g, (_m, idxStr: string) => {
    return codeSpans[Number(idxStr)] ?? '';
  });
  return html;
}

/**
 * Lightweight, XSS-safe Markdown-to-HTML renderer for rich preview of `.md` files
 * (headings, bold/italic/strike, checklists, lists, blockquotes, fenced code blocks,
 * GFM tables, horizontal rules, safe external links). Zero runtime dependencies.
 */
export function renderMarkdownToSafeHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let inTable = false;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    // Fenced code blocks
    const fenceMatch = /^```([\w+-]*)\s*$/.exec(line.trim());
    if (fenceMatch) {
      closeList();
      closeTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = fenceMatch[1] ?? '';
        codeLines = [];
      } else {
        const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : '';
        out.push(`<pre class="md-code-block"${langAttr}><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        inCodeBlock = false;
        codeLang = '';
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      closeTable();
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      closeTable();
      out.push('<hr />');
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      closeTable();
      const level = headingMatch[1]!.length;
      out.push(`<h${level}>${renderInlineMarkdown(headingMatch[2]!)}</h${level}>`);
      continue;
    }

    // Blockquote
    const quoteMatch = /^>\s?(.*)$/.exec(trimmed);
    if (quoteMatch) {
      closeList();
      closeTable();
      out.push(`<blockquote>${renderInlineMarkdown(quoteMatch[1] ?? '')}</blockquote>`);
      continue;
    }

    // GFM Table
    if (trimmed.includes('|')) {
      const nextTrimmed = (lines[i + 1] ?? '').trim();
      const isHeaderSep =
        !inTable && /^\|?[\s:-]+\|[\s|:-]*$/.test(nextTrimmed);
      if (isHeaderSep) {
        closeList();
        const cells = trimmed
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => `<th>${renderInlineMarkdown(c.trim())}</th>`)
          .join('');
        out.push(`<table class="md-table"><thead><tr>${cells}</tr></thead><tbody>`);
        inTable = true;
        i += 1; // skip separator row
        continue;
      }
      if (inTable) {
        const cells = trimmed
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => `<td>${renderInlineMarkdown(c.trim())}</td>`)
          .join('');
        out.push(`<tr>${cells}</tr>`);
        continue;
      }
    } else {
      closeTable();
    }

    // Task checklist item
    const taskMatch = /^[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(trimmed);
    if (taskMatch) {
      closeTable();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul class="md-checklist">');
        listType = 'ul';
      }
      const checked = taskMatch[1]!.toLowerCase() === 'x';
      out.push(
        `<li class="md-task-item ${checked ? 'checked' : ''}"><span class="md-checkbox">${checked ? '☑' : '☐'}</span> ${renderInlineMarkdown(taskMatch[2]!)}</li>`,
      );
      continue;
    }

    // Unordered list
    const ulMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (ulMatch) {
      closeTable();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${renderInlineMarkdown(ulMatch[1]!)}</li>`);
      continue;
    }

    // Ordered list
    const olMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (olMatch) {
      closeTable();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${renderInlineMarkdown(olMatch[1]!)}</li>`);
      continue;
    }

    closeList();
    closeTable();
    out.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  if (inCodeBlock) {
    out.push(`<pre class="md-code-block"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }
  closeList();
  closeTable();

  return out.join('\n');
}
