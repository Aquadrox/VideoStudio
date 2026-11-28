import { useMemo, useState } from 'react';
import {
  Bot,
  Film,
  Image as ImageIcon,
  Music,
  Pencil,
  Plus,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  User,
  Wand2,
  X,
} from 'lucide-react';
import {
  TIMELINE_TRANSITION_META,
  validateFfmpegFilterTemplate,
  type AssetDto,
  type ClipTextOverlay,
  type CreateVideoEffectInput,
  type EffectParamSpec,
  type TimelineTransition,
  type VideoEffectCategory,
  type VideoEffectDto,
} from '@videostudio/shared';
import { api } from '../api/client';

export type CapCutResourceTab = 'media' | 'effects' | 'transitions' | 'text';

interface EffectsLibraryDrawerProps {
  assets: AssetDto[];
  effects: VideoEffectDto[];
  selectedClipId: string | null;
  selectedClipTitle: string | null;
  onDropAssetToTrack: (asset: AssetDto, trackType: 'video' | 'overlay' | 'audio') => void;
  onApplyEffectToClip: (effect: VideoEffectDto) => void;
  onApplyTransitionToClip: (transition: TimelineTransition) => void;
  onDropTextPreset: (title: string, overlay: ClipTextOverlay) => void;
  onEffectsChanged: () => void;
  onNotify: (msg: string) => void;
}

const EFFECT_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Tous' },
  { value: 'video_fx', label: 'Vidéo FX' },
  { value: 'color_grade', label: 'Couleur' },
  { value: 'motion', label: 'Motion' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'audio_fx', label: 'Audio FX' },
];

const TEXT_PRESETS: Array<{ name: string; desc: string; overlay: ClipTextOverlay }> = [
  {
    name: 'Titre Cinéma',
    desc: 'Grand titre centré bold avec halo sombre',
    overlay: {
      text: 'TITRE DU FILM',
      fontSize: 64,
      color: '#FFFFFF',
      bgColor: '#000000',
      bgOpacity: 0.35,
      x: 50,
      y: 50,
      bold: true,
      animation: 'fade',
    },
  },
  {
    name: 'Lower-Third Intervenant',
    desc: 'Bandeau bas-gauche pro ambre & graphite',
    overlay: {
      text: 'Prénom Nom · Réalisateur',
      fontSize: 32,
      color: '#F5C469',
      bgColor: '#0E0F12',
      bgOpacity: 0.78,
      x: 28,
      y: 84,
      bold: true,
      animation: 'slide_up',
    },
  },
  {
    name: 'Hook Viral / Short',
    desc: 'Accroche punchy haut-centre format CapCut',
    overlay: {
      text: 'ATTENDS LA FIN ⚡',
      fontSize: 54,
      color: '#FFE066',
      bgColor: '#000000',
      bgOpacity: 0.72,
      x: 50,
      y: 22,
      bold: true,
      animation: 'pop',
    },
  },
  {
    name: 'Carton Chapitre',
    desc: 'Transition chapitrée minimaliste',
    overlay: {
      text: 'CHAPITRE 01 — L’ORIGINE',
      fontSize: 42,
      color: '#F4F4F5',
      bgColor: '#111116',
      bgOpacity: 0.65,
      x: 50,
      y: 78,
      bold: true,
      animation: 'fade',
    },
  },
];

const EFFECT_STARTER_RECIPES = [
  {
    label: 'Chaleur Sépia',
    ffmpeg: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast={{contrast}}',
    css: 'sepia(0.8) contrast({{contrast}})',
    params: [{ key: 'contrast', label: 'Contraste', type: 'number' as const, min: 0.8, max: 1.8, step: 0.05, default: 1.1 }],
  },
  {
    label: 'Pixelate / 8-bit',
    ffmpeg: 'scale=iw/{{pixel}}:ih/{{pixel}}:flags=neighbor,scale=iw*{{pixel}}:ih*{{pixel}}:flags=neighbor',
    css: 'contrast(1.15)',
    params: [{ key: 'pixel', label: 'Taille Pixels', type: 'number' as const, min: 2, max: 24, step: 2, default: 8 }],
  },
  {
    label: 'Rotation Teinte Psyché',
    ffmpeg: 'hue=h={{angle}}:s={{sat}}',
    css: 'hue-rotate({{angle}}deg) saturate({{sat}})',
    params: [
      { key: 'angle', label: 'Angle Teinte (°)', type: 'number' as const, min: -180, max: 180, step: 10, default: 90 },
      { key: 'sat', label: 'Saturation', type: 'number' as const, min: 0.5, max: 2.5, step: 0.1, default: 1.5 },
    ],
  },
];

