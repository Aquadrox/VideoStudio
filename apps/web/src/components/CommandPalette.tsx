import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CornerDownLeft, Keyboard, Search, X } from 'lucide-react';
import {
  filterCommandPaletteItems,
  type CommandPaletteSearchItem,
} from '@videostudio/shared';

export interface ExecutableCommandItem extends CommandPaletteSearchItem {
  category: 'action' | 'tab' | 'project' | 'asset';
  shortcut?: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  items: ExecutableCommandItem[];
  onClose: () => void;
}

const CATEGORY_LABELS: Record<ExecutableCommandItem['category'], string> = {
  action: 'Actions',
  tab: 'Modules',
  project: 'Projets',
  asset: 'Médias (@ref)',
};

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(
    () => filterCommandPaletteItems(items, query, 28),
    [items, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((idx) => (filtered.length === 0 ? 0 : (idx + 1) % filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((idx) =>
        filtered.length === 0 ? 0 : (idx - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) {
        onClose();
        target.onSelect();
      }
    }
  };

  return (
    <div className="modal-backdrop command-palette-backdrop" onClick={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-label="Palette de commandes"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-input-row">
          <Search size={16} color="var(--accent-amber)" />
          <input
            ref={inputRef}
            className="command-palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Aller à un projet, module, média (@img-001) ou action (backup, rendu)..."
          />
          <kbd className="kbd-badge">ESC</kbd>
        </div>

        <div className="command-palette-list">
          {filtered.length === 0 ? (
            <div className="command-palette-empty">
              Aucun résultat pour « {query} »
            </div>
          ) : (
            filtered.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                className={`command-palette-item ${idx === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  onClose();
                  item.onSelect();
                }}
              >
                <span className={`command-cat-pill cat-${item.category}`}>
                  {CATEGORY_LABELS[item.category]}
                </span>
                <div className="command-palette-item-text">
                  <span className="command-palette-item-title">{item.label}</span>
                  {item.subtitle && (
                    <span className="command-palette-item-sub">{item.subtitle}</span>
                  )}
                </div>
                {item.shortcut ? (
                  <kbd className="kbd-badge">{item.shortcut}</kbd>
                ) : idx === activeIndex ? (
                  <CornerDownLeft size={13} color="var(--accent-amber)" />
                ) : null}
              </button>
            ))
          )}
        </div>

        <div className="command-palette-footer">
          <span>
            <Command size={11} style={{ verticalAlign: 'middle' }} /> ↑↓ naviguer · ↵ ouvrir · ? raccourcis
          </span>
          <span>{filtered.length} résultat(s)</span>
        </div>
      </div>
    </div>
  );
}

interface ShortcutsHelpModalProps {
  onClose: () => void;
}

const SHORTCUT_GROUPS: Array<{
  title: string;
  items: Array<{ keys: string[]; label: string }>;
}> = [
  {
    title: 'Navigation & Palette',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Ouvrir la Palette de commandes (⌘K sur macOS)' },
      { keys: ['?'], label: 'Afficher / masquer cette aide des raccourcis' },
      { keys: ['Esc'], label: 'Fermer la modale ou la lightbox ouverte' },
    ],
  },
  {
    title: 'Triage rapide (média sélectionné)',
    items: [
      { keys: ['A'], label: 'Approuver le média sélectionné (status = approved)' },
      { keys: ['R'], label: 'Marquer « À revoir » (status = needs_revision)' },
      { keys: ['1', '…', '5'], label: 'Attribuer une note de 1 à 5 étoiles' },
    ],
  },
  {
    title: 'Transport Vidéo Pro (lecteur actif)',
    items: [
      { keys: ['J'], label: 'Reculer d’1 seconde / ralentir la lecture' },
      { keys: ['K'], label: 'Pause / Lecture (vitesse 1x)' },
      { keys: ['L'], label: 'Lecture / accélérer (1x → 1.5x → 2x)' },
      { keys: ['←', '→'], label: 'Image par image (-1 / +1 frame à 24fps)' },
    ],
  },
];

export function ShortcutsHelpModal({ onClose }: ShortcutsHelpModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Keyboard size={18} color="var(--accent-amber)" /> Raccourcis Clavier Pro
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="section-label" style={{ marginBottom: 8 }}>
                {group.title}
              </div>
              <div className="shortcuts-list">
                {group.items.map((item) => (
                  <div key={item.label} className="shortcut-row">
                    <span>{item.label}</span>
                    <span className="shortcut-keys">
                      {item.keys.map((k, idx) => (
                        <kbd key={`${k}-${idx}`} className="kbd-badge">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
