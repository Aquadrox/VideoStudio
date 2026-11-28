#!/usr/bin/env python3
"""
VideoStudio WYSIWYG AMV Segment Renderer (Python Pillow + NumPy -> FFmpeg Pipe).
Executes the EXACT SAME deterministic PRNG (FNV-1a + Mulberry32), camera math
(mode, beatPulseAmp, shakeAmp, tremorAmp, rotDeg), mangaBlink (2-frame B&W inversion),
additive radial/directional speed lines, additive glowing particles, flashIn,
fadeOutBlack, textOverlay (subtitle, strokeColor, glowColor), and easeInOutCubic
Cinemascope bars as the Web UI `<TimelinePreviewCanvas>`.

Usage:
  python3 render_amv_segment.py --spec /path/to/spec.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


# ---------------------------------------------------------------------------
# Deterministic PRNG (EXACT 32-bit match to packages/shared/src/amv-engine.ts)
# ---------------------------------------------------------------------------

def hash_string_32(text: str) -> int:
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch) & 0xFF
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


class Mulberry32:
    def __init__(self, seed_str: str) -> None:
        self.state = hash_string_32(seed_str)

    def next(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = ((self.state ^ (self.state >> 15)) * (1 | self.state)) & 0xFFFFFFFF
        inner = ((t ^ (t >> 7)) * (61 | t)) & 0xFFFFFFFF
        t = ((t + inner) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0


def ease_in_out_cubic(raw_p: float) -> float:
    p = max(0.0, min(1.0, raw_p))
    if p < 0.5:
        return 4.0 * p * p * p
    return 1.0 - math.pow(-2.0 * p + 2.0, 3.0) / 2.0


def hex_to_rgb(hex_color: str, fallback: Tuple[int, int, int] = (255, 255, 255)) -> Tuple[int, int, int]:
    c = (hex_color or "").strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) >= 6:
        try:
            return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
        except ValueError:
            return fallback
    return fallback


# ---------------------------------------------------------------------------
# Camera, Cinemascope & FX Evaluation (1:1 parity with amv-engine.ts)
# ---------------------------------------------------------------------------

def evaluate_camera_frame(
    clip_id: str,
    cam: Optional[Dict[str, Any]],
    nfx: Dict[str, Any],
    local_t: float,
    dur: float,
    fps: int,
    beat_times: List[float],
) -> Tuple[float, float, float, float, float, float]:
    frame_idx = max(0, int(math.floor(local_t * fps + 1e-6)))
    p = max(0.0, min(1.0, local_t / max(0.05, dur)))

    z = 1.0
    cx = 0.5
    cy = 0.5
    rot_deg = 0.0

    if cam:
        mode = cam.get("mode", "static")
        if mode == "crash_zoom":
            curve = math.pow(p, 2.4)
        elif mode == "power_pullback":
            curve = 1.0 - math.pow(1.0 - p, 3.0)
        elif mode in ("ease", "push", "pull_back", "pan", "p05_vertigo"):
            curve = ease_in_out_cubic(p)
        else:
            curve = p

        z0 = float(cam.get("z0", 1.0))
        z1 = float(cam.get("z1", 1.0))
        cx0 = float(cam.get("cx0", 0.5))
        cx1 = float(cam.get("cx1", 0.5))
        cy0 = float(cam.get("cy0", 0.5))
        cy1 = float(cam.get("cy1", 0.5))
        rot_cfg = float(cam.get("rotDeg", 0.0))
        beat_amp = float(cam.get("beatPulseAmp", 0.0))

        z = z0 + (z1 - z0) * curve
        cx = cx0 + (cx1 - cx0) * curve
        cy = cy0 + (cy1 - cy0) * curve
        rot_deg = rot_cfg * (math.sin(p * math.pi) if mode == "p05_vertigo" else curve)

        if mode == "p05_vertigo":
            z += 0.04 * math.sin(local_t * math.pi)

        if beat_amp > 0.002:
            pulse = 0.0
            if beat_times:
                for bt in beat_times:
                    if local_t >= bt:
                        pulse += beat_amp * math.exp(-16.0 * (local_t - bt))
            else:
                pulse += beat_amp * math.exp(-14.0 * (local_t % 0.5))
            z += pulse

    shake_amp = max(float(cam.get("shakeAmp", 0.0)) if cam else 0.0, float(nfx.get("legacyShakeAmp", 0.0)))
    tremor_amp = max(float(cam.get("tremorAmp", 0.0)) if cam else 0.0, float(nfx.get("legacyTremorAmp", 0.0)))

    dx = 0.0
    dy = 0.0
    if shake_amp > 0.001 or tremor_amp > 0.001:
        rng = Mulberry32(f"{clip_id}:cam:{frame_idx}")
        rx = rng.next() * 2.0 - 1.0
        ry = rng.next() * 2.0 - 1.0
        r_rot = rng.next() * 2.0 - 1.0

        if shake_amp > 0.001:
            decay = math.exp(-7.0 * local_t)
            amp = shake_amp * 0.035 * decay
            dx += rx * amp
            dy += ry * amp
            rot_deg += r_rot * shake_amp * 2.2 * decay
            z = max(z, 1.0 + shake_amp * 0.08 * decay)

        if tremor_amp > 0.001:
            amp = tremor_amp * 0.022
            dx += rx * amp
            dy += ry * amp
            rot_deg += r_rot * tremor_amp * 1.4
            z = max(z, 1.0 + tremor_amp * 0.07)

    return max(0.5, z), max(0.0, min(1.0, cx)), max(0.0, min(1.0, cy)), dx, dy, rot_deg


def evaluate_cinemascope_bar(scope: Optional[Dict[str, Any]], local_t: float, dur: float) -> float:
    if not scope:
        return 0.0
    bar0 = max(0.0, min(0.45, float(scope.get("bar0", 0.0))))
    bar1 = max(0.0, min(0.45, float(scope.get("bar1", bar0))))
    if bar0 < 0.001 and bar1 < 0.001:
        return 0.0
    p = max(0.0, min(1.0, local_t / max(0.05, dur)))
    return bar0 + (bar1 - bar0) * ease_in_out_cubic(p)


def load_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, font_size)
            except Exception:
                continue
    return ImageFont.load_default()


def fit_cover_or_contain(img: Image.Image, target_w: int, target_h: int) -> Image.Image:
    # Preserve aspect ratio with letterbox-fit (matches FFmpeg scale+pad & Web Canvas)
    src_w, src_h = img.size
    if src_w == target_w and src_h == target_h:
        return img
    scale = min(target_w / max(1, src_w), target_h / max(1, src_h))
    new_w = max(2, int(round(src_w * scale)))
    new_h = max(2, int(round(src_h * scale)))
    resized = img.resize((new_w, new_h), Image.Resampling.BICUBIC)
    canvas = Image.new("RGB", (target_w, target_h), (0, 0, 0))
    canvas.paste(resized, ((target_w - new_w) // 2, (target_h - new_h) // 2))
    return canvas


def apply_camera_transform(
    frame: Image.Image,
    target_w: int,
    target_h: int,
    z: float,
    cx: float,
    cy: float,
    dx: float,
    dy: float,
    rot_deg: float,
) -> Image.Image:
    if abs(z - 1.0) < 0.002 and abs(cx - 0.5) < 0.002 and abs(cy - 0.5) < 0.002 and abs(dx) < 0.0005 and abs(dy) < 0.0005 and abs(rot_deg) < 0.05:
        return frame

    w, h = frame.size
    crop_w = max(16.0, min(float(w), w / max(0.5, z)))
    crop_h = max(16.0, min(float(h), h / max(0.5, z)))
    center_x = w * cx - dx * w
    center_y = h * cy - dy * h
    left = max(0.0, min(w - crop_w, center_x - crop_w / 2.0))
    top = max(0.0, min(h - crop_h, center_y - crop_h / 2.0))

    cropped = frame.crop((left, top, left + crop_w, top + crop_h))
    out = cropped.resize((target_w, target_h), Image.Resampling.BICUBIC)
    if abs(rot_deg) >= 0.05:
        out = out.rotate(-rot_deg, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=(0, 0, 0))
    return out


def render_frame_fx(
    base_img: Image.Image,
    clip_id: str,
    frame_idx: int,
    local_t: float,
    dur: float,
    fps: int,
    width: int,
    height: int,
    cam: Optional[Dict[str, Any]],
    scope: Optional[Dict[str, Any]],
    nfx: Dict[str, Any],
    beat_times: List[float],
    clip_fade_in: float,
    clip_fade_out: float,
    text_overlay: Optional[Dict[str, Any]],
) -> np.ndarray:
    z, cx, cy, dx, dy, rot_deg = evaluate_camera_frame(clip_id, cam, nfx, local_t, dur, fps, beat_times)
    frame = apply_camera_transform(base_img, width, height, z, cx, cy, dx, dy, rot_deg)
    arr = np.asarray(frame, dtype=np.float32)

    # 1. Manga Ink Blink (high-contrast monochrome + inversion every 2 frames)
    if nfx.get("mangaBlink"):
        luma = arr[:, :, 0] * 0.299 + arr[:, :, 1] * 0.587 + arr[:, :, 2] * 0.114
        ink = np.clip((luma - 128.0) * 2.25 + 128.0, 0.0, 255.0)
        if (frame_idx // 2) % 2 == 1:
            ink = 255.0 - ink
        arr = np.stack([ink, ink, ink], axis=-1)

    # 2. Additive AMV overlays (radialSpeedLines, horizSpeedLines, particles, flashIn)
    add_layer: Optional[Image.Image] = None
    draw: Optional[ImageDraw.ImageDraw] = None

    def ensure_add_layer() -> ImageDraw.ImageDraw:
        nonlocal add_layer, draw
        if add_layer is None:
            add_layer = Image.new("RGB", (width, height), (0, 0, 0))
            draw = ImageDraw.Draw(add_layer)
        assert draw is not None
        return draw

    radial = nfx.get("radialSpeedLines")
    if radial and float(radial.get("intensity", 0)) > 0.01:
        d = ensure_add_layer()
        color = hex_to_rgb(radial.get("color", "#FFFFFF"))
        intensity = max(0.0, min(2.0, float(radial.get("intensity", 0.75))))
        count = max(4, min(200, int(round(radial.get("count", 48)))))
        rng = Mulberry32(f"{clip_id}:radial:{frame_idx // 2}")
        cx_px, cy_px = width * 0.5, height * 0.5
        max_r = math.hypot(cx_px, cy_px)
        for i in range(count):
            base_ang = (i / count) * math.pi * 2.0
            jitter = (rng.next() - 0.5) * ((math.pi * 2.0) / count) * 0.85
            ang = base_ang + jitter
            r_in = (0.24 + rng.next() * 0.28) * max_r
            r_out = (0.72 + rng.next() * 0.28) * max_r
            lw = max(1, int(round((0.0014 + rng.next() * 0.0038) * width * min(1.4, 0.7 + intensity * 0.4))))
            alpha = min(1.0, (0.28 + rng.next() * 0.55) * intensity)
            col = (int(color[0] * alpha), int(color[1] * alpha), int(color[2] * alpha))
            x0 = cx_px + math.cos(ang) * r_in
            y0 = cy_px + math.sin(ang) * r_in
            x1 = cx_px + math.cos(ang) * r_out
            y1 = cy_px + math.sin(ang) * r_out
            d.line([(x0, y0), (x1, y1)], fill=col, width=lw)

    hspeed = nfx.get("horizSpeedLines")
    if hspeed and float(hspeed.get("intensity", 0)) > 0.01:
        d = ensure_add_layer()
        color = hex_to_rgb(hspeed.get("color", "#FFFFFF"))
        direction = hspeed.get("direction", "left")
        intensity = max(0.0, min(2.0, float(hspeed.get("intensity", 0.75))))
        count = max(12, min(90, int(round(32 * intensity))))
        rng = Mulberry32(f"{clip_id}:hspeed:{direction}:{frame_idx // 2}")
        dx_dir, dy_dir = (-1.0, 0.0)
        if direction == "right":
            dx_dir, dy_dir = (1.0, 0.0)
        elif direction == "diag_up":
            dx_dir, dy_dir = (0.866, -0.5)
        elif direction == "vert_down":
            dx_dir, dy_dir = (0.0, 1.0)
        diag = math.hypot(width, height)
        for _ in range(count):
            x0 = rng.next() * width
            y0 = rng.next() * height
            length = (0.14 + rng.next() * 0.32) * diag
            lw = max(1, int(round((0.0012 + rng.next() * 0.0032) * width * min(1.4, 0.75 + intensity * 0.35))))
            alpha = min(1.0, (0.22 + rng.next() * 0.52) * intensity)
            col = (int(color[0] * alpha), int(color[1] * alpha), int(color[2] * alpha))
            d.line([(x0, y0), (x0 + dx_dir * length, y0 + dy_dir * length)], fill=col, width=lw)

    particles = nfx.get("particles")
    if particles and int(particles.get("count", 0)) > 0 and float(particles.get("intensity", 0.85)) > 0.01:
        d = ensure_add_layer()
        color = hex_to_rgb(particles.get("color", "#F5B942"))
        count = max(1, min(200, int(round(particles.get("count", 32)))))
        intensity = max(0.0, min(2.0, float(particles.get("intensity", 0.85))))
        rng = Mulberry32(f"{clip_id}:particles:init")
        for _ in range(count):
            x0 = rng.next()
            y0 = rng.next()
            speed_y = 0.06 + rng.next() * 0.16
            drift_amp = 0.015 + rng.next() * 0.035
            drift_freq = 0.8 + rng.next() * 2.2
            phase = rng.next() * math.pi * 2.0
            rad_px = max(2.0, (0.0035 + rng.next() * 0.011) * width)
            base_alpha = 0.35 + rng.next() * 0.55
            yf = (y0 - local_t * speed_y) % 1.0
            xf = (x0 + math.sin(local_t * drift_freq + phase) * drift_amp) % 1.0
            twinkle = 0.65 + 0.35 * math.sin(local_t * (2.5 + drift_freq) + phase)
            alpha = min(1.0, base_alpha * twinkle * intensity)
            cx_o, cy_o = xf * width, yf * height
            # Soft outer halo + bright core
            halo_col = (int(color[0] * alpha * 0.4), int(color[1] * alpha * 0.4), int(color[2] * alpha * 0.4))
            core_col = (int(color[0] * alpha), int(color[1] * alpha), int(color[2] * alpha))
            d.ellipse([cx_o - rad_px * 1.8, cy_o - rad_px * 1.8, cx_o + rad_px * 1.8, cy_o + rad_px * 1.8], fill=halo_col)
            d.ellipse([cx_o - rad_px * 0.7, cy_o - rad_px * 0.7, cx_o + rad_px * 0.7, cy_o + rad_px * 0.7], fill=core_col)

    if add_layer is not None:
        if particles:
            add_layer = add_layer.filter(ImageFilter.GaussianBlur(radius=1.2))
        arr = np.clip(arr + np.asarray(add_layer, dtype=np.float32), 0.0, 255.0)

    # 3. Flash-In additive wash
    flash = nfx.get("flashIn")
    if flash and float(flash.get("alpha", 0)) > 0.01:
        flash_dur = max(1.0 / max(1, fps), int(flash.get("frames", 6)) / max(1, fps))
        if 0.0 <= local_t < flash_dur:
            f_alpha = float(flash.get("alpha", 0.85)) * math.pow(1.0 - local_t / flash_dur, 1.5)
            f_rgb = np.array(hex_to_rgb(flash.get("color", "#FFFFFF")), dtype=np.float32)
            arr = np.clip(arr + f_rgb * f_alpha, 0.0, 255.0)

    # 4. Clip Fade-In / Fade-Out to black
    if clip_fade_in > 0.02 and local_t < clip_fade_in:
        arr *= max(0.0, min(1.0, local_t / clip_fade_in))
    fade_out_dur = max(
        float((nfx.get("fadeOutBlack") or {}).get("durationSec", 0.0)),
        clip_fade_out,
    )
    if fade_out_dur > 0.02 and (dur - local_t) < fade_out_dur:
        arr *= max(0.0, min(1.0, max(0.0, dur - local_t) / fade_out_dur))

    # 5. Inline Text Overlay (title + subtitle + stroke + glow)
    if text_overlay and str(text_overlay.get("text", "")).strip():
        out_img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="RGB").convert("RGBA")
        txt_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        tdraw = ImageDraw.Draw(txt_layer)

        fade_in_t = float(text_overlay.get("fadeInSec") or 0.0)
        fade_out_t = float(text_overlay.get("fadeOutSec") or 0.0)
        t_alpha = 1.0
        if fade_in_t > 0.01 and local_t < fade_in_t:
            t_alpha = min(t_alpha, local_t / fade_in_t)
        if fade_out_t > 0.01 and (dur - local_t) < fade_out_t:
            t_alpha = min(t_alpha, max(0.0, dur - local_t) / fade_out_t)

        if t_alpha > 0.01:
            font_px = max(12, int(round(float(text_overlay.get("fontSize", 48)) * height / 720.0)))
            font = load_font(font_px)
            tx_raw = float(text_overlay.get("x", 50.0))
            ty_raw = float(text_overlay.get("y", 82.0))
            tx = width * (tx_raw if 0.0 < tx_raw <= 1.0 else tx_raw / 100.0)
            ty = height * (ty_raw if 0.0 < ty_raw <= 1.0 else ty_raw / 100.0)
            fg = hex_to_rgb(text_overlay.get("color", "#FFFFFF"))
            stroke = hex_to_rgb(text_overlay.get("strokeColor") or "#000000", (0, 0, 0))
            a_byte = int(round(255 * max(0.0, min(1.0, t_alpha))))

            text_str = str(text_overlay.get("text", "")).strip()
            bbox = tdraw.textbbox((0, 0), text_str, font=font, stroke_width=2)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            bg_op = float(text_overlay.get("bgOpacity", 0.45))
            if bg_op > 0.02:
                bg_rgb = hex_to_rgb(text_overlay.get("bgColor", "#000000"), (0, 0, 0))
                pad = 14
                tdraw.rounded_rectangle(
                    [tx - tw / 2 - pad, ty - th / 2 - pad // 2, tx + tw / 2 + pad, ty + th / 2 + pad // 2],
                    radius=8,
                    fill=(bg_rgb[0], bg_rgb[1], bg_rgb[2], int(round(255 * bg_op * t_alpha))),
                )

            tdraw.text(
                (tx, ty),
                text_str,
                font=font,
                fill=(fg[0], fg[1], fg[2], a_byte),
                anchor="mm",
                stroke_width=2,
                stroke_fill=(stroke[0], stroke[1], stroke[2], a_byte),
            )
            sub = str(text_overlay.get("subtitle") or "").strip()
            if sub:
                sub_font = load_font(max(12, int(round(font_px * 0.58))))
                tdraw.text(
                    (tx, ty + font_px * 0.85),
                    sub,
                    font=sub_font,
                    fill=(fg[0], fg[1], fg[2], int(a_byte * 0.9)),
                    anchor="mm",
                    stroke_width=1,
                    stroke_fill=(stroke[0], stroke[1], stroke[2], a_byte),
                )
            out_img = Image.alpha_composite(out_img, txt_layer).convert("RGB")
            arr = np.asarray(out_img, dtype=np.float32)

    # 6. Cinemascope bars drawn LAST on top of everything
    bar_frac = evaluate_cinemascope_bar(scope, local_t, dur)
    if bar_frac > 0.001:
        bar_px = max(1, int(round(height * bar_frac)))
        arr[:bar_px, :, :] = 0.0
        arr[height - bar_px :, :, :] = 0.0

    return np.clip(arr, 0, 255).astype(np.uint8)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--spec", required=True, help="Path to JSON render spec")
    args = parser.parse_args()

    with open(args.spec, "r", encoding="utf-8") as fh:
        spec = json.load(fh)

    source_path: str = spec["sourcePath"]
    output_path: str = spec["outputPath"]
    is_image: bool = bool(spec.get("isImage", False))
    width: int = int(spec["width"])
    height: int = int(spec["height"])
    fps: int = max(1, int(spec.get("fps", 24)))
    dur: float = max(0.1, float(spec["durationSec"]))
    in_sec: float = max(0.0, float(spec.get("inSec", 0.0)))
    speed: float = max(0.25, min(4.0, float(spec.get("speed", 1.0))))
    preset: str = str(spec.get("preset", "veryfast"))
    crf: str = str(spec.get("crf", "24"))
    clip_id: str = str(spec.get("clipId", "clip"))
    cam = spec.get("camera")
    scope = spec.get("cinemascope")
    nfx = spec.get("normalizedFx") or {}
    beat_times = [float(x) for x in (spec.get("beatTimesInClip") or [])]
    clip_fade_in = float(spec.get("fadeInSec") or 0.0)
    clip_fade_out = float(spec.get("fadeOutSec") or 0.0)
    text_overlay = spec.get("textOverlay")

    total_frames = max(1, int(round(dur * fps)))

    encoder_cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "rawvideo",
        "-vcodec",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-i",
        "-",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-pix_fmt",
        "yuv420p",
        "-an",
        output_path,
    ]

    enc = subprocess.Popen(
        encoder_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    assert enc.stdin is not None

    dec: Optional[subprocess.Popen[bytes]] = None
    static_base: Optional[Image.Image] = None

    try:
        if is_image:
            raw_img = Image.open(source_path).convert("RGB")
            static_base = fit_cover_or_contain(raw_img, width, height)
        else:
            vf_parts = []
            if abs(speed - 1.0) > 0.01:
                vf_parts.append(f"setpts={1.0 / speed:.4f}*PTS")
            vf_parts.extend([
                f"scale={width}:{height}:force_original_aspect_ratio=decrease",
                f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black",
                f"fps={fps}",
            ])
            dec_cmd = [
                "ffmpeg",
                "-ss",
                f"{in_sec:.4f}",
                "-i",
                source_path,
                "-t",
                f"{dur * speed:.4f}",
                "-vf",
                ",".join(vf_parts),
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ]
            dec = subprocess.Popen(dec_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            assert dec.stdout is not None

        frame_bytes = width * height * 3
        last_img: Optional[Image.Image] = static_base

        for frame_idx in range(total_frames):
            local_t = frame_idx / float(fps)
            if is_image:
                assert static_base is not None
                base_img = static_base
            else:
                assert dec is not None and dec.stdout is not None
                buf = dec.stdout.read(frame_bytes)
                if len(buf) == frame_bytes:
                    base_img = Image.frombytes("RGB", (width, height), buf)
                    last_img = base_img
                elif last_img is not None:
                    base_img = last_img
                else:
                    base_img = Image.new("RGB", (width, height), (0, 0, 0))

            rendered = render_frame_fx(
                base_img=base_img,
                clip_id=clip_id,
                frame_idx=frame_idx,
                local_t=local_t,
                dur=dur,
                fps=fps,
                width=width,
                height=height,
                cam=cam,
                scope=scope,
                nfx=nfx,
                beat_times=beat_times,
                clip_fade_in=clip_fade_in,
                clip_fade_out=clip_fade_out,
                text_overlay=text_overlay,
            )
            enc.stdin.write(rendered.tobytes())

        enc.stdin.close()
        stderr_out = enc.stderr.read().decode("utf-8", errors="replace") if enc.stderr else ""
        rc = enc.wait()
        if rc != 0:
            sys.stderr.write(f"FFmpeg encode failed ({rc}): {stderr_out}\n")
            return rc
        return 0
    finally:
        if dec is not None:
            try:
                dec.kill()
                dec.wait(timeout=2)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
