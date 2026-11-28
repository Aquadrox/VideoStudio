import {
  CAMERA_MOVEMENT_LABELS,
  getFocalLengthFovDeg,
  type SketchCameraNode,
  type SketchCharacterNode,
  type SketchLightNode,
  type SketchMotionArrow,
  type SketchPropNode,
  type SketchSceneData,
  type SketchShape,
  type SketchStroke,
  type SketchTextNote,
} from '@videostudio/shared';

export type SelectedSketchItem =
  | { kind: 'camera'; id: string }
  | { kind: 'character'; id: string }
  | { kind: 'light'; id: string }
  | { kind: 'prop'; id: string }
  | { kind: 'arrow'; id: string }
  | { kind: 'shape'; id: string }
  | { kind: 'note'; id: string };

export interface RenderSketchOptions {
  width: number;
  height: number;
  selected?: SelectedSketchItem | null;
  underlayImage?: HTMLImageElement | null;
  forExport?: boolean;
  includeGuidesInExport?: boolean;
  previewStroke?: SketchStroke | null;
  previewArrow?: SketchMotionArrow | null;
  previewShape?: SketchShape | null;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawPillLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  accentColor: string,
  scale: number,
): void {
  if (!text.trim()) return;
  ctx.save();
  const fontSize = Math.max(11, Math.round(12 * scale));
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  const metrics = ctx.measureText(text);
  const padX = 7 * scale;
  const padY = 3.5 * scale;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  drawRoundedRect(ctx, cx - w / 2, cy - h / 2, w, h, 5 * scale);
  ctx.fillStyle = 'rgba(13, 16, 23, 0.88)';
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = Math.max(1, 1.2 * scale);
  ctx.stroke();

  ctx.fillStyle = '#f1f5f9';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5 * scale);
  ctx.restore();
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angleRad: number,
  size: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, -size * 0.52);
  ctx.lineTo(-size * 0.72, 0);
  ctx.lineTo(-size, size * 0.52);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawGuides(
  ctx: CanvasRenderingContext2D,
  scene: SketchSceneData,
  w: number,
  h: number,
  scale: number,
): void {
  for (const guide of scene.guides) {
    ctx.save();
    if (guide === 'grid') {
      const step = Math.round(Math.min(w, h) / 14);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      for (let x = step; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      // Subtle center axes
      ctx.strokeStyle = 'rgba(229, 160, 56, 0.14)';
      ctx.setLineDash([4 * scale, 6 * scale]);
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    } else if (guide === 'thirds') {
      ctx.strokeStyle = 'rgba(229, 160, 56, 0.32)';
      ctx.lineWidth = Math.max(1, 1.1 * scale);
      ctx.setLineDash([5 * scale, 5 * scale]);
      for (const f of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(w * f, 0);
        ctx.lineTo(w * f, h);
        ctx.moveTo(0, h * f);
        ctx.lineTo(w, h * f);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(229, 160, 56, 0.65)';
      for (const fx of [1 / 3, 2 / 3]) {
        for (const fy of [1 / 3, 2 / 3]) {
          ctx.beginPath();
          ctx.arc(w * fx, h * fy, 3 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (guide === 'golden') {
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.25)';
      ctx.lineWidth = Math.max(1, 1 * scale);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, h);
      ctx.moveTo(w, 0);
      ctx.lineTo(0, h);
      ctx.stroke();
      for (const f of [0.382, 0.618]) {
        ctx.setLineDash([3 * scale, 5 * scale]);
        ctx.beginPath();
        ctx.moveTo(w * f, 0);
        ctx.lineTo(w * f, h);
        ctx.moveTo(0, h * f);
        ctx.lineTo(w, h * f);
        ctx.stroke();
      }
    } else if (guide === 'crosshair') {
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.28)';
      ctx.lineWidth = Math.max(1, 1.2 * scale);
      const arm = 22 * scale;
      ctx.beginPath();
      ctx.moveTo(w / 2 - arm, h / 2);
      ctx.lineTo(w / 2 + arm, h / 2);
      ctx.moveTo(w / 2, h / 2 - arm);
      ctx.lineTo(w / 2, h / 2 + arm);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 10 * scale, 0, Math.PI * 2);
      ctx.stroke();
    } else if (guide === 'safe_frames') {
      // 90% Action Safe + 80% Title Safe
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.36)';
      ctx.lineWidth = Math.max(1, 1 * scale);
      ctx.setLineDash([6 * scale, 4 * scale]);
      ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.36)';
      ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    }
    ctx.restore();
  }
}

