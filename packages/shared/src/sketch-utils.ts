import type {
  SketchCameraMovement,
  SketchMode,
  SketchSceneData,
  SketchShotSize,
} from './sketch-schemas.js';

export const CAMERA_MOVEMENT_LABELS: Record<SketchCameraMovement, string> = {
  static: 'Statique (Fixe)',
  dolly_in: 'Dolly In (Avance)',
  dolly_out: 'Dolly Out (Recul)',
  truck_left: 'Travelling gauche',
  truck_right: 'Travelling droite',
  pan_left: 'Panoramique gauche',
  pan_right: 'Panoramique droite',
  tilt_up: 'Tilt haut (Contre-plongée)',
  tilt_down: 'Tilt bas (Plongée)',
  orbit: 'Orbite / Arc autour du sujet',
  crane: 'Grue / Élévation',
  handheld: 'Caméra épaule (Handheld)',
  zoom_in: 'Zoom avant',
  zoom_out: 'Zoom arrière',
};

export const SHOT_SIZE_LABELS: Record<SketchShotSize, string> = {
  EWS: 'Plan très large (EWS)',
  WS: 'Plan large (WS)',
  MS: 'Plan moyen (MS)',
  MCU: 'Plan rapproché poitrine (MCU)',
  CU: 'Gros plan (CU)',
  ECU: 'Très gros plan (ECU)',
  INSERT: 'Insert détail',
};

/**
 * Computes approximate horizontal field-of-view (in degrees) on a Super35 / Full-Frame
 * cinema sensor for visual camera cone rendering in Scene Plan mode.
 */
export function getFocalLengthFovDeg(focalMm: number): number {
  const clamped = Math.max(12, Math.min(200, Number.isFinite(focalMm) ? focalMm : 35));
  // 36mm horizontal sensor width: FOV = 2 * atan(sensorWidth / (2 * focalMm))
  const rad = 2 * Math.atan(36 / (2 * clamped));
  return Math.round((rad * 180) / Math.PI);
}

/**
 * Returns crisp export canvas dimensions tailored to the requested project aspect ratio.
 */
export function getCanvasDimensionsForAspectRatio(aspectRatio: string): {
  width: number;
  height: number;
} {
  const clean = aspectRatio.trim().toLowerCase();
  if (clean === '9:16') return { width: 1080, height: 1920 };
  if (clean === '1:1') return { width: 1280, height: 1280 };
  if (clean === '4:3') return { width: 1440, height: 1080 };
  if (clean === '4:5') return { width: 1080, height: 1350 };
  if (clean === '2.39:1' || clean === '21:9') return { width: 1920, height: 804 };
  return { width: 1920, height: 1080 };
}

export function createEmptySketchScene(mode: SketchMode = 'scene_plan'): SketchSceneData {
  return {
    version: 1,
    backgroundColor: mode === 'scene_plan' ? '#131720' : '#1b1d24',
    guides: mode === 'scene_plan' ? ['grid'] : ['thirds'],
    show180Line: false,
    line180CharAId: null,
    line180CharBId: null,
    underlay: null,
    cameras: [],
    characters: [],
    lights: [],
    props: [],
    arrows: [],
    strokes: [],
    shapes: [],
    notes: [],
  };
}

function describeScreenZone(x: number, y: number, mode: SketchMode): string {
  const horiz = x < 0.34 ? 'gauche' : x > 0.66 ? 'droite' : 'centre';
  if (mode === 'scene_plan') {
    const depth = y < 0.34 ? 'arrière-plan (nord)' : y > 0.66 ? 'avant-plan (sud)' : 'milieu de scène';
    return `${depth}, ${horiz}`;
  }
  const vert = y < 0.34 ? 'haut' : y > 0.66 ? 'bas' : 'milieu';
  return `${vert}-${horiz} du cadre`;
}

