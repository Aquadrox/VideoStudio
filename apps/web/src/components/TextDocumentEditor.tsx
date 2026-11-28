import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Bold,
  CheckSquare,
  Code,
  Columns2,
  Copy,
  Download,
  Eye,
  FileCode2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pencil,
  Quote,
  Replace,
  Save,
  Search,
  Strikethrough,
  Table2,
  WrapText,
  X,
} from 'lucide-react';
import {
  computeTextStats,
  detectLogLineLevel,
  getTextDocumentLanguage,
  renderMarkdownToSafeHtml,
  type AssetDto,
  type LogLineLevel,
  type MediaFolderDto,
  type TextDocumentLanguage,
} from '@videostudio/shared';
import { api } from '../api/client';
import { formatBytes } from '../utils/format';

const LANGUAGE_LABELS: Record<TextDocumentLanguage, string> = {
  markdown: 'Markdown (.md)',
  log: 'Journal Log (.log)',
  json: 'JSON',
  subtitles: 'Sous-titres / Paroles',
  yaml: 'Config (YAML/TOML/INI)',
  code: 'Code source',
  plaintext: 'Texte brut (.txt)',
};

type EditorViewMode = 'edit' | 'split' | 'preview';

/**
 * Compact or full rich preview for text documents:
 * - Markdown (.md): XSS-safe rendered HTML (headings, checklists, code blocks, tables, quotes)
 * - Logs (.log): color-coded lines by severity (ERROR / WARN / INFO / DEBUG) with optional filter
 * - Others (.txt, .json, .srt, .lrc, code): monospace numbered lines
 */
export function TextDocumentPreview({
  content,
  language,
  compact = false,
  logLevelFilter = 'all',
  logSearch = '',
  wordWrap = true,
}: {
  content: string;
  language: TextDocumentLanguage;
  compact?: boolean;
  logLevelFilter?: 'all' | LogLineLevel;
  logSearch?: string;
  wordWrap?: boolean;
}) {
  const renderedMd = useMemo(() => {
    if (language !== 'markdown') return '';
    return renderMarkdownToSafeHtml(content);
  }, [content, language]);

  const lines = useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content]);

  if (language === 'markdown') {
    return (
      <div
        className={`text-doc-md-preview ${compact ? 'compact' : ''}`}
        dangerouslySetInnerHTML={{
          __html:
            renderedMd ||
            '<p class="muted">Document Markdown vide — commence à écrire pour voir le rendu enrichi.</p>',
        }}
      />
    );
  }

  if (language === 'log') {
    const query = logSearch.trim().toLowerCase();
    const visibleLines = lines
      .map((line, idx) => ({ num: idx + 1, line, level: detectLogLineLevel(line) }))
      .filter((entry) => {
        if (logLevelFilter !== 'all' && entry.level !== logLevelFilter) return false;
        if (query && !entry.line.toLowerCase().includes(query)) return false;
        return true;
      });
    const displayLines = compact ? visibleLines.slice(0, 80) : visibleLines;

    return (
      <div className={`text-doc-log-viewer ${compact ? 'compact' : ''} ${wordWrap ? 'wrap' : ''}`}>
        {displayLines.length === 0 ? (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>
            Aucune ligne ne correspond au filtre.
          </div>
        ) : (
          displayLines.map((entry) => (
            <div key={entry.num} className={`log-line level-${entry.level}`}>
              <span className="log-lineno">{entry.num}</span>
              <span className="log-text">{entry.line || ' '}</span>
            </div>
          ))
        )}
      </div>
    );
  }

  const displayLines = compact ? lines.slice(0, 80) : lines;
  return (
    <div className={`text-doc-code-viewer ${compact ? 'compact' : ''} ${wordWrap ? 'wrap' : ''}`}>
      {displayLines.map((line, idx) => (
        <div key={idx} className="code-line">
          <span className="log-lineno">{idx + 1}</span>
          <span className="log-text">{line || ' '}</span>
        </div>
      ))}
    </div>
  );
}

export interface TextDocumentEditorModalProps {
  /** Existing asset to edit, or null when creating a brand-new text file */
  asset: AssetDto | null;
  projectId: string;
  folders: MediaFolderDto[];
  defaultFolderPath?: string;
  onClose: () => void;
  onSaved: (savedAsset: AssetDto, isNew: boolean) => void;
  onCopyText: (text: string, label?: string) => void;
  onNotify: (msg: string) => void;
}

