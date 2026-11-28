import { z } from 'zod';
import type { ProjectDto } from './schemas.js';
import type { SketchDto } from './sketch-schemas.js';
import { sortSketchesForBoard } from './sketch-utils.js';
import type { BibleEntityDto, ProjectScriptDto, SceneDto } from './stage3-schemas.js';

export const ProductionDossierLayoutSchema = z.enum(['dossier', 'pitch_deck']);
export type ProductionDossierLayout = z.infer<typeof ProductionDossierLayoutSchema>;

export const ProductionDossierOptionsSchema = z.object({
  layout: ProductionDossierLayoutSchema.default('dossier'),
  includeScript: z.boolean().default(true),
  includeBible: z.boolean().default(true),
  includeSketchBoard: z.boolean().default(true),
  includeStoryboard: z.boolean().default(true),
  includePrompts: z.boolean().default(true),
  includeBriefs: z.boolean().default(true),
  subtitle: z.string().max(200).optional(),
  director: z.string().max(120).optional(),
});
export type ProductionDossierOptions = z.infer<typeof ProductionDossierOptionsSchema>;

export interface ProductionDossierInputData {
  project: ProjectDto;
  script: ProjectScriptDto | null;
  bible: BibleEntityDto[];
  scenes: SceneDto[];
  sketches: SketchDto[];
  /** Optional map of assetId -> inline data URL or relative URL for thumbnails */
  assetImageMap?: Record<string, string>;
  generatedAtIso?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDurationBadge(sec: number): string {
  const s = Math.max(0, Math.round(sec * 10) / 10);
  if (s >= 60) {
    const mins = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${mins}m ${String(rem).padStart(2, '0')}s`;
  }
  return `${s}s`;
}

const BIBLE_TYPE_LABELS: Record<string, string> = {
  character: 'Personnage',
  location: 'Lieu / Décor',
  prop: 'Accessoire',
  style: 'Style visuel',
};

const SHOT_STATUS_LABELS: Record<string, string> = {
  planned: 'Planifié',
  generating: 'En génération',
  draft_ready: 'Draft prêt',
  hq_ready: 'HQ prêt',
  approved: 'Approuvé',
};

/**
 * Generates a structured Markdown Production Dossier (great for Git versioning & rich text editor).
 */
export function buildProductionDossierMarkdown(
  data: ProductionDossierInputData,
  optsInput?: Partial<ProductionDossierOptions>,
): string {
  const opts = ProductionDossierOptionsSchema.parse(optsInput ?? {});
  const lines: string[] = [];
  const boardSketches = sortSketchesForBoard(data.sketches);
  const totalShots = data.scenes.reduce((acc, sc) => acc + sc.shots.length, 0);
  const totalDurationSec = data.scenes.reduce(
    (acc, sc) => acc + sc.shots.reduce((sAcc, sh) => sAcc + (sh.durationSec || 0), 0),
    0,
  );
  const dateStr = (data.generatedAtIso ?? new Date().toISOString()).slice(0, 10);

  lines.push(`# Dossier de Production — ${data.project.name}`);
  if (opts.subtitle?.trim()) {
    lines.push(`> ${opts.subtitle.trim()}`);
  }
  lines.push('');
  const projectHandle = `@proj-${data.project.slug}`;
  lines.push(`- **Projet** : \`${projectHandle}\` (${data.project.status})`);
  lines.push(`- **Format** : ${data.project.aspectRatio} · ${data.project.targetResolution} · ${data.project.fps} fps`);
  if (opts.director?.trim()) {
    lines.push(`- **Réalisation** : ${opts.director.trim()}`);
  }
  lines.push(`- **Volume** : ${data.scenes.length} scène(s) · ${totalShots} plan(s) · ${formatDurationBadge(totalDurationSec)} · ${boardSketches.length} croquis · ${data.bible.length} fiche(s) Bible`);
  lines.push(`- **Généré le** : ${dateStr} via VideoStudio`);
  lines.push('');

  if (data.project.description?.trim()) {
    lines.push('## Synopsis / Intention');
    lines.push('');
    lines.push(data.project.description.trim());
    lines.push('');
  }

  if (opts.includeBible && data.bible.length > 0) {
    lines.push('## Bible de continuité');
    lines.push('');
    for (const ent of data.bible) {
      lines.push(`### ${ent.name} (${BIBLE_TYPE_LABELS[ent.entityType] ?? ent.entityType} · \`${ent.handle}\`)`);
      if (ent.description.trim()) lines.push(ent.description.trim());
      if (ent.loraName) lines.push(`- **LoRA** : \`${ent.loraName}\``);
      if (opts.includePrompts && ent.visualPrompt.trim()) {
        lines.push(`- **Prompt visuel** : \`${ent.visualPrompt.trim()}\``);
      }
      lines.push('');
    }
  }

  if (opts.includeScript && data.script?.content?.trim()) {
    lines.push(`## Scénario (v${data.script.version})`);
    lines.push('');
    lines.push(data.script.content.trim());
    lines.push('');
  }

  if (opts.includeSketchBoard && boardSketches.length > 0) {
    lines.push('## Planche Storyboard Croquis');
    lines.push('');
    lines.push('| # | Titre | Type | Durée | Action / Légende |');
    lines.push('| --- | --- | --- | --- | --- |');
    boardSketches.forEach((sk, idx) => {
      const kind = sk.mode === 'scene_plan' ? 'Plan de scène' : 'Croquis';
      const cap = (sk.caption || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| #${String(idx + 1).padStart(2, '0')} | ${sk.title} | ${kind} | ${sk.durationSec}s | ${cap || '—'} |`);
    });
    lines.push('');
    if (opts.includeBriefs) {
      for (const sk of boardSketches) {
        if (!sk.aiDirectorBrief?.trim()) continue;
        lines.push(`### Brief Réalisateur — ${sk.title}`);
        lines.push('```text');
        lines.push(sk.aiDirectorBrief.trim());
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (opts.includeStoryboard && data.scenes.length > 0) {
    lines.push('## Découpage Technique & Storyboard');
    lines.push('');
    for (const scene of data.scenes) {
      lines.push(`### ${scene.title}`);
      if (scene.summary.trim()) lines.push(`*${scene.summary.trim()}*`);
      lines.push('');
      for (const shot of scene.shots) {
        lines.push(`- **${shot.title}** (\`${shot.handle}\` · ${shot.durationSec}s · ${SHOT_STATUS_LABELS[shot.status] ?? shot.status})`);
        if (shot.cameraMovement?.trim()) lines.push(`  - Caméra : ${shot.cameraMovement.trim()}`);
        if (shot.visualDescription?.trim()) lines.push(`  - Action : ${shot.visualDescription.trim()}`);
        if (shot.dialogue?.trim()) lines.push(`  - Dialogue : « ${shot.dialogue.trim()} »`);
        if (opts.includePrompts && shot.prompt?.trim()) {
          lines.push(`  - Prompt : \`${shot.prompt.trim()}\``);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

/**
 * Generates a print-ready, self-contained HTML/CSS Production Dossier or Landscape Pitch Deck
 * designed for 1-click browser PDF export (`window.print()`) with cinema editorial styling.
 */
export function buildProductionDossierHtml(
  data: ProductionDossierInputData,
  optsInput?: Partial<ProductionDossierOptions>,
): string {
  const opts = ProductionDossierOptionsSchema.parse(optsInput ?? {});
  const isPitch = opts.layout === 'pitch_deck';
  const boardSketches = sortSketchesForBoard(data.sketches);
  const assetImages = data.assetImageMap ?? {};
  const totalShots = data.scenes.reduce((acc, sc) => acc + sc.shots.length, 0);
  const totalDurationSec = data.scenes.reduce(
    (acc, sc) => acc + sc.shots.reduce((sAcc, sh) => sAcc + (sh.durationSec || 0), 0),
    0,
  );
  const dateStr = (data.generatedAtIso ?? new Date().toISOString()).slice(0, 10);

  const resolveImg = (assetId?: string | null, fallbackUrl?: string | null): string | null => {
    if (assetId && assetImages[assetId]) return assetImages[assetId]!;
    if (fallbackUrl) return fallbackUrl;
    return null;
  };

  const sketchByShotId = new Map<string, SketchDto>();
  for (const sk of data.sketches) {
    if (sk.shotId && !sketchByShotId.has(sk.shotId)) sketchByShotId.set(sk.shotId, sk);
  }

  const sections: string[] = [];

  // 1. Cover Page
  sections.push(`
    <section class="page cover-page">
      <div class="cover-top">
        <span class="brand-pill">VIDEOSTUDIO · ${isPitch ? 'PITCH DECK' : 'DOSSIER DE PRODUCTION'}</span>
        <span class="meta-mono">${escapeHtml(dateStr)}</span>
      </div>
      <div class="cover-main">
        <div class="handle-badge">${escapeHtml(`@proj-${data.project.slug}`)}</div>
        <h1>${escapeHtml(data.project.name)}</h1>
        ${opts.subtitle?.trim() ? `<p class="cover-subtitle">${escapeHtml(opts.subtitle.trim())}</p>` : ''}
        ${data.project.description?.trim() ? `<p class="cover-desc">${escapeHtml(data.project.description.trim())}</p>` : ''}
      </div>
      <div class="cover-kpis">
        <div class="kpi"><span class="kpi-label">FORMAT</span><strong>${escapeHtml(data.project.aspectRatio)} · ${escapeHtml(data.project.targetResolution)}</strong></div>
        <div class="kpi"><span class="kpi-label">CADENCE</span><strong>${data.project.fps} fps</strong></div>
        <div class="kpi"><span class="kpi-label">SCÈNES / PLANS</span><strong>${data.scenes.length} scènes · ${totalShots} plans</strong></div>
        <div class="kpi"><span class="kpi-label">DURÉE ESTIMÉE</span><strong>${escapeHtml(formatDurationBadge(totalDurationSec))}</strong></div>
        <div class="kpi"><span class="kpi-label">CROQUIS / BIBLE</span><strong>${boardSketches.length} croquis · ${data.bible.length} fiches</strong></div>
        ${opts.director?.trim() ? `<div class="kpi"><span class="kpi-label">RÉALISATION</span><strong>${escapeHtml(opts.director.trim())}</strong></div>` : ''}
      </div>
    </section>
  `);

  // 2. Bible de continuité
  if (opts.includeBible && data.bible.length > 0) {
    const cards = data.bible
      .map((ent) => {
        const refImg = ent.referenceAssetIds?.[0] ? resolveImg(ent.referenceAssetIds[0]) : null;
        return `
          <article class="bible-card">
            ${refImg ? `<div class="bible-thumb"><img src="${escapeHtml(refImg)}" alt="${escapeHtml(ent.name)}" /></div>` : ''}
            <div class="bible-body">
              <div class="row-between">
                <span class="tag">${escapeHtml(BIBLE_TYPE_LABELS[ent.entityType] ?? ent.entityType)}</span>
                <span class="meta-mono">${escapeHtml(ent.handle)}</span>
              </div>
              <h3>${escapeHtml(ent.name)}</h3>
              ${ent.description.trim() ? `<p>${escapeHtml(ent.description.trim())}</p>` : ''}
              ${ent.loraName ? `<div class="meta-line"><strong>LoRA :</strong> <code>${escapeHtml(ent.loraName)}</code></div>` : ''}
              ${opts.includePrompts && ent.visualPrompt.trim() ? `<div class="prompt-box">${escapeHtml(ent.visualPrompt.trim())}</div>` : ''}
            </div>
          </article>
        `;
      })
      .join('\n');

    sections.push(`
      <section class="page">
        <header class="section-head">
          <h2>01 · Bible de continuité</h2>
          <span class="meta-mono">${data.bible.length} entité(s)</span>
        </header>
        <div class="bible-grid ${isPitch ? 'cols-3' : 'cols-2'}">${cards}</div>
      </section>
    `);
  }

  // 3. Scénario
  if (opts.includeScript && data.script?.content?.trim()) {
    sections.push(`
      <section class="page">
        <header class="section-head">
          <h2>02 · Scénario</h2>
          <span class="meta-mono">Version v${data.script.version}</span>
        </header>
        <pre class="script-block">${escapeHtml(data.script.content.trim())}</pre>
      </section>
    `);
  }

  // 4. Planche Storyboard Croquis
  if (opts.includeSketchBoard && boardSketches.length > 0) {
    const sketchCards = boardSketches
      .map((sk, idx) => {
        const imgUrl = resolveImg(sk.assetId, sk.assetUrl ?? sk.assetThumbnailUrl);
        const modeLabel = sk.mode === 'scene_plan' ? 'Plan de scène' : 'Croquis';
        return `
          <article class="board-card">
            <div class="row-between card-top">
              <span class="num-pill">#${String(idx + 1).padStart(2, '0')} · ${escapeHtml(modeLabel)}</span>
              <span class="meta-mono">${sk.durationSec}s${sk.shotHandle ? ` · ${escapeHtml(sk.shotHandle)}` : ''}</span>
            </div>
            <div class="frame-box">
              ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(sk.title)}" />` : `<div class="frame-empty">Aperçu non généré</div>`}
            </div>
            <h3>${escapeHtml(sk.title)}</h3>
            ${sk.caption?.trim() ? `<p class="caption">${escapeHtml(sk.caption.trim())}</p>` : ''}
            ${opts.includeBriefs && sk.aiDirectorBrief?.trim() ? `<pre class="brief-mini">${escapeHtml(sk.aiDirectorBrief.trim().slice(0, 420))}</pre>` : ''}
          </article>
        `;
      })
      .join('\n');

    sections.push(`
      <section class="page">
        <header class="section-head">
          <h2>03 · Planche Storyboard Croquis & Plans de Scène</h2>
          <span class="meta-mono">${boardSketches.length} case(s)</span>
        </header>
        <div class="board-grid ${isPitch ? 'cols-3' : 'cols-2'}">${sketchCards}</div>
      </section>
    `);
  }

  // 5. Découpage technique & Storyboard Pré-prod
  if (opts.includeStoryboard && data.scenes.length > 0) {
    const scenesHtml = data.scenes
      .map((scene, sIdx) => {
        const shotsHtml = scene.shots
          .map((shot) => {
            const linkedSketch = sketchByShotId.get(shot.id);
            const imgUrl =
              resolveImg(shot.keyframeAssetId) ??
              resolveImg(linkedSketch?.assetId, linkedSketch?.assetUrl ?? linkedSketch?.assetThumbnailUrl);
            return `
              <article class="shot-card">
                <div class="frame-box sm">
                  ${imgUrl ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(shot.title)}" />` : `<div class="frame-empty">${escapeHtml(shot.handle)}</div>`}
                </div>
                <div class="shot-info">
                  <div class="row-between">
                    <strong>${escapeHtml(shot.title)}</strong>
                    <span class="meta-mono">${escapeHtml(shot.handle)} · ${shot.durationSec}s</span>
                  </div>
                  <div class="meta-line">
                    <span class="tag">${escapeHtml(SHOT_STATUS_LABELS[shot.status] ?? shot.status)}</span>
                    ${shot.cameraMovement?.trim() ? `<span>Caméra : ${escapeHtml(shot.cameraMovement.trim())}</span>` : ''}
                  </div>
                  ${shot.visualDescription?.trim() ? `<p>${escapeHtml(shot.visualDescription.trim())}</p>` : ''}
                  ${shot.dialogue?.trim() ? `<p class="caption"><em>« ${escapeHtml(shot.dialogue.trim())} »</em></p>` : ''}
                  ${opts.includePrompts && shot.prompt?.trim() ? `<div class="prompt-box">${escapeHtml(shot.prompt.trim())}</div>` : ''}
                </div>
              </article>
            `;
          })
          .join('\n');

        return `
          <div class="scene-block">
            <div class="scene-title-bar">
              <h3>Scène ${sIdx + 1} — ${escapeHtml(scene.title)}</h3>
              <span class="meta-mono">${scene.shots.length} plan(s)</span>
            </div>
            ${scene.summary.trim() ? `<p class="scene-summary">${escapeHtml(scene.summary.trim())}</p>` : ''}
            <div class="shot-grid ${isPitch ? 'cols-3' : 'cols-2'}">${shotsHtml}</div>
          </div>
        `;
      })
      .join('\n');

    sections.push(`
      <section class="page">
        <header class="section-head">
          <h2>04 · Découpage Technique & Storyboard Pré-prod</h2>
          <span class="meta-mono">${data.scenes.length} scène(s) · ${totalShots} plan(s)</span>
        </header>
        ${scenesHtml}
      </section>
    `);
  }

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dossier de Production — ${escapeHtml(data.project.name)}</title>
  <style>
    @page {
      size: A4 ${isPitch ? 'landscape' : 'portrait'};
      margin: 12mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111827;
      background: #f3f4f6;
      line-height: 1.48;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 20px;
      background: #0d1017;
      color: #f8fafc;
      border-bottom: 1px solid #242b3a;
    }
    .toolbar-btn {
      background: #e5a038;
      color: #111827;
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }
    .doc-wrap {
      max-width: ${isPitch ? '1140px' : '860px'};
      margin: 20px auto 40px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .page {
      background: #ffffff;
      border-radius: 10px;
      padding: 28px 32px;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .cover-page {
      background: linear-gradient(145deg, #0d1017 0%, #171e2d 65%, #231b11 100%);
      color: #f8fafc;
      min-height: ${isPitch ? '540px' : '680px'};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .cover-top { display: flex; justify-content: space-between; align-items: center; }
    .brand-pill {
      display: inline-block;
      padding: 5px 11px;
      border-radius: 999px;
      background: rgba(229, 160, 56, 0.18);
      border: 1px solid rgba(229, 160, 56, 0.55);
      color: #f5b84b;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .handle-badge {
      display: inline-block;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      color: #f5b84b;
      margin-bottom: 10px;
    }
    .cover-main h1 { font-size: 38px; line-height: 1.12; margin: 0 0 12px; }
    .cover-subtitle { font-size: 18px; color: #e2e8f0; margin: 0 0 10px; }
    .cover-desc { font-size: 14px; color: #cbd5e1; max-width: 680px; margin: 0; }
    .cover-kpis {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      padding-top: 18px;
    }
    .kpi {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 10px 12px;
    }
    .kpi-label { display: block; font-size: 10px; color: #94a3b8; letter-spacing: 0.08em; margin-bottom: 4px; }
    .kpi strong { font-size: 13px; color: #f8fafc; }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 2px solid #e5a038;
      padding-bottom: 8px;
      margin-bottom: 18px;
    }
    .section-head h2 { margin: 0; font-size: 19px; color: #0f172a; }
    .meta-mono { font-family: "JetBrains Mono", monospace; font-size: 11px; color: #64748b; }
    .row-between { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .cols-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .cols-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .bible-card, .board-card, .shot-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      background: #fafafa;
      break-inside: avoid;
    }
    .bible-thumb { margin-bottom: 10px; border-radius: 6px; overflow: hidden; background: #0f172a; aspect-ratio: 16/9; }
    .bible-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .bible-body h3, .board-card h3 { margin: 6px 0; font-size: 14px; color: #0f172a; }
    .bible-body p, .shot-info p, .caption { margin: 4px 0 6px; font-size: 12px; color: #334155; }
    .tag, .num-pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 700;
      background: #fef3c7;
      color: #92400e;
    }
    .meta-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: #475569; margin: 4px 0; }
    .prompt-box {
      margin-top: 6px;
      padding: 6px 8px;
      border-radius: 5px;
      background: #f1f5f9;
      border-left: 3px solid #e5a038;
      font-family: "JetBrains Mono", monospace;
      font-size: 10.5px;
      color: #1e293b;
      white-space: pre-wrap;
    }
    .script-block {
      margin: 0;
      padding: 16px 18px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-family: "JetBrains Mono", "Courier New", monospace;
      font-size: 11.5px;
      line-height: 1.55;
      white-space: pre-wrap;
      color: #0f172a;
    }
    .frame-box {
      margin: 8px 0;
      aspect-ratio: 16/9;
      border-radius: 6px;
      overflow: hidden;
      background: #0f172a;
      border: 1px solid #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .frame-box img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .frame-empty { color: #94a3b8; font-size: 12px; font-family: "JetBrains Mono", monospace; }
    .brief-mini {
      margin: 6px 0 0;
      padding: 6px 8px;
      border-radius: 5px;
      background: #0f172a;
      color: #cbd5e1;
      font-family: "JetBrains Mono", monospace;
      font-size: 9.5px;
      white-space: pre-wrap;
      overflow: hidden;
    }
    .scene-block { margin-bottom: 18px; }
    .scene-title-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #f8fafc;
      padding: 7px 12px;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .scene-title-bar h3 { margin: 0; font-size: 13.5px; }
    .scene-title-bar .meta-mono { color: #f5b84b; }
    .scene-summary { font-size: 12px; color: #475569; margin: 0 0 10px; font-style: italic; }
    @media print {
      body { background: #ffffff; }
      .no-print { display: none !important; }
      .doc-wrap { margin: 0; max-width: none; gap: 0; }
      .page { box-shadow: none; border-radius: 0; padding: 0; margin-bottom: 0; }
      .cover-page { padding: 24px 28px; border-radius: 8px; }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <div><strong>VideoStudio</strong> — ${escapeHtml(data.project.name)} (${isPitch ? 'Pitch Deck Paysage' : 'Dossier A4'})</div>
    <button class="toolbar-btn" onclick="window.print()">Imprimer / Enregistrer en PDF</button>
  </div>
  <main class="doc-wrap">
    ${sections.join('\n')}
  </main>
</body>
</html>`;
}