function describeDirectionVector(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle >= -22.5 && angle < 22.5) return 'vers la droite';
  if (angle >= 22.5 && angle < 67.5) return 'en diagonale bas-droite';
  if (angle >= 67.5 && angle < 112.5) return 'vers le bas / avant-plan';
  if (angle >= 112.5 && angle < 157.5) return 'en diagonale bas-gauche';
  if (angle >= 157.5 || angle < -157.5) return 'vers la gauche';
  if (angle >= -157.5 && angle < -112.5) return 'en diagonale haut-gauche';
  if (angle >= -112.5 && angle < -67.5) return 'vers le haut / arrière-plan';
  return 'en diagonale haut-droite';
}

function describeFacingDeg(angleDeg: number): string {
  const rad = (angleDeg * Math.PI) / 180;
  return describeDirectionVector(Math.cos(rad), Math.sin(rad));
}

/**
 * Generates a structured, AI-ready Director Brief from the current blocking diagram and/or
 * storyboard sketch so Claude Code, ComfyUI, and video generation models receive exact
 * spatial staging, camera lens/movement, lighting, and character choreography.
 */
export function generateAiDirectorBrief(
  scene: SketchSceneData,
  opts: { title?: string; mode?: SketchMode; aspectRatio?: string } = {},
): string {
  const mode = opts.mode ?? 'scene_plan';
  const ratio = opts.aspectRatio ?? '16:9';
  const lines: string[] = [];

  lines.push(
    `[BRIEF RÉALISATION — ${mode === 'scene_plan' ? 'PLAN DE SCÈNE (BLOCKING)' : 'CROQUIS STORYBOARD'} | Format ${ratio}]`,
  );
  if (opts.title?.trim()) {
    lines.push(`Plan : ${opts.title.trim()}`);
  }

  if (scene.cameras.length > 0) {
    lines.push('');
    lines.push('CAMÉRA(S) & CADRAGE :');
    for (const cam of scene.cameras) {
      const fov = getFocalLengthFovDeg(cam.focalMm);
      const pos = describeScreenZone(cam.x, cam.y, mode);
      const facing = describeFacingDeg(cam.angleDeg);
      const shotLabel = SHOT_SIZE_LABELS[cam.shotSize] ?? cam.shotSize;
      const moveLabel = CAMERA_MOVEMENT_LABELS[cam.movement] ?? cam.movement;
      const noteSuffix = cam.notes.trim() ? ` — Note: ${cam.notes.trim()}` : '';
      lines.push(
        `- ${cam.label} : ${shotLabel}, optique ${cam.focalMm}mm (FOV ~${fov}°), mouvement "${moveLabel}", placée ${pos}, visant ${facing}.${noteSuffix}`,
      );
    }
  }

  if (scene.characters.length > 0) {
    lines.push('');
    lines.push('PERSONNAGES & PLACEMENT :');
    for (const ch of scene.characters) {
      const pos = describeScreenZone(ch.x, ch.y, mode);
      const facing = describeFacingDeg(ch.angleDeg);
      const details: string[] = [];
      if (ch.pose.trim()) details.push(`pose: ${ch.pose.trim()}`);
      if (ch.action.trim()) details.push(`action: ${ch.action.trim()}`);
      const extra = details.length > 0 ? ` (${details.join(' ; ')})` : '';
      lines.push(`- ${ch.label} : positionné ${pos}, orienté ${facing}${extra}.`);
    }
  }

  if (scene.show180Line && scene.characters.length >= 2) {
    const cA =
      scene.characters.find((c) => c.id === scene.line180CharAId) ?? scene.characters[0];
    const cB =
      scene.characters.find((c) => c.id === scene.line180CharBId) ?? scene.characters[1];
    if (cA && cB) {
      lines.push(
        `CONTINUITÉ (RÈGLE DES 180°) : Ligne d'action active entre ${cA.label} et ${cB.label} — respecter le sens des regards.`,
      );
    }
  }

  if (scene.arrows.length > 0) {
    lines.push('');
    lines.push('TRAJECTOIRES & MOUVEMENTS :');
    for (const arr of scene.arrows) {
      const dir = describeDirectionVector(arr.x2 - arr.x1, arr.y2 - arr.y1);
      const targetLabel =
        arr.target === 'camera'
          ? 'Mouvement caméra'
          : arr.target === 'character'
            ? 'Déplacement personnage'
            : 'Mouvement objet/élément';
      const labelPart = arr.label.trim() ? `"${arr.label.trim()}" — ` : '';
      lines.push(
        `- ${targetLabel} : ${labelPart}trajectoire ${dir} (${describeScreenZone(arr.x1, arr.y1, mode)} → ${describeScreenZone(arr.x2, arr.y2, mode)}).`,
      );
    }
  }

  const zoomShapes = scene.shapes.filter((s) => s.kind === 'zoom_in' || s.kind === 'zoom_out');
  if (zoomShapes.length > 0) {
    lines.push('');
    lines.push('INDICATIONS OPTIQUES SUR CADRE :');
    for (const z of zoomShapes) {
      lines.push(
        `- ${z.kind === 'zoom_in' ? 'Zoom avant (Push-in)' : 'Zoom arrière (Pull-back)'} centré sur ${describeScreenZone((z.x1 + z.x2) / 2, (z.y1 + z.y2) / 2, mode)}.`,
      );
    }
  }

  if (scene.lights.length > 0) {
    lines.push('');
    lines.push('ÉCLAIRAGE :');
    for (const light of scene.lights) {
      const pos = describeScreenZone(light.x, light.y, mode);
      const dir = describeFacingDeg(light.angleDeg);
      lines.push(
        `- ${light.label} (${light.kind.toUpperCase()}, ${light.intensity}%) : placée ${pos}, dirigée ${dir}.`,
      );
    }
  }

  if (scene.props.length > 0) {
    lines.push('');
    lines.push('DÉCOR & ACCESSOIRES :');
    for (const prop of scene.props) {
      lines.push(`- ${prop.label} (${prop.kind}) : ${describeScreenZone(prop.x, prop.y, mode)}.`);
    }
  }

  if (scene.notes.length > 0) {
    lines.push('');
    lines.push('ANNOTATIONS DE CADRAGE :');
    for (const note of scene.notes) {
      lines.push(`- "${note.text}" (${describeScreenZone(note.x, note.y, mode)})`);
    }
  }

  if (scene.underlay?.assetRef) {
    lines.push('');
    lines.push(`IMAGE DE RÉFÉRENCE (FOND) : ${scene.underlay.assetRef}`);
  }

  if (scene.strokes.length > 0) {
    lines.push('');
    lines.push(
      `CROQUIS À MAIN LEVÉE : ${scene.strokes.length} tracé(s) dessiné(s) sur le cadre (utiliser le rendu PNG joint comme guide visuel de composition).`,
    );
  }

  if (
    scene.cameras.length === 0 &&
    scene.characters.length === 0 &&
    scene.arrows.length === 0 &&
    scene.lights.length === 0 &&
    scene.props.length === 0 &&
    scene.strokes.length === 0 &&
    scene.notes.length === 0
  ) {
    lines.push(
      'Scène vierge — place une caméra, des personnages, des flèches de mouvement ou dessine un croquis pour générer automatiquement le brief IA.',
    );
  }

  return lines.join('\n');
}

