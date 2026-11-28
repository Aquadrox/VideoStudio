import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderPlus,
  Loader2,
  Printer,
  X,
} from 'lucide-react';
import type { ProductionDossierLayout, ProductionDossierOptions, ProjectDto } from '@videostudio/shared';
import { api } from '../api/client';

interface ProductionDossierModalProps {
  project: ProjectDto;
  onClose: () => void;
  onNotify: (msg: string) => void;
  onAssetSaved?: () => void;
}

export function ProductionDossierModal({
  project,
  onClose,
  onNotify,
  onAssetSaved,
}: ProductionDossierModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [layout, setLayout] = useState<ProductionDossierLayout>('dossier');
  const [includeScript, setIncludeScript] = useState(true);
  const [includeBible, setIncludeBible] = useState(true);
  const [includeSketchBoard, setIncludeSketchBoard] = useState(true);
  const [includeStoryboard, setIncludeStoryboard] = useState(true);
  const [includePrompts, setIncludePrompts] = useState(true);
  const [includeBriefs, setIncludeBriefs] = useState(true);
  const [subtitle, setSubtitle] = useState('');
  const [director, setDirector] = useState('');
  const [savingFormat, setSavingFormat] = useState<'html' | 'markdown' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const options: Partial<ProductionDossierOptions> = useMemo(
    () => ({
      layout,
      includeScript,
      includeBible,
      includeSketchBoard,
      includeStoryboard,
      includePrompts,
      includeBriefs,
      subtitle: subtitle.trim() || undefined,
      director: director.trim() || undefined,
    }),
    [
      layout,
      includeScript,
      includeBible,
      includeSketchBoard,
      includeStoryboard,
      includePrompts,
      includeBriefs,
      subtitle,
      director,
    ],
  );

  const previewUrl = useMemo(
    () => api.getDossierUrl(project.id, 'html', options, { download: false, standalone: false }),
    [project.id, options],
  );
  const downloadHtmlUrl = useMemo(
    () => api.getDossierUrl(project.id, 'html', options, { download: true, standalone: true }),
    [project.id, options],
  );
  const downloadMdUrl = useMemo(
    () => api.getDossierUrl(project.id, 'markdown', options, { download: true, standalone: false }),
    [project.id, options],
  );

  const handlePrintPdf = () => {
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.focus();
      win.print();
      return;
    }
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleSaveToMedia = async (format: 'html' | 'markdown') => {
    setSavingFormat(format);
    try {
      const res = await api.saveDossierAsset(project.id, { ...options, format });
      onNotify(`Dossier enregistré dans Médias (/exports) : ${res.asset.handle}`);
      onAssetSaved?.();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde dossier');
    } finally {
      setSavingFormat(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card dossier-modal-shell"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Export Dossier de Production & Pitch Deck"
      >
        <div className="dossier-modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={18} color="var(--accent-amber)" />
            <div>
              <h2 style={{ margin: 0, fontSize: 15 }}>Dossier de Production &amp; Pitch Deck</h2>
              <span className="muted" style={{ fontSize: 11.5 }}>
                {project.name} · Export PDF natif, HTML autonome (images incluses) ou Markdown
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handlePrintPdf}>
              <Printer size={13} /> Imprimer / PDF
            </button>
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ textDecoration: 'none' }}
              title="Ouvrir dans un nouvel onglet"
            >
              <ExternalLink size={13} />
            </a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Fermer (Échap)">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="dossier-modal-body">
          {/* Left Configuration Sidebar */}
          <aside className="dossier-config-col">
            <div className="dossier-config-group">
              <label className="dossier-config-label">Mise en page</label>
              <div className="dossier-layout-toggle">
                <button
                  type="button"
                  className={`chip ${layout === 'dossier' ? 'active' : ''}`}
                  onClick={() => setLayout('dossier')}
                >
                  Dossier A4 (Portrait)
                </button>
                <button
                  type="button"
                  className={`chip ${layout === 'pitch_deck' ? 'active' : ''}`}
                  onClick={() => setLayout('pitch_deck')}
                >
                  Pitch Deck (Paysage)
                </button>
              </div>
            </div>

            <div className="dossier-config-group">
              <label className="dossier-config-label">Couverture (optionnel)</label>
              <input
                className="input"
                placeholder="Sous-titre / Logline..."
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
              <input
                className="input"
                placeholder="Réalisateur / Studio..."
                value={director}
                onChange={(e) => setDirector(e.target.value)}
              />
            </div>

            <div className="dossier-config-group">
              <label className="dossier-config-label">Sections incluses</label>
              <label className="dossier-check">
                <input
                  type="checkbox"
                  checked={includeBible}
                  onChange={(e) => setIncludeBible(e.target.checked)}
                />
                <span>Bible de continuité</span>
              </label>
              <label className="dossier-check">
                <input
                  type="checkbox"
                  checked={includeScript}
                  onChange={(e) => setIncludeScript(e.target.checked)}
                />
                <span>Scénario</span>
              </label>
              <label className="dossier-check">
                <input
                  type="checkbox"
                  checked={includeSketchBoard}
                  onChange={(e) => setIncludeSketchBoard(e.target.checked)}
                />
                <span>Planche Storyboard Croquis</span>
              </label>
              <label className="dossier-check">
                <input
                  type="checkbox"
                  checked={includeStoryboard}
                  onChange={(e) => setIncludeStoryboard(e.target.checked)}
                />
                <span>Découpage Technique Pré-prod</span>
              </label>
              <label className="dossier-check">
                <input
                  type="checkbox"
                  checked={includeBriefs}
                  onChange={(e) => setIncludeBriefs(e.target.checked)}
                />
                <span>Briefs Réalisateur IA</span>
              </label>
              <label className="dossier-check">
                <input
                  type="checkbox"
                  checked={includePrompts}
                  onChange={(e) => setIncludePrompts(e.target.checked)}
                />
                <span>Prompts &amp; LoRAs</span>
              </label>
            </div>

            <div className="dossier-config-group">
              <label className="dossier-config-label">Téléchargement &amp; Archivage</label>
              <button type="button" className="btn btn-primary btn-sm" onClick={handlePrintPdf}>
                <Printer size={13} /> Imprimer / Enregistrer en PDF
              </button>
              <a
                href={downloadHtmlUrl}
                download
                className="btn btn-secondary btn-sm"
                style={{ textDecoration: 'none', justifyContent: 'center' }}
              >
                <Download size={13} /> Télécharger .html autonome
              </a>
              <a
                href={downloadMdUrl}
                download
                className="btn btn-ghost btn-sm"
                style={{ textDecoration: 'none', justifyContent: 'center' }}
              >
                <FileCode2 size={13} /> Télécharger .md (Markdown)
              </a>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  disabled={savingFormat !== null}
                  onClick={() => void handleSaveToMedia('html')}
                  title="Archiver en HTML autonome dans Médias (/exports)"
                >
                  {savingFormat === 'html' ? <Loader2 size={12} className="task-spin" /> : <FolderPlus size={12} />}
                  → /exports (.html)
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  disabled={savingFormat !== null}
                  onClick={() => void handleSaveToMedia('markdown')}
                  title="Archiver en Markdown éditable dans Médias (/exports)"
                >
                  {savingFormat === 'markdown' ? <Loader2 size={12} className="task-spin" /> : <FolderPlus size={12} />}
                  → /exports (.md)
                </button>
              </div>
            </div>
          </aside>

          {/* Right Live Document Preview */}
          <div className="dossier-preview-col">
            <iframe
              ref={iframeRef}
              src={previewUrl}
              title="Aperçu Dossier de Production"
              className="dossier-preview-iframe"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