export function EffectsLibraryDrawer({
  assets,
  effects,
  selectedClipId,
  selectedClipTitle,
  onDropAssetToTrack,
  onApplyEffectToClip,
  onApplyTransitionToClip,
  onDropTextPreset,
  onEffectsChanged,
  onNotify,
}: EffectsLibraryDrawerProps) {
  const [tab, setTab] = useState<CapCutResourceTab>('effects');
  const [search, setSearch] = useState('');
  const [mediaFilter, setMediaFilter] = useState<'all' | 'video' | 'image' | 'audio'>('all');
  const [effectCategory, setEffectCategory] = useState<string>('all');
  const [creatorFilter, setCreatorFilter] = useState<'all' | 'claude' | 'user' | 'system'>('all');

  // Custom Effect Creator / Editor Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEffect, setEditingEffect] = useState<VideoEffectDto | null>(null);
  const [formName, setFormName] = useState('');
  const [formIcon, setFormIcon] = useState('✨');
  const [formCategory, setFormCategory] = useState<VideoEffectCategory>('video_fx');
  const [formDesc, setFormDesc] = useState('');
  const [formFfmpeg, setFormFfmpeg] = useState('eq=contrast={{contrast}}:saturation={{saturation}}');
  const [formCss, setFormCss] = useState('contrast({{contrast}}) saturate({{saturation}})');
  const [formTags, setFormTags] = useState('custom');
  const [formParams, setFormParams] = useState<EffectParamSpec[]>([
    { key: 'contrast', label: 'Contraste', type: 'number', min: 0.5, max: 2, step: 0.05, default: 1.2 },
    { key: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 2.5, step: 0.05, default: 1.25 },
  ]);
  const [savingEffect, setSavingEffect] = useState(false);

  const ffmpegValidation = useMemo(() => validateFfmpegFilterTemplate(formFfmpeg), [formFfmpeg]);

  const filteredMedia = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets
      .filter((a) => a.type === 'video' || a.type === 'image' || a.type === 'audio')
      .filter((a) => mediaFilter === 'all' || a.type === mediaFilter)
      .filter((a) => !q || a.title.toLowerCase().includes(q) || a.handle.toLowerCase().includes(q));
  }, [assets, mediaFilter, search]);

  const filteredEffects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effects
      .filter((e) => effectCategory === 'all' || e.category === effectCategory)
      .filter((e) => creatorFilter === 'all' || e.createdBy === creatorFilter)
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.slug.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q)),
      );
  }, [effects, effectCategory, creatorFilter, search]);

  const openCreateModal = () => {
    setEditingEffect(null);
    setFormName('');
    setFormIcon('✨');
    setFormCategory('video_fx');
    setFormDesc('');
    setFormFfmpeg('eq=contrast={{contrast}}:saturation={{saturation}}');
    setFormCss('contrast({{contrast}}) saturate({{saturation}})');
    setFormTags('custom');
    setFormParams([
      { key: 'contrast', label: 'Contraste', type: 'number', min: 0.5, max: 2, step: 0.05, default: 1.2 },
      { key: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 2.5, step: 0.05, default: 1.25 },
    ]);
    setModalOpen(true);
  };

  const openEditModal = (fx: VideoEffectDto) => {
    setEditingEffect(fx);
    setFormName(fx.name);
    setFormIcon(fx.icon);
    setFormCategory(fx.category);
    setFormDesc(fx.description);
    setFormFfmpeg(fx.ffmpegFilterTemplate);
    setFormCss(fx.cssPreviewFilter);
    setFormTags(fx.tags.join(', '));
    setFormParams(fx.paramsSchema.length > 0 ? fx.paramsSchema : []);
    setModalOpen(true);
  };

  const handleSaveCustomEffect = async () => {
    if (!formName.trim()) {
      onNotify('Donne un nom à ton effet custom.');
      return;
    }
    if (!ffmpegValidation.valid) {
      onNotify(ffmpegValidation.reason ?? 'Filtre FFmpeg invalide');
      return;
    }
    setSavingEffect(true);
    try {
      const defaults: Record<string, number | boolean | string> = {};
      for (const p of formParams) {
        defaults[p.key] = p.default;
      }
      const payload: CreateVideoEffectInput = {
        name: formName.trim(),
        category: formCategory,
        description: formDesc.trim(),
        icon: formIcon.trim() || '✨',
        ffmpegFilterTemplate: formFfmpeg.trim(),
        cssPreviewFilter: formCss.trim(),
        paramsSchema: formParams,
        defaultParams: defaults,
        tags: formTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      if (editingEffect && !editingEffect.isBuiltin) {
        await api.updateEffect(editingEffect.id, payload);
        onNotify(`Effet « ${payload.name} » mis à jour !`);
      } else {
        await api.createEffect(payload);
        onNotify(`Nouvel effet « ${payload.name} » créé et disponible pour toi et Claude !`);
      }
      setModalOpen(false);
      onEffectsChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erreur sauvegarde effet');
    } finally {
      setSavingEffect(false);
    }
  };

  const handleDeleteCustomEffect = async (fx: VideoEffectDto) => {
    if (fx.isBuiltin) return;
    try {
      await api.deleteEffect(fx.id);
      onNotify(`Effet « ${fx.name} » supprimé`);
      onEffectsChanged();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Impossible de supprimer cet effet');
    }
  };

  const addParamRow = () => {
    const idx = formParams.length + 1;
    setFormParams((prev) => [
      ...prev,
      { key: `param${idx}`, label: `Paramètre ${idx}`, type: 'number', min: 0, max: 10, step: 0.1, default: 1 },
    ]);
  };

  return (
    <div className="capcut-resource-drawer">
      {/* CapCut Resource Tabs */}
      <div className="capcut-resource-tabs" role="tablist">
        <button
          type="button"
          className={`capcut-res-tab ${tab === 'media' ? 'active' : ''}`}
          onClick={() => setTab('media')}
        >
          <Film size={13} /> Médias
        </button>
        <button
          type="button"
          className={`capcut-res-tab ${tab === 'effects' ? 'active' : ''}`}
          onClick={() => setTab('effects')}
        >
          <Sparkles size={13} /> Effets ({effects.length})
        </button>
        <button
          type="button"
          className={`capcut-res-tab ${tab === 'transitions' ? 'active' : ''}`}
          onClick={() => setTab('transitions')}
        >
          <Shuffle size={13} /> Trans.
        </button>
        <button
          type="button"
          className={`capcut-res-tab ${tab === 'text' ? 'active' : ''}`}
          onClick={() => setTab('text')}
        >
          <Type size={13} /> Textes
        </button>
      </div>

      {/* Search bar for Media & Effects */}
      {(tab === 'media' || tab === 'effects') && (
        <div className="capcut-resource-search">
          <Search size={12} color="var(--text-muted)" />
          <input
            className="capcut-search-input"
            placeholder={tab === 'media' ? 'Filtrer médias...' : 'Rechercher un effet (VHS, IA...)'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {tab === 'effects' && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={openCreateModal}
              title="Créer ton propre effet vidéo/audio custom (FFmpeg + Preview CSS)"
              style={{ padding: '4px 8px', fontSize: 11 }}
            >
              <Plus size={12} /> Créer
            </button>
          )}
        </div>
      )}

      {/* TAB 1: MEDIA BIN */}
      {tab === 'media' && (
        <div className="capcut-resource-body">
          <div className="capcut-filter-pills">
            {(['all', 'video', 'image', 'audio'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`chip ${mediaFilter === k ? 'active' : ''}`}
                onClick={() => setMediaFilter(k)}
              >
                {k === 'all' ? 'Tous' : k === 'video' ? 'Vidéos' : k === 'image' ? 'Images' : 'Audio'}
              </button>
            ))}
          </div>

          <div className="capcut-media-grid">
            {filteredMedia.map((a) => (
              <div key={a.id} className="capcut-media-card">
                <div className="capcut-media-thumb">
                  {a.urls.thumbnail ? (
                    <img src={a.urls.thumbnail} alt={a.title} loading="lazy" />
                  ) : a.type === 'audio' ? (
                    <Music size={20} color="var(--accent-amber)" />
                  ) : (
                    <ImageIcon size={20} color="var(--text-muted)" />
                  )}
                  <span className="capcut-media-handle">{a.handle}</span>
                </div>
                <div className="capcut-media-info">
                  <div className="capcut-media-title" title={a.title}>
                    {a.title}
                  </div>
                  <div className="capcut-media-actions">
                    {a.type === 'audio' ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onDropAssetToTrack(a, 'audio')}
                        title="Ajouter sur la piste Audio A1"
                      >
                        + Audio
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onDropAssetToTrack(a, 'video')}
                          title="Ajouter sur la piste Vidéo principale V1"
                        >
                          + V1
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onDropAssetToTrack(a, 'overlay')}
                          title="Ajouter en incrustation Overlay / PiP (V2)"
                        >
                          + PiP
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {filteredMedia.length === 0 && (
              <p className="muted" style={{ fontSize: 11.5, textAlign: 'center', gridColumn: '1 / -1', margin: '14px 0' }}>
                Aucun média correspondant dans ce projet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: EFFECTS LIBRARY (Built-in + AI-created + User-created) */}
      {tab === 'effects' && (
        <div className="capcut-resource-body">
          <div className="capcut-filter-pills">
            {EFFECT_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`chip ${effectCategory === c.value ? 'active' : ''}`}
                onClick={() => setEffectCategory(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="capcut-filter-pills" style={{ marginTop: -2 }}>
            <button
              type="button"
              className={`chip ${creatorFilter === 'all' ? 'active' : ''}`}
              onClick={() => setCreatorFilter('all')}
            >
              Tous auteurs
            </button>
            <button
              type="button"
              className={`chip ${creatorFilter === 'claude' ? 'active' : ''}`}
              onClick={() => setCreatorFilter('claude')}
            >
              <Bot size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} /> IA
            </button>
            <button
              type="button"
              className={`chip ${creatorFilter === 'user' ? 'active' : ''}`}
              onClick={() => setCreatorFilter('user')}
            >
              <User size={10} style={{ marginRight: 3, verticalAlign: 'middle' }} /> Mes FX
            </button>
          </div>

          {!selectedClipId && (
            <div className="capcut-hint-banner">
              Sélectionne un clip sur la timeline pour lui appliquer un effet en 1 clic.
            </div>
          )}

          <div className="capcut-effects-grid">
            {filteredEffects.map((fx) => (
              <div key={fx.id} className={`capcut-effect-card creator-${fx.createdBy}`}>
                <div className="capcut-effect-top">
                  <span className="capcut-effect-icon">{fx.icon}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="capcut-effect-name" title={fx.name}>
                      {fx.name}
                    </div>
                    <div className="capcut-effect-meta">
                      <span>{fx.category}</span>
                      {fx.createdBy === 'claude' && (
                        <span className="capcut-creator-badge ai" title="Effet créé par Claude IA via MCP">
                          🤖 IA
                        </span>
                      )}
                      {fx.createdBy === 'user' && (
                        <span className="capcut-creator-badge user" title="Effet custom créé par l'utilisateur">
                          👤 Custom
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {fx.description && (
                  <p className="capcut-effect-desc" title={fx.description}>
                    {fx.description}
                  </p>
                )}
                <div className="capcut-effect-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!selectedClipId}
                    onClick={() => onApplyEffectToClip(fx)}
                    title={
                      selectedClipTitle
                        ? `Appliquer sur "${selectedClipTitle}"`
                        : 'Sélectionne un clip d’abord'
                    }
                    style={{ flex: 1, fontSize: 11, padding: '4px 6px' }}
                  >
                    <Wand2 size={11} /> Appliquer
                  </button>
                  {!fx.isBuiltin && (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => openEditModal(fx)}
                        title="Modifier cet effet custom"
                        style={{ padding: '4px 6px' }}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void handleDeleteCustomEffect(fx)}
                        title="Supprimer cet effet custom"
                        style={{ padding: '4px 6px', color: 'var(--accent-red)' }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: CAPCUT TRANSITIONS */}
      {tab === 'transitions' && (
        <div className="capcut-resource-body">
          {!selectedClipId && (
            <div className="capcut-hint-banner">
              Sélectionne un clip vidéo sur la timeline pour définir sa transition d’entrée FFmpeg <code>xfade</code>.
            </div>
          )}
          <div className="capcut-transitions-grid">
            {(Object.keys(TIMELINE_TRANSITION_META) as TimelineTransition[]).map((key) => {
              const meta = TIMELINE_TRANSITION_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  className="capcut-transition-card"
                  disabled={!selectedClipId}
                  onClick={() => onApplyTransitionToClip(key)}
                >
                  <span style={{ fontSize: 18 }}>{meta.icon}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500 }}>{meta.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: TEXT & TITLE PRESETS */}
      {tab === 'text' && (
        <div className="capcut-resource-body">
          <div className="capcut-hint-banner">
            Clique sur un style pour déposer un bloc Texte au niveau de la tête de lecture (piste T1).
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {TEXT_PRESETS.map((preset) => (
              <div key={preset.name} className="capcut-text-preset-card">
                <div
                  className="capcut-text-preset-preview"
                  style={{
                    color: preset.overlay.color,
                    background: preset.overlay.bgColor,
                  }}
                >
                  {preset.overlay.text}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{preset.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{preset.desc}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onDropTextPreset(preset.name, preset.overlay)}
                  >
                    <Plus size={12} /> Ajouter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CUSTOM EFFECT STUDIO MODAL (User + AI Shared Effects Engine) */}
      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="modal-card capcut-fx-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={16} color="var(--accent-amber)" />
                <strong>
                  {editingEffect ? `Modifier l'effet : ${editingEffect.name}` : 'Studio Création Effet Custom'}
                </strong>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Recettes de départ :</span>
                {EFFECT_STARTER_RECIPES.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setFormName(r.label);
                      setFormFfmpeg(r.ffmpeg);
                      setFormCss(r.css);
                      setFormParams(r.params);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 140px', gap: 8 }}>
                <div className="field">
                  <label>Icône</label>
                  <input className="input" value={formIcon} onChange={(e) => setFormIcon(e.target.value)} maxLength={8} />
                </div>
                <div className="field">
                  <label>Nom de l’effet</label>
                  <input
                    className="input"
                    placeholder="Ex: Halation Pellicule 35mm"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>Catégorie</label>
                  <select
                    className="select"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as VideoEffectCategory)}
                  >
                    <option value="video_fx">Vidéo FX</option>
                    <option value="color_grade">Étalonnage</option>
                    <option value="motion">Mouvement</option>
                    <option value="overlay">Overlay</option>
                    <option value="audio_fx">Audio FX</option>
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Description (également lue par Claude IA via MCP)</label>
                <input
                  className="input"
                  placeholder="Explique quand utiliser cet effet..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                />
              </div>

              <div className="field">
                <label>
                  Chaîne de filtres FFmpeg (variables dynamiques <code>{'{{cle}}'}</code>)
                </label>
                <textarea
                  className="textarea"
                  rows={2}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  value={formFfmpeg}
                  onChange={(e) => setFormFfmpeg(e.target.value)}
                  placeholder="eq=contrast={{contrast}}:saturation={{saturation}},vignette=PI/4"
                />
                <div
                  style={{
                    fontSize: 11,
                    color: ffmpegValidation.valid ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}
                >
                  {ffmpegValidation.valid
                    ? '✓ Syntaxe FFmpeg sécurisée et validée'
                    : `✕ ${ffmpegValidation.reason}`}
                </div>
              </div>

              <div className="field">
                <label>Aperçu temps réel navigateur (CSS filter optionnel)</label>
                <input
                  className="input"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                  value={formCss}
                  onChange={(e) => setFormCss(e.target.value)}
                  placeholder="contrast({{contrast}}) saturate({{saturation}})"
                />
              </div>

              {/* Dynamic parameter sliders builder */}
              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Paramètres réglables ({formParams.length})</label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addParamRow}>
                    <Plus size={12} /> Ajouter paramètre
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {formParams.map((p, idx) => (
                    <div
                      key={`${p.key}-${idx}`}
                      style={{ display: 'grid', gridTemplateColumns: '100px 1fr 64px 64px 64px 28px', gap: 6 }}
                    >
                      <input
                        className="input"
                        placeholder="clé"
                        value={p.key}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, key: e.target.value } : item)),
                          )
                        }
                      />
                      <input
                        className="input"
                        placeholder="Label"
                        value={p.label}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, label: e.target.value } : item)),
                          )
                        }
                      />
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        title="Min"
                        value={p.min ?? 0}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, min: Number(e.target.value) } : item)),
                          )
                        }
                      />
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        title="Max"
                        value={p.max ?? 10}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, max: Number(e.target.value) } : item)),
                          )
                        }
                      />
                      <input
                        className="input"
                        type="number"
                        step="0.1"
                        title="Défaut"
                        value={typeof p.default === 'number' ? p.default : 1}
                        onChange={(e) =>
                          setFormParams((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, default: Number(e.target.value) } : item)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setFormParams((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ padding: 4, color: 'var(--accent-red)' }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Tags (séparés par virgule)</label>
                <input className="input" value={formTags} onChange={(e) => setFormTags(e.target.value)} />
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setModalOpen(false)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingEffect || !ffmpegValidation.valid}
                onClick={() => void handleSaveCustomEffect()}
              >
                <Sparkles size={13} /> {savingEffect ? 'Enregistrement...' : 'Sauvegarder l’effet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