export type ScenePlanTemplateId =
  | 'blank_plan'
  | 'blank_sketch'
  | 'dialogue_180'
  | 'dolly_approach'
  | 'orbit_hero'
  | 'establishing_entry';

export interface ScenePlanTemplateMeta {
  id: ScenePlanTemplateId;
  label: string;
  mode: SketchMode;
  description: string;
}

export const SCENE_PLAN_TEMPLATES: ScenePlanTemplateMeta[] = [
  {
    id: 'dialogue_180',
    label: 'Dialogue Champ / Contre-champ (180°)',
    mode: 'scene_plan',
    description: 'Deux personnages face à face, ligne des 180°, Cam A & Cam B + Key/Rim Light.',
  },
  {
    id: 'dolly_approach',
    label: 'Travelling d’approche (Dolly In)',
    mode: 'scene_plan',
    description: 'Caméra sur rail avançant vers le sujet central avec éclairage dramatique.',
  },
  {
    id: 'orbit_hero',
    label: 'Orbite héroïque autour du sujet',
    mode: 'scene_plan',
    description: 'Trajectoire courbe en arc autour d’un personnage clé (effet épique).',
  },
  {
    id: 'establishing_entry',
    label: 'Plan d’ensemble + Entrée personnage',
    mode: 'scene_plan',
    description: 'Grand-angle 24mm avec décor/porte et trajectoire d’entrée du personnage.',
  },
  {
    id: 'blank_plan',
    label: 'Plan de scène vierge',
    mode: 'scene_plan',
    description: 'Vue du dessus avec grille 2D prête pour le blocking.',
  },
  {
    id: 'blank_sketch',
    label: 'Croquis Storyboard vierge',
    mode: 'storyboard_sketch',
    description: 'Cadre vierge avec règle des tiers pour dessiner à main levée.',
  },
];

