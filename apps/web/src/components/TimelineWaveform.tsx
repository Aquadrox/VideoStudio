import { useEffect, useRef, useState } from 'react';

interface TimelineWaveformProps {
  audioUrl: string | null;
  widthPx: number;
  heightPx?: number;
  color?: string;
  seedKey?: string;
}

const PEAK_CACHE = new Map<string, number[]>();
const IN_FLIGHT = new Map<string, Promise<number[]>>();

function buildFallbackPeaks(seedKey: string, count = 96): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seedKey.length; i += 1) {
    hash ^= seedKey.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    hash = Math.imul(hash ^ (i * 2654435761), 1597334677);
    const r = ((hash >>> 0) % 1000) / 1000;
    const env = Math.sin((i / count) * Math.PI) * 0.45 + 0.55;
    out.push(Math.max(0.14, Math.min(0.95, (0.25 + r * 0.7) * env)));
  }
  return out;
}

async function decodePeaks(audioUrl: string, buckets = 140): Promise<number[]> {
  const cached = PEAK_CACHE.get(audioUrl);
  if (cached) return cached;

  const existing = IN_FLIGHT.get(audioUrl);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return buildFallbackPeaks(audioUrl, buckets);

      const res = await fetch(audioUrl);
      if (!res.ok) return buildFallbackPeaks(audioUrl, buckets);
      const arr = await res.arrayBuffer();
      const ctx = new AudioCtx();
      try {
        const decoded = await ctx.decodeAudioData(arr);
        const channel = decoded.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / buckets));
        const peaks: number[] = [];
        let maxPeak = 0.01;
        for (let i = 0; i < buckets; i += 1) {
          const start = i * step;
          const end = Math.min(channel.length, start + step);
          let peak = 0;
          for (let j = start; j < end; j += Math.max(1, Math.floor((end - start) / 64))) {
            const v = Math.abs(channel[j] ?? 0);
            if (v > peak) peak = v;
          }
          peaks.push(peak);
          if (peak > maxPeak) maxPeak = peak;
        }
        const normalized = peaks.map((p) => Math.max(0.08, p / maxPeak));
        PEAK_CACHE.set(audioUrl, normalized);
        return normalized;
      } finally {
        await ctx.close().catch(() => undefined);
      }
    } catch {
      const fallback = buildFallbackPeaks(audioUrl, buckets);
      PEAK_CACHE.set(audioUrl, fallback);
      return fallback;
    } finally {
      IN_FLIGHT.delete(audioUrl);
    }
  })();

  IN_FLIGHT.set(audioUrl, promise);
  return promise;
}

export function TimelineWaveform({
  audioUrl,
  widthPx,
  heightPx = 30,
  color = 'rgba(52, 211, 153, 0.55)',
  seedKey = 'audio',
}: TimelineWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>(() =>
    audioUrl && PEAK_CACHE.has(audioUrl)
      ? PEAK_CACHE.get(audioUrl)!
      : buildFallbackPeaks(audioUrl ?? seedKey, 96),
  );

  useEffect(() => {
    if (!audioUrl) {
      setPeaks(buildFallbackPeaks(seedKey, 96));
      return;
    }
    let cancelled = false;
    void decodePeaks(audioUrl, 140).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [audioUrl, seedKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(24, Math.min(2400, Math.round(widthPx)));
    const h = Math.max(16, Math.round(heightPx));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const barGap = 2;
    const barW = 2;
    const barCount = Math.max(4, Math.floor(w / (barW + barGap)));
    const midY = h / 2;

    ctx.fillStyle = color;
    for (let i = 0; i < barCount; i += 1) {
      const peakIdx = Math.min(peaks.length - 1, Math.floor((i / barCount) * peaks.length));
      const amp = peaks[peakIdx] ?? 0.2;
      const barH = Math.max(2, amp * (h - 4));
      const x = i * (barW + barGap);
      ctx.fillRect(x, midY - barH / 2, barW, barH);
    }
  }, [peaks, widthPx, heightPx, color]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-waveform-canvas"
      style={{ width: '100%', height: `${heightPx}px` }}
      aria-hidden="true"
    />
  );
}
