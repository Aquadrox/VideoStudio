import { describe, expect, it } from 'vitest';
import {
  buildProductionDossierHtml,
  buildProductionDossierMarkdown,
  type ProductionDossierInputData,
} from './dossier-utils.js';

const sampleData: ProductionDossierInputData = {
  project: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'ombre-taverne',
    name: "L'Ombre de la Taverne",
    description: 'Un polar néo-noir sous la pluie.',
    type: 'animation',
    aspectRatio: '16:9',
    fps: 24,
    targetResolution: '1920x1080',
    status: 'production',
    localPath: '',
    uri: 'studio://projects/ombre-taverne',
    assetCount: 4,
    createdAt: '2026-11-28T00:00:00.000Z',
    updatedAt: '2026-11-28T00:00:00.000Z',
  },
  script: {
    id: 'sc-1',
    projectId: '11111111-1111-4111-8111-111111111111',
    title: 'Scénario principal',
    version: 2,
    content: 'INT. TAVERNE - NUIT\nElara pousse la porte.',
    versions: [],
    updatedAt: '2026-11-28T00:00:00.000Z',
  },
  bible: [
    {
      id: 'b1',
      projectId: '11111111-1111-4111-8111-111111111111',
      entityType: 'character',
      refCode: 'char-elara',
      handle: '@char-elara',
      name: 'Elara',
      description: 'Enquêtrice en trench sombre.',
      visualPrompt: 'woman in dark trench coat',
      loraName: 'elara_v2.safetensors',
      referenceAssetIds: [],
      tags: [],
      createdAt: '',
      updatedAt: '',
    },
  ],
  scenes: [
    {
      id: 's1',
      projectId: '11111111-1111-4111-8111-111111111111',
      sceneNumber: 1,
      title: 'Scène 1 — Entrée',
      summary: 'Arrivée sous la pluie.',
      locationRef: '',
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
      shots: [
        {
          id: 'sh1',
          sceneId: 's1',
          projectId: '11111111-1111-4111-8111-111111111111',
          shotCode: 'S01-P01',
          handle: '@shot-001',
          externalId: null,
          title: 'Ouverture porte',
          visualDescription: 'Plan moyen sur le seuil.',
          cameraMovement: 'Dolly In 35mm',
          dialogue: '',
          durationSec: 4,
          startSec: 0,
          prompt: 'cinematic 35mm tavern door',
          keyframeAssetId: null,
          videoAssetId: null,
          bibleEntityRefs: [],
          status: 'approved',
          sortOrder: 0,
          createdAt: '',
          updatedAt: '',
        },
      ],
    },
  ],
  sketches: [],
  generatedAtIso: '2026-11-28T10:00:00.000Z',
};

describe('dossier-utils', () => {
  it('generates print-ready HTML for both dossier portrait and pitch deck landscape', () => {
    const htmlDossier = buildProductionDossierHtml(sampleData, {
      layout: 'dossier',
      director: 'Aquadrox',
    });
    expect(htmlDossier).toContain('size: A4 portrait');
    expect(htmlDossier).toContain("L&#39;Ombre de la Taverne");
    expect(htmlDossier).toContain('Elara');
    expect(htmlDossier).toContain('window.print()');

    const htmlPitch = buildProductionDossierHtml(sampleData, {
      layout: 'pitch_deck',
      includeScript: false,
    });
    expect(htmlPitch).toContain('size: A4 landscape');
    expect(htmlPitch).not.toContain('02 · Scénario');
  });

  it('generates structured Markdown production dossier', () => {
    const md = buildProductionDossierMarkdown(sampleData, { includePrompts: true });
    expect(md).toContain("# Dossier de Production — L'Ombre de la Taverne");
    expect(md).toContain('## Bible de continuité');
    expect(md).toContain('## Découpage Technique & Storyboard');
    expect(md).toContain('cinematic 35mm tavern door');
  });
});