export function buildScenePlanTemplate(
  templateId: ScenePlanTemplateId,
  characterNames: string[] = [],
): { mode: SketchMode; scene: SketchSceneData } {
  const charA = characterNames[0] || 'Personnage A';
  const charB = characterNames[1] || 'Personnage B';

  if (templateId === 'blank_plan') {
    return { mode: 'scene_plan', scene: createEmptySketchScene('scene_plan') };
  }
  if (templateId === 'blank_sketch') {
    return { mode: 'storyboard_sketch', scene: createEmptySketchScene('storyboard_sketch') };
  }

  if (templateId === 'dialogue_180') {
    return {
      mode: 'scene_plan',
      scene: {
        ...createEmptySketchScene('scene_plan'),
        show180Line: true,
        line180CharAId: 'char-a',
        line180CharBId: 'char-b',
        characters: [
          {
            id: 'char-a',
            label: charA,
            x: 0.34,
            y: 0.44,
            angleDeg: 0,
            color: '#4ea8de',
            action: 'Parle avec intensité',
            pose: 'Debout face à droite',
          },
          {
            id: 'char-b',
            label: charB,
            x: 0.66,
            y: 0.44,
            angleDeg: 180,
            color: '#f472b6',
            action: 'Écoute puis répond',
            pose: 'Debout face à gauche',
          },
        ],
        cameras: [
          {
            id: 'cam-a',
            label: 'Cam A (OTS)',
            x: 0.25,
            y: 0.68,
            angleDeg: -32,
            focalMm: 50,
            shotSize: 'MCU',
            movement: 'static',
            color: '#e5a038',
            notes: `Amorce épaule ${charA} vers ${charB}`,
          },
          {
            id: 'cam-b',
            label: 'Cam B (Contre-champ)',
            x: 0.75,
            y: 0.68,
            angleDeg: -148,
            focalMm: 50,
            shotSize: 'MCU',
            movement: 'static',
            color: '#34d399',
            notes: `Contre-champ sur ${charA}`,
          },
        ],
        lights: [
          {
            id: 'light-key',
            label: 'Key Light',
            kind: 'key',
            x: 0.5,
            y: 0.2,
            angleDeg: 90,
            color: '#fbbf24',
            intensity: 85,
          },
        ],
        props: [
          {
            id: 'prop-table',
            label: 'Table',
            kind: 'table',
            x: 0.5,
            y: 0.44,
            w: 0.14,
            h: 0.09,
            angleDeg: 0,
            color: '#64748b',
          },
        ],
      },
    };
  }

  if (templateId === 'dolly_approach') {
    return {
      mode: 'scene_plan',
      scene: {
        ...createEmptySketchScene('scene_plan'),
        characters: [
          {
            id: 'char-hero',
            label: charA,
            x: 0.5,
            y: 0.32,
            angleDeg: 90,
            color: '#4ea8de',
            action: 'Regard déterminé vers la caméra',
            pose: 'Immobile au centre',
          },
        ],
        cameras: [
          {
            id: 'cam-dolly',
            label: 'Cam A (Dolly)',
            x: 0.5,
            y: 0.78,
            angleDeg: -90,
            focalMm: 35,
            shotSize: 'MS',
            movement: 'dolly_in',
            color: '#e5a038',
            notes: 'Travelling avant lent jusqu’en gros plan',
          },
        ],
        arrows: [
          {
            id: 'arr-dolly',
            target: 'camera',
            label: 'Dolly In lent (3s)',
            x1: 0.5,
            y1: 0.73,
            x2: 0.5,
            y2: 0.46,
            color: '#e5a038',
            dashed: true,
            width: 4,
          },
        ],
        lights: [
          {
            id: 'light-key',
            label: 'Key',
            kind: 'key',
            x: 0.26,
            y: 0.48,
            angleDeg: -28,
            color: '#fbbf24',
            intensity: 90,
          },
          {
            id: 'light-rim',
            label: 'Rim Backlight',
            kind: 'rim',
            x: 0.74,
            y: 0.16,
            angleDeg: 145,
            color: '#60a5fa',
            intensity: 75,
          },
        ],
      },
    };
  }

  if (templateId === 'orbit_hero') {
    return {
      mode: 'scene_plan',
      scene: {
        ...createEmptySketchScene('scene_plan'),
        characters: [
          {
            id: 'char-hero',
            label: charA,
            x: 0.5,
            y: 0.48,
            angleDeg: 90,
            color: '#4ea8de',
            action: 'Posture héroïque centrale',
            pose: 'Debout 3/4',
          },
        ],
        cameras: [
          {
            id: 'cam-orbit',
            label: 'Cam A (Orbite)',
            x: 0.28,
            y: 0.72,
            angleDeg: -45,
            focalMm: 35,
            shotSize: 'MS',
            movement: 'orbit',
            color: '#e5a038',
            notes: 'Arc fluide 120° autour du sujet',
          },
        ],
        arrows: [
          {
            id: 'arr-orbit',
            target: 'camera',
            label: 'Orbite 120°',
            x1: 0.3,
            y1: 0.72,
            cx: 0.54,
            cy: 0.84,
            x2: 0.74,
            y2: 0.64,
            color: '#e5a038',
            dashed: true,
            width: 4,
          },
        ],
        lights: [
          {
            id: 'light-rim',
            label: 'Contre-jour',
            kind: 'rim',
            x: 0.5,
            y: 0.16,
            angleDeg: 90,
            color: '#fbbf24',
            intensity: 90,
          },
        ],
      },
    };
  }

  // establishing_entry
  return {
    mode: 'scene_plan',
    scene: {
      ...createEmptySketchScene('scene_plan'),
      props: [
        {
          id: 'prop-wall-top',
          label: 'Mur fond',
          kind: 'wall',
          x: 0.5,
          y: 0.14,
          w: 0.72,
          h: 0.025,
          angleDeg: 0,
          color: '#94a3b8',
        },
        {
          id: 'prop-door',
          label: 'Porte entrée',
          kind: 'door',
          x: 0.22,
          y: 0.16,
          w: 0.09,
          h: 0.03,
          angleDeg: 0,
          color: '#38bdf8',
        },
        {
          id: 'prop-mark',
          label: 'Marque arrêt',
          kind: 'mark',
          x: 0.55,
          y: 0.46,
          w: 0.05,
          h: 0.05,
          angleDeg: 0,
          color: '#f43f5e',
        },
      ],
      characters: [
        {
          id: 'char-enter',
          label: charA,
          x: 0.22,
          y: 0.24,
          angleDeg: 35,
          color: '#4ea8de',
          action: 'Entre par la porte et avance vers le centre',
          pose: 'Marche décidée',
        },
      ],
      cameras: [
        {
          id: 'cam-wide',
          label: 'Cam A (Wide)',
          x: 0.5,
          y: 0.82,
          angleDeg: -90,
          focalMm: 24,
          shotSize: 'WS',
          movement: 'pan_right',
          color: '#e5a038',
          notes: 'Accompagne l’entrée en léger panoramique droite',
        },
      ],
      arrows: [
        {
          id: 'arr-walk',
          target: 'character',
          label: 'Marche vers marque X',
          x1: 0.25,
          y1: 0.27,
          x2: 0.52,
          y2: 0.44,
          color: '#38bdf8',
          dashed: false,
          width: 4,
        },
      ],
    },
  };
}