function draw180Line(
  ctx: CanvasRenderingContext2D,
  scene: SketchSceneData,
  w: number,
  h: number,
  scale: number,
): void {
  if (!scene.show180Line || scene.characters.length < 2) return;
  const charA =
    scene.characters.find((c) => c.id === scene.line180CharAId) ?? scene.characters[0];
  const charB =
    scene.characters.find((c) => c.id === scene.line180CharBId) ?? scene.characters[1];
  if (!charA || !charB || charA.id === charB.id) return;

  const ax = charA.x * w;
  const ay = charA.y * h;
  const bx = charB.x * w;
  const by = charB.y * h;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const ux = dx / len;
  const uy = dy / len;
  const extend = Math.max(w, h) * 1.4;

  ctx.save();
  ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.setLineDash([10 * scale, 7 * scale]);
  ctx.beginPath();
  ctx.moveTo(ax - ux * extend, ay - uy * extend);
  ctx.lineTo(bx + ux * extend, by + uy * extend);
  ctx.stroke();
  ctx.setLineDash([]);

  drawPillLabel(ctx, 'LIGNE DES 180°', (ax + bx) / 2, (ay + by) / 2 - 14 * scale, '#f43f5e', scale * 0.9);
  ctx.restore();
}

function drawProp(
  ctx: CanvasRenderingContext2D,
  prop: SketchPropNode,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const cx = prop.x * w;
  const cy = prop.y * h;
  const pw = prop.w * w;
  const ph = prop.h * h;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((prop.angleDeg * Math.PI) / 180);

  if (prop.kind === 'mark') {
    const s = Math.max(12 * scale, Math.min(pw, ph) * 0.5);
    ctx.strokeStyle = prop.color;
    ctx.lineWidth = 3.5 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s, -s);
    ctx.lineTo(s, s);
    ctx.moveTo(s, -s);
    ctx.lineTo(-s, s);
    ctx.stroke();
  } else if (prop.kind === 'door') {
    ctx.strokeStyle = prop.color;
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.moveTo(-pw / 2, 0);
    ctx.lineTo(pw / 2, 0);
    ctx.stroke();
    ctx.setLineDash([4 * scale, 4 * scale]);
    ctx.lineWidth = 1.6 * scale;
    ctx.beginPath();
    ctx.arc(-pw / 2, 0, pw, 0, Math.PI * 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-pw / 2, 0);
    ctx.lineTo(-pw / 2, pw);
    ctx.stroke();
  } else if (prop.kind === 'window') {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    ctx.strokeStyle = prop.color;
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    ctx.beginPath();
    ctx.moveTo(-pw / 2, 0);
    ctx.lineTo(pw / 2, 0);
    ctx.stroke();
  } else if (prop.kind === 'zone') {
    drawRoundedRect(ctx, -pw / 2, -ph / 2, pw, ph, 10 * scale);
    ctx.fillStyle = `${prop.color}1f`;
    ctx.fill();
    ctx.setLineDash([7 * scale, 5 * scale]);
    ctx.strokeStyle = prop.color;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
  } else if (prop.kind === 'wall') {
    ctx.fillStyle = prop.color;
    ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1 * scale;
    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
  } else {
    // table / vehicle
    drawRoundedRect(ctx, -pw / 2, -ph / 2, pw, ph, prop.kind === 'vehicle' ? 12 * scale : 5 * scale);
    ctx.fillStyle = `${prop.color}38`;
    ctx.fill();
    ctx.strokeStyle = prop.color;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
  }

  if (selected) {
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.strokeStyle = '#e5a038';
    ctx.lineWidth = 2 * scale;
    ctx.strokeRect(-pw / 2 - 5 * scale, -ph / 2 - 5 * scale, pw + 10 * scale, ph + 10 * scale);
  }

  ctx.restore();
  if (prop.label) {
    drawPillLabel(ctx, prop.label, cx, cy + ph / 2 + 13 * scale, prop.color, scale * 0.85);
  }
}