export function TextDocumentEditorModal({
  asset,
  projectId,
  folders,
  defaultFolderPath = '',
  onClose,
  onSaved,
  onCopyText,
  onNotify,
}: TextDocumentEditorModalProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const isCreating = asset === null;

  const [loading, setLoading] = useState(!isCreating);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [filename, setFilename] = useState(asset?.originalFilename ?? 'notes-scene.md');
  const [title, setTitle] = useState(asset?.title ?? 'Notes de scène');
  const [folderPath, setFolderPath] = useState(asset?.folderPath ?? defaultFolderPath);
  const [content, setContent] = useState(
    isCreating
      ? '# Notes de production\n\n- [ ] Valider le découpage\n- [ ] Vérifier les prompts ComfyUI\n'
      : '',
  );
  const [originalContent, setOriginalContent] = useState('');
  const [isExternalRef, setIsExternalRef] = useState(false);
  const [saveMode, setSaveMode] = useState<'in_place' | 'new_version'>('in_place');

  const language = useMemo(
    () => getTextDocumentLanguage(filename, asset?.mimeType),
    [filename, asset?.mimeType],
  );

  const [viewMode, setViewMode] = useState<EditorViewMode>(() => {
    const lang = getTextDocumentLanguage(asset?.originalFilename ?? 'notes-scene.md', asset?.mimeType);
    if (lang === 'markdown') return 'split';
    if (lang === 'log' && !isCreating) return 'preview';
    return 'edit';
  });

  const [wordWrap, setWordWrap] = useState(true);
  const [showFindBar, setShowFindBar] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | LogLineLevel>('all');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const stats = useMemo(() => computeTextStats(content), [content]);
  const isDirty = isCreating ? content.trim().length > 0 : content !== originalContent;

  const logCounts = useMemo(() => {
    if (language !== 'log') return { error: 0, warn: 0, info: 0 };
    let error = 0;
    let warn = 0;
    let info = 0;
    for (const line of content.split(/\r?\n/)) {
      const lv = detectLogLineLevel(line);
      if (lv === 'error') error += 1;
      else if (lv === 'warn') warn += 1;
      else if (lv === 'info') info += 1;
    }
    return { error, warn, info };
  }, [content, language]);

  const folderSuggestions = useMemo(() => {
    const set = new Set<string>(['notes', 'scripts', 'logs', 'prompts']);
    if (defaultFolderPath) set.add(defaultFolderPath);
    for (const f of folders) {
      if (f.path) set.add(f.path);
    }
    return [...set].sort();
  }, [folders, defaultFolderPath]);

  // Load existing asset content from server
  useEffect(() => {
    if (!asset) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    void api
      .getAssetTextContent(asset.id)
      .then((res) => {
        if (!active) return;
        setContent(res.content);
        setOriginalContent(res.content);
        setIsExternalRef(res.isExternalReference);
        if (res.isExternalReference) {
          setSaveMode('new_version');
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : 'Impossible de charger le fichier texte');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [asset]);

  const handleSave = useCallback(async () => {
    if (saving || loading) return;
    setSaving(true);
    try {
      if (isCreating) {
        const cleanFile = filename.trim() || 'document.md';
        const created = await api.createTextDocument(projectId, {
          filename: cleanFile,
          content,
          title: title.trim() || cleanFile,
          folderPath: folderPath.trim(),
        });
        setOriginalContent(content);
        onSaved(created, true);
        onNotify(`Document créé dans Médias : ${created.handle} (${created.originalFilename})`);
      } else if (asset) {
        const res = await api.updateAssetTextContent(asset.id, {
          content,
          saveMode: isExternalRef ? 'new_version' : saveMode,
          title: title.trim() || asset.title,
        });
        setOriginalContent(content);
        onSaved(res.asset, res.savedMode === 'new_version');
        onNotify(
          res.savedMode === 'new_version'
            ? `Nouvelle version enregistrée : ${res.asset.handle}`
            : `Document enregistré : ${res.asset.handle}`,
        );
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Échec de l’enregistrement');
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    loading,
    isCreating,
    filename,
    projectId,
    content,
    title,
    folderPath,
    asset,
    isExternalRef,
    saveMode,
    onSaved,
    onNotify,
  ]);

  // Global modal shortcuts: Ctrl/Cmd+S to save, Ctrl/Cmd+F to open find bar, Escape to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowFindBar(true);
      } else if (e.key === 'Escape') {
        if (showFindBar) {
          e.preventDefault();
          setShowFindBar(false);
        } else {
          e.preventDefault();
          if (!isDirty || window.confirm('Fermer sans enregistrer les modifications ?')) {
            onClose();
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave, showFindBar, isDirty, onClose]);

  // Rich Markdown toolbar helpers
  const wrapSelection = (before: string, after = '', placeholder = 'texte') => {
    const el = textareaRef.current;
    if (!el) {
      setContent((prev) => `${prev}${before}${placeholder}${after}`);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const el = textareaRef.current;
    if (!el) {
      setContent((prev) => `${prev}\n${prefix}`);
      return;
    }
    const start = el.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const next = `${content.slice(0, lineStart)}${prefix}${content.slice(lineStart)}`;
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const handleTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${content.slice(0, start)}  ${content.slice(end)}`;
      setContent(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 2, start + 2);
      });
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
      setJsonError(null);
      onNotify('JSON valide et formaté');
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'JSON invalide');
    }
  };

  const findMatchCount = useMemo(() => {
    const q = findQuery.trim();
    if (!q) return 0;
    const lower = content.toLowerCase();
    const target = q.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = lower.indexOf(target, idx)) !== -1) {
      count += 1;
      idx += target.length;
    }
    return count;
  }, [content, findQuery]);

  const handleReplaceAll = () => {
    if (!findQuery) return;
    const escaped = findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = content.replace(new RegExp(escaped, 'gi'), replaceQuery);
    setContent(next);
    onNotify(`${findMatchCount} occurrence(s) remplacée(s)`);
  };

  const handleDownloadLocal = () => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'document.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const lineCount = Math.max(1, stats.lines);

  return (
    <div
      className="lightbox-backdrop text-editor-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Éditeur de texte — ${title || filename}`}
      onClick={() => {
        if (!isDirty || window.confirm('Fermer sans enregistrer les modifications ?')) {
          onClose();
        }
      }}
    >
      <div className="text-editor-shell" onClick={(e) => e.stopPropagation()}>
        {/* Header Bar */}
        <header className="text-editor-header">
          <div className="text-editor-title-block">
            <FileText size={16} color="var(--accent-amber, #e5a038)" />
            {isCreating ? (
              <div className="text-editor-create-fields">
                <input
                  className="input input-sm"
                  value={filename}
                  onChange={(e) => {
                    setFilename(e.target.value);
                    if (!title || title === filename) setTitle(e.target.value);
                  }}
                  placeholder="notes.md / script.txt / debug.log"
                  style={{ width: 195 }}
                  aria-label="Nom du fichier"
                />
                <input
                  className="input input-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titre dans Médias"
                  style={{ width: 180 }}
                  aria-label="Titre du document"
                />
                <input
                  className="input input-sm"
                  list="text-doc-folders"
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="Dossier (ex: notes)"
                  style={{ width: 135 }}
                  aria-label="Dossier de destination"
                />
                <datalist id="text-doc-folders">
                  {folderSuggestions.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
            ) : (
              <>
                <strong className="text-editor-title">{asset.originalFilename}</strong>
                <button
                  type="button"
                  className="ref-copy-btn"
                  onClick={() => onCopyText(asset.handle, `Référence ${asset.handle}`)}
                >
                  <Copy size={11} /> {asset.handle}
                </button>
              </>
            )}
            <span className="pill-tag">{LANGUAGE_LABELS[language]}</span>
            {isDirty && <span className="text-editor-dirty-dot">● Non enregistré</span>}
          </div>

          <div className="text-editor-header-actions">
            {/* View Mode Switcher */}
            <div className="sketch-mode-switch" role="group" aria-label="Mode d'affichage">
              <button
                type="button"
                className={`btn btn-xs ${viewMode === 'edit' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setViewMode('edit')}
                title="Mode édition seule"
              >
                <Pencil size={12} /> Éditer
              </button>
              <button
                type="button"
                className={`btn btn-xs ${viewMode === 'split' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setViewMode('split')}
                title="Édition + Aperçu enrichi côte à côte"
              >
                <Columns2 size={12} /> Split
              </button>
              <button
                type="button"
                className={`btn btn-xs ${viewMode === 'preview' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setViewMode('preview')}
                title="Mode lecture enrichie"
              >
                <Eye size={12} /> Lecture
              </button>
            </div>

            {!isCreating && !isExternalRef && (
              <select
                className="input input-sm"
                value={saveMode}
                onChange={(e) => setSaveMode(e.target.value as 'in_place' | 'new_version')}
                title="Mode de sauvegarde"
                style={{ width: 135 }}
              >
                <option value="in_place">Enregistrer sur place</option>
                <option value="new_version">Nouvelle version (v2)</option>
              </select>
            )}

            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void handleSave()}
              disabled={saving || loading || Boolean(loadError)}
              title="Enregistrer (Ctrl+S)"
            >
              <Save size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (!isDirty || window.confirm('Fermer sans enregistrer les modifications ?')) {
                  onClose();
                }
              }}
              aria-label="Fermer l'éditeur"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* External Read-Only Notice */}
        {isExternalRef && (
          <div className="text-editor-notice">
            Fichier externe référencé en lecture seule — la sauvegarde créera automatiquement une{' '}
            <strong>nouvelle version gérée (v2)</strong> dans VideoStudio sans modifier le fichier
            d’origine sur l’hôte.
          </div>
        )}

        {/* Rich Formatting & Tools Toolbar */}
        <div className="text-editor-toolbar">
          <div className="text-editor-tool-group">
            {(language === 'markdown' || language === 'plaintext') && viewMode !== 'preview' && (
              <>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('# ')}
                  title="Titre 1"
                >
                  <Heading1 size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('## ')}
                  title="Titre 2"
                >
                  <Heading2 size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('### ')}
                  title="Titre 3"
                >
                  <Heading3 size={14} />
                </button>
                <span className="toolbar-sep" />
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('**', '**', 'gras')}
                  title="Gras"
                >
                  <Bold size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('*', '*', 'italique')}
                  title="Italique"
                >
                  <Italic size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('~~', '~~', 'barré')}
                  title="Barré"
                >
                  <Strikethrough size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('`', '`', 'code')}
                  title="Code inline"
                >
                  <Code size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('\n```\n', '\n```\n', 'bloc de code')}
                  title="Bloc de code"
                >
                  <FileCode2 size={13} />
                </button>
                <span className="toolbar-sep" />
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('- ')}
                  title="Liste à puces"
                >
                  <List size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('1. ')}
                  title="Liste numérotée"
                >
                  <ListOrdered size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('- [ ] ')}
                  title="Liste de tâches (Checklist)"
                >
                  <CheckSquare size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => insertLinePrefix('> ')}
                  title="Citation"
                >
                  <Quote size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() =>
                    wrapSelection(
                      '\n| Colonne 1 | Colonne 2 |\n| --- | --- |\n| ',
                      ' | Valeur |\n',
                      'Valeur',
                    )
                  }
                  title="Insérer un tableau Markdown"
                >
                  <Table2 size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('[', '](https://)', 'lien')}
                  title="Insérer un lien"
                >
                  <LinkIcon size={13} />
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-ghost"
                  onClick={() => wrapSelection('\n---\n', '', '')}
                  title="Séparateur horizontal"
                >
                  <Minus size={13} />
                </button>
              </>
            )}

            {language === 'json' && (
              <button
                type="button"
                className="btn btn-xs btn-secondary"
                onClick={handleFormatJson}
              >
                <FileCode2 size={13} /> Formater & Valider JSON
              </button>
            )}

            {language === 'log' && (
              <div className="chip-row" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className={`chip-btn ${logLevelFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setLogLevelFilter('all')}
                >
                  Tous ({stats.lines})
                </button>
                <button
                  type="button"
                  className={`chip-btn log-chip-error ${logLevelFilter === 'error' ? 'active' : ''}`}
                  onClick={() => setLogLevelFilter('error')}
                >
                  ERROR ({logCounts.error})
                </button>
                <button
                  type="button"
                  className={`chip-btn log-chip-warn ${logLevelFilter === 'warn' ? 'active' : ''}`}
                  onClick={() => setLogLevelFilter('warn')}
                >
                  WARN ({logCounts.warn})
                </button>
                <button
                  type="button"
                  className={`chip-btn log-chip-info ${logLevelFilter === 'info' ? 'active' : ''}`}
                  onClick={() => setLogLevelFilter('info')}
                >
                  INFO ({logCounts.info})
                </button>
              </div>
            )}
          </div>

          <div className="text-editor-tool-group">
            <button
              type="button"
              className={`btn btn-xs ${showFindBar ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setShowFindBar((v) => !v)}
              title="Rechercher / Remplacer (Ctrl+F)"
            >
              <Search size={13} /> Chercher
            </button>
            <button
              type="button"
              className={`btn btn-xs ${wordWrap ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setWordWrap((v) => !v)}
              title="Retour à la ligne automatique"
            >
              <WrapText size={13} /> Wrap
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => onCopyText(content, 'Contenu du document copié')}
              title="Copier tout le texte"
            >
              <Copy size={13} /> Copier
            </button>
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={handleDownloadLocal}
              title="Télécharger le fichier"
            >
              <Download size={13} />
            </button>
          </div>
        </div>

        {/* Find & Replace Bar */}
        {showFindBar && (
          <div className="text-editor-findbar">
            <Search size={13} className="muted" />
            <input
              className="input input-sm"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Rechercher (filtre aussi les logs en mode Lecture)..."
              autoFocus
              style={{ width: 240 }}
            />
            <span className="mono muted" style={{ fontSize: 11 }}>
              {findQuery ? `${findMatchCount} résultat(s)` : ''}
            </span>
            {viewMode !== 'preview' && (
              <>
                <Replace size={13} className="muted" />
                <input
                  className="input input-sm"
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  placeholder="Remplacer par..."
                  style={{ width: 180 }}
                />
                <button
                  type="button"
                  className="btn btn-xs btn-secondary"
                  disabled={!findQuery || findMatchCount === 0}
                  onClick={handleReplaceAll}
                >
                  Tout remplacer
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-xs btn-ghost"
              onClick={() => setShowFindBar(false)}
              style={{ marginLeft: 'auto' }}
            >
              <X size={13} />
            </button>
          </div>
        )}

        {jsonError && (
          <div className="text-editor-error-banner">
            Erreur JSON : {jsonError}
          </div>
        )}

        {/* Main Editor / Split / Preview Body */}
        <div className={`text-editor-body mode-${viewMode}`}>
          {loading ? (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <p>Chargement du document texte…</p>
            </div>
          ) : loadError ? (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <h3>Impossible d’ouvrir ce fichier</h3>
              <p>{loadError}</p>
            </div>
          ) : (
            <>
              {viewMode !== 'preview' && (
                <div className="text-editor-pane editor-pane">
                  <div className="text-editor-gutter" ref={gutterRef} aria-hidden="true">
                    {Array.from({ length: lineCount }, (_, i) => (
                      <div key={i} className="gutter-line">
                        {i + 1}
                      </div>
                    ))}
                  </div>
                  <textarea
                    ref={textareaRef}
                    className={`text-editor-textarea ${wordWrap ? 'wrap' : 'nowrap'}`}
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value);
                      if (jsonError) setJsonError(null);
                    }}
                    onKeyDown={handleTextareaKeyDown}
                    onScroll={(e) => {
                      if (gutterRef.current) {
                        gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                      }
                    }}
                    spellCheck={language === 'markdown' || language === 'plaintext'}
                    placeholder="Commence à écrire ici..."
                  />
                </div>
              )}

              {viewMode !== 'edit' && (
                <div className="text-editor-pane preview-pane">
                  <TextDocumentPreview
                    content={content}
                    language={language}
                    logLevelFilter={logLevelFilter}
                    logSearch={findQuery}
                    wordWrap={wordWrap}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Status Footer Bar */}
        <footer className="text-editor-footer">
          <div className="text-editor-stats">
            <span>{stats.lines} ligne(s)</span>
            <span>·</span>
            <span>{stats.words} mot(s)</span>
            <span>·</span>
            <span>{stats.characters} car.</span>
            <span>·</span>
            <span>{formatBytes(stats.bytes)}</span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            UTF-8 · <kbd>Ctrl+S</kbd> Enregistrer · <kbd>Ctrl+F</kbd> Chercher · <kbd>Échap</kbd>{' '}
            Fermer
          </div>
        </footer>
      </div>
    </div>
  );
}