function drawLight(
  ctx: CanvasRenderingContext2D,
  light: SketchLightNode,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const cx = light.x * w;
  const cy = light.y * h;
  const rad = (light.angleDeg * Math.PI) / 180;
  const beamLen = 95 * scale * (0.4 + (light.intensity / 100) * 0.8);
  const spreadRad = (28 * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  // Soft volumetric beam
  const grad = ctx.createRadialGradient(0, 0, 4 * scale, 0, 0, beamLen);
  grad.addColorStop(0, `${light.color}66`);
  grad.addColorStop(1, `${light.color}00`);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, beamLen, -spreadRad, spreadRad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Lamp fixture body
  ctx.beginPath();
  ctx.arc(0, 0, 12 * scale, 0, Math.PI * 2);
  ctx.fillStyle = '#0f141e';
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : light.color;
  ctx.lineWidth = (selected ? 3 : 2.2) * scale;
  ctx.stroke();

  // Rays sun symbol
  ctx.beginPath();
  ctx.arc(0, 0, 5.5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = light.color;
  ctx.fill();

  // Barn doors indicator facing forward
  ctx.strokeStyle = light.color;
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(10 * scale, -7 * scale);
  ctx.lineTo(17 * scale, -12 * scale);
  ctx.moveTo(10 * scale, 7 * scale);
  ctx.lineTo(17 * scale, 12 * scale);
  ctx.stroke();

  ctx.restore();
  drawPillLabel(
    ctx,
    `${light.label} (${light.intensity}%)`,
    cx,
    cy + 24 * scale,
    light.color,
    scale * 0.82,
  );
}

function drawCamera(
  ctx: CanvasRenderingContext2D,
  cam: SketchCameraNode,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const cx = cam.x * w;
  const cy = cam.y * h;
  const rad = (cam.angleDeg * Math.PI) / 180;
  const fovDeg = getFocalLengthFovDeg(cam.focalMm);
  const halfFov = ((fovDeg / 2) * Math.PI) / 180;
  const coneDist = Math.min(w, h) * 0.34;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  // FOV Cone with subtle cinema gradient
  const grad = ctx.createRadialGradient(0, 0, 10 * scale, 0, 0, coneDist);
  grad.addColorStop(0, `${cam.color}42`);
  grad.addColorStop(1, `${cam.color}05`);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, coneDist, -halfFov, halfFov);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = `${cam.color}aa`;
  ctx.lineWidth = 1.4 * scale;
  ctx.setLineDash([6 * scale, 5 * scale]);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(-halfFov) * coneDist, Math.sin(-halfFov) * coneDist);
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(halfFov) * coneDist, Math.sin(halfFov) * coneDist);
  ctx.stroke();
  ctx.setLineDash([]);

  // Cinema camera body + matte box lens hood
  const bw = 28 * scale;
  const bh = 20 * scale;
  drawRoundedRect(ctx, -bw / 2, -bh / 2, bw, bh, 4 * scale);
  ctx.fillStyle = '#0c1018';
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : cam.color;
  ctx.lineWidth = (selected ? 3 : 2.4) * scale;
  ctx.stroke();

  // Matte box trapezoid
  ctx.beginPath();
  ctx.moveTo(bw / 2, -6 * scale);
  ctx.lineTo(bw / 2 + 10 * scale, -11 * scale);
  ctx.lineTo(bw / 2 + 10 * scale, 11 * scale);
  ctx.lineTo(bw / 2, 6 * scale);
  ctx.closePath();
  ctx.fillStyle = cam.color;
  ctx.fill();

  // Film reels / top indicator
  ctx.fillStyle = cam.color;
  ctx.beginPath();
  ctx.arc(-4 * scale, 0, 3.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  const moveShort =
    cam.movement !== 'static' ? ` · ${CAMERA_MOVEMENT_LABELS[cam.movement].split(' ')[0]}` : '';
  drawPillLabel(
    ctx,
    `${cam.label} · ${cam.focalMm}mm · ${cam.shotSize}${moveShort}`,
    cx,
    cy + 27 * scale,
    cam.color,
    scale * 0.88,
  );
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  ch: SketchCharacterNode,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const cx = ch.x * w;
  const cy = ch.y * h;
  const rad = (ch.angleDeg * Math.PI) / 180;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);

  // Shoulders silhouette (top-down cinema blocking symbol)
  ctx.beginPath();
  ctx.ellipse(0, 0, 11 * scale, 22 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = `${ch.color}38`;
  ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : ch.color;
  ctx.lineWidth = (selected ? 3 : 2.2) * scale;
  ctx.stroke();

  // Head circle
  ctx.beginPath();
  ctx.arc(2 * scale, 0, 9.5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = ch.color;
  ctx.fill();
  ctx.strokeStyle = '#0c1018';
  ctx.lineWidth = 2 * scale;
  ctx.stroke();

  // Nose / facing direction pointer
  ctx.beginPath();
  ctx.moveTo(11 * scale, -4.5 * scale);
  ctx.lineTo(20 * scale, 0);
  ctx.lineTo(11 * scale, 4.5 * scale);
  ctx.closePath();
  ctx.fillStyle = '#f8fafc';
  ctx.fill();

  ctx.restore();

  const label = ch.action.trim() ? `${ch.label} — ${ch.action.slice(0, 28)}` : ch.label;
  drawPillLabel(ctx, label, cx, cy + 31 * scale, ch.color, scale * 0.88);
}

function drawMotionArrow(
  ctx: CanvasRenderingContext2D,
  arrow: SketchMotionArrow,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const x1 = arrow.x1 * w;
  const y1 = arrow.y1 * h;
  const x2 = arrow.x2 * w;
  const y2 = arrow.y2 * h;
  const hasCurve = arrow.cx !== undefined && arrow.cy !== undefined;
  const cx = hasCurve ? arrow.cx! * w : (x1 + x2) / 2;
  const cy = hasCurve ? arrow.cy! * h : (y1 + y2) / 2;

  ctx.save();
  ctx.strokeStyle = selected ? '#ffffff' : arrow.color;
  ctx.lineWidth = (arrow.width + (selected ? 1.5 : 0)) * scale;
  ctx.lineCap = 'round';
  if (arrow.dashed) {
    ctx.setLineDash([10 * scale, 7 * scale]);
  }
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (hasCurve) {
    ctx.quadraticCurveTo(cx, cy, x2, y2);
  } else {
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Start anchor dot
  ctx.fillStyle = arrow.color;
  ctx.beginPath();
  ctx.arc(x1, y1, 4.5 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Arrowhead along tangent at endpoint
  const tangentX = hasCurve ? x2 - cx : x2 - x1;
  const tangentY = hasCurve ? y2 - cy : y2 - y1;
  const endAngle = Math.atan2(tangentY, tangentX);
  drawArrowHead(ctx, x2, y2, endAngle, Math.max(13, arrow.width * 3.8) * scale, arrow.color);
  ctx.restore();

  if (arrow.label.trim()) {
    const midX = hasCurve ? 0.25 * x1 + 0.5 * cx + 0.25 * x2 : (x1 + x2) / 2;
    const midY = hasCurve ? 0.25 * y1 + 0.5 * cy + 0.25 * y2 : (y1 + y2) / 2;
    drawPillLabel(ctx, arrow.label, midX, midY - 14 * scale, arrow.color, scale * 0.85);
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: SketchShape,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const x1 = shape.x1 * w;
  const y1 = shape.y1 * h;
  const x2 = shape.x2 * w;
  const y2 = shape.y2 * h;

  ctx.save();
  ctx.strokeStyle = selected ? '#ffffff' : shape.color;
  ctx.lineWidth = shape.width * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (shape.dashed) ctx.setLineDash([8 * scale, 5 * scale]);

  if (shape.kind === 'line' || shape.kind === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (shape.kind === 'arrow') {
      ctx.setLineDash([]);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      drawArrowHead(ctx, x2, y2, angle, Math.max(12, shape.width * 3.5) * scale, shape.color);
    }
  } else if (shape.kind === 'rect') {
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.abs(x2 - x1);
    const rh = Math.abs(y2 - y1);
    if (shape.fill) {
      ctx.fillStyle = `${shape.color}28`;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.strokeRect(rx, ry, rw, rh);
  } else if (shape.kind === 'ellipse') {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.max(2, Math.abs(x2 - x1) / 2);
    const ry = Math.max(2, Math.abs(y2 - y1) / 2);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    if (shape.fill) {
      ctx.fillStyle = `${shape.color}28`;
      ctx.fill();
    }
    ctx.stroke();
  } else if (shape.kind === 'zoom_in' || shape.kind === 'zoom_out') {
    // Classic filmmaking storyboard 4-corner zoom indicator
    const rx = Math.min(x1, x2);
    const ry = Math.min(y1, y2);
    const rw = Math.max(40 * scale, Math.abs(x2 - x1));
    const rh = Math.max(26 * scale, Math.abs(y2 - y1));
    ctx.setLineDash([6 * scale, 4 * scale]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.setLineDash([]);

    const corners = [
      { ox: rx - 24 * scale, oy: ry - 16 * scale, ix: rx, iy: ry },
      { ox: rx + rw + 24 * scale, oy: ry - 16 * scale, ix: rx + rw, iy: ry },
      { ox: rx - 24 * scale, oy: ry + rh + 16 * scale, ix: rx, iy: ry + rh },
      { ox: rx + rw + 24 * scale, oy: ry + rh + 16 * scale, ix: rx + rw, iy: ry + rh },
    ];
    for (const c of corners) {
      const fromX = shape.kind === 'zoom_in' ? c.ox : c.ix;
      const fromY = shape.kind === 'zoom_in' ? c.oy : c.iy;
      const toX = shape.kind === 'zoom_in' ? c.ix : c.ox;
      const toY = shape.kind === 'zoom_in' ? c.iy : c.oy;
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
      drawArrowHead(
        ctx,
        toX,
        toY,
        Math.atan2(toY - fromY, toX - fromX),
        10 * scale,
        shape.color,
      );
    }
    drawPillLabel(
      ctx,
      shape.kind === 'zoom_in' ? 'ZOOM IN' : 'ZOOM OUT',
      rx + rw / 2,
      ry - 14 * scale,
      shape.color,
      scale * 0.8,
    );
  }
  ctx.restore();
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: SketchStroke,
  w: number,
  h: number,
  scale: number,
): void {
  if (stroke.points.length === 0) return;
  ctx.save();
  ctx.globalAlpha = stroke.tool === 'marker' ? Math.min(stroke.opacity, 0.42) : stroke.opacity;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = (stroke.tool === 'marker' ? stroke.width * 2.8 : stroke.width) * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const pts = stroke.points;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x * w, pts[0]!.y * h);
  if (pts.length === 1) {
    ctx.lineTo(pts[0]!.x * w + 0.5, pts[0]!.y * h + 0.5);
  } else {
    for (let i = 1; i < pts.length - 1; i += 1) {
      const curr = pts[i]!;
      const next = pts[i + 1]!;
      const midX = ((curr.x + next.x) / 2) * w;
      const midY = ((curr.y + next.y) / 2) * h;
      ctx.quadraticCurveTo(curr.x * w, curr.y * h, midX, midY);
    }
    const last = pts[pts.length - 1]!;
    ctx.lineTo(last.x * w, last.y * h);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTextNote(
  ctx: CanvasRenderingContext2D,
  note: SketchTextNote,
  w: number,
  h: number,
  scale: number,
  selected: boolean,
): void {
  const x = note.x * w;
  const y = note.y * h;
  const size = Math.max(11, Math.round(note.fontSize * scale));

  ctx.save();
  ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
  const metrics = ctx.measureText(note.text);
  const padX = 8 * scale;
  const padY = 4 * scale;
  const bw = metrics.width + padX * 2;
  const bh = size + padY * 2;

  if (note.badge) {
    drawRoundedRect(ctx, x - bw / 2, y - bh / 2, bw, bh, 6 * scale);
    ctx.fillStyle = 'rgba(13, 16, 23, 0.88)';
    ctx.fill();
    ctx.strokeStyle = selected ? '#ffffff' : note.color;
    ctx.lineWidth = (selected ? 2.4 : 1.5) * scale;
    ctx.stroke();
  } else if (selected) {
    ctx.setLineDash([4 * scale, 3 * scale]);
    ctx.strokeStyle = '#e5a038';
    ctx.lineWidth = 1.5 * scale;
    ctx.strokeRect(x - bw / 2, y - bh / 2, bw, bh);
  }

  ctx.fillStyle = note.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(note.text, x, y + 0.5 * scale);
  ctx.restore();
}

/**
 * Returns the canvas-normalized coordinates of the rotation handle for rotatable nodes.
 */
export function getRotationHandlePos(
  scene: SketchSceneData,
  selected: SelectedSketchItem | null,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (!selected) return null;
  let node: { x: number; y: number; angleDeg: number } | undefined;
  if (selected.kind === 'camera') node = scene.cameras.find((c) => c.id === selected.id);
  else if (selected.kind === 'character') node = scene.characters.find((c) => c.id === selected.id);
  else if (selected.kind === 'light') node = scene.lights.find((l) => l.id === selected.id);
  else if (selected.kind === 'prop') node = scene.props.find((p) => p.id === selected.id);
  if (!node) return null;

  const scale = Math.min(width, height) / 720;
  const distPx = 46 * scale;
  const rad = (node.angleDeg * Math.PI) / 180;
  return {
    x: node.x + (Math.cos(rad) * distPx) / width,
    y: node.y + (Math.sin(rad) * distPx) / height,
  };
}

export function renderSketchToCanvas(
  ctx: CanvasRenderingContext2D,
  scene: SketchSceneData,
  opts: RenderSketchOptions,
): void {
  const { width: w, height: h, selected = null, forExport = false } = opts;
  const scale = Math.min(w, h) / 720;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // 1. Background
  ctx.fillStyle = scene.backgroundColor || '#131720';
  ctx.fillRect(0, 0, w, h);

  // 2. Reference Image Underlay
  if (opts.underlayImage && scene.underlay) {
    const img = opts.underlayImage;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const canvasAspect = w / h;
      let drawW = w;
      let drawH = h;
      let drawX = 0;
      let drawY = 0;
      if (imgAspect > canvasAspect) {
        drawH = w / imgAspect;
        drawY = (h - drawH) / 2;
      } else {
        drawW = h * imgAspect;
        drawX = (w - drawW) / 2;
      }
      ctx.save();
      ctx.globalAlpha = scene.underlay.opacity;
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      ctx.restore();
    }
  }

  // 3. Cinema / Blocking Guides
  if (!forExport || opts.includeGuidesInExport) {
    drawGuides(ctx, scene, w, h, scale);
  }

  // 4. 180° Line of Action
  draw180Line(ctx, scene, w, h, scale);

  // 5. Props & Decor
  for (const prop of scene.props) {
    drawProp(ctx, prop, w, h, scale, !forExport && selected?.kind === 'prop' && selected.id === prop.id);
  }

  // 6. Lights
  for (const light of scene.lights) {
    drawLight(ctx, light, w, h, scale, !forExport && selected?.kind === 'light' && selected.id === light.id);
  }

  // 7. Motion Arrows
  for (const arrow of scene.arrows) {
    drawMotionArrow(
      ctx,
      arrow,
      w,
      h,
      scale,
      !forExport && selected?.kind === 'arrow' && selected.id === arrow.id,
    );
  }
  if (opts.previewArrow) {
    drawMotionArrow(ctx, opts.previewArrow, w, h, scale, false);
  }

  // 8. Geometric Shapes & Zoom Indicators
  for (const shape of scene.shapes) {
    drawShape(
      ctx,
      shape,
      w,
      h,
      scale,
      !forExport && selected?.kind === 'shape' && selected.id === shape.id,
    );
  }
  if (opts.previewShape) {
    drawShape(ctx, opts.previewShape, w, h, scale, false);
  }

  // 9. Freehand Strokes
  for (const stroke of scene.strokes) {
    drawStroke(ctx, stroke, w, h, scale);
  }
  if (opts.previewStroke) {
    drawStroke(ctx, opts.previewStroke, w, h, scale);
  }

  // 10. Cameras
  for (const cam of scene.cameras) {
    drawCamera(
      ctx,
      cam,
      w,
      h,
      scale,
      !forExport && selected?.kind === 'camera' && selected.id === cam.id,
    );
  }

  // 11. Characters
  for (const ch of scene.characters) {
    drawCharacter(
      ctx,
      ch,
      w,
      h,
      scale,
      !forExport && selected?.kind === 'character' && selected.id === ch.id,
    );
  }

  // 12. Text Notes
  for (const note of scene.notes) {
    drawTextNote(
      ctx,
      note,
      w,
      h,
      scale,
      !forExport && selected?.kind === 'note' && selected.id === note.id,
    );
  }

  // 13. Interactive Rotation Handle
  if (!forExport && selected) {
    const handle = getRotationHandlePos(scene, selected, w, h);
    if (handle) {
      const hx = handle.x * w;
      const hy = handle.y * h;
      let ox = 0;
      let oy = 0;
      if (selected.kind === 'camera') {
        const n = scene.cameras.find((c) => c.id === selected.id);
        if (n) { ox = n.x * w; oy = n.y * h; }
      } else if (selected.kind === 'character') {
        const n = scene.characters.find((c) => c.id === selected.id);
        if (n) { ox = n.x * w; oy = n.y * h; }
      } else if (selected.kind === 'light') {
        const n = scene.lights.find((l) => l.id === selected.id);
        if (n) { ox = n.x * w; oy = n.y * h; }
      } else if (selected.kind === 'prop') {
        const n = scene.props.find((p) => p.id === selected.id);
        if (n) { ox = n.x * w; oy = n.y * h; }
      }
      ctx.save();
      ctx.strokeStyle = '#e5a038';
      ctx.lineWidth = 1.6 * scale;
      ctx.setLineDash([3 * scale, 3 * scale]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(hx, hy, 7 * scale, 0, Math.PI * 2);
      ctx.fillStyle = '#e5a038';
      ctx.fill();
      ctx.strokeStyle = '#0c1018';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}

function pointToSegmentDistPx(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTestSketchScene(
  scene: SketchSceneData,
  nx: number,
  ny: number,
  width: number,
  height: number,
): SelectedSketchItem | null {
  const px = nx * width;
  const py = ny * height;
  const scale = Math.min(width, height) / 720;

  // Top-most layers first: notes -> characters -> cameras -> lights -> arrows -> shapes -> props
  for (let i = scene.notes.length - 1; i >= 0; i -= 1) {
    const n = scene.notes[i]!;
    if (Math.hypot(px - n.x * width, py - n.y * height) <= 36 * scale) {
      return { kind: 'note', id: n.id };
    }
  }
  for (let i = scene.characters.length - 1; i >= 0; i -= 1) {
    const c = scene.characters[i]!;
    if (Math.hypot(px - c.x * width, py - c.y * height) <= 28 * scale) {
      return { kind: 'character', id: c.id };
    }
  }
  for (let i = scene.cameras.length - 1; i >= 0; i -= 1) {
    const c = scene.cameras[i]!;
    if (Math.hypot(px - c.x * width, py - c.y * height) <= 28 * scale) {
      return { kind: 'camera', id: c.id };
    }
  }
  for (let i = scene.lights.length - 1; i >= 0; i -= 1) {
    const l = scene.lights[i]!;
    if (Math.hypot(px - l.x * width, py - l.y * height) <= 24 * scale) {
      return { kind: 'light', id: l.id };
    }
  }
  for (let i = scene.arrows.length - 1; i >= 0; i -= 1) {
    const a = scene.arrows[i]!;
    const d = pointToSegmentDistPx(
      px,
      py,
      a.x1 * width,
      a.y1 * height,
      a.x2 * width,
      a.y2 * height,
    );
    if (d <= 16 * scale) {
      return { kind: 'arrow', id: a.id };
    }
  }
  for (let i = scene.shapes.length - 1; i >= 0; i -= 1) {
    const s = scene.shapes[i]!;
    const minX = Math.min(s.x1, s.x2) * width - 10 * scale;
    const maxX = Math.max(s.x1, s.x2) * width + 10 * scale;
    const minY = Math.min(s.y1, s.y2) * height - 10 * scale;
    const maxY = Math.max(s.y1, s.y2) * height + 10 * scale;
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      return { kind: 'shape', id: s.id };
    }
  }
  for (let i = scene.props.length - 1; i >= 0; i -= 1) {
    const p = scene.props[i]!;
    const halfW = Math.max(20 * scale, (p.w * width) / 2);
    const halfH = Math.max(20 * scale, (p.h * height) / 2);
    if (Math.abs(px - p.x * width) <= halfW && Math.abs(py - p.y * height) <= halfH) {
      return { kind: 'prop', id: p.id };
    }
  }
  return null;
}

export function eraseStrokesNearPoint(
  strokes: SketchStroke[],
  nx: number,
  ny: number,
  radiusNorm = 0.025,
): SketchStroke[] {
  return strokes.filter(
    (s) => !s.points.some((pt) => Math.hypot(pt.x - nx, pt.y - ny) <= radiusNorm),
  );
}
