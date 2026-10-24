'use client';
import { useEffect, useRef } from 'react';
import { BRUSH_PRESETS } from '@/utils/brushPresets';
import { drawBrushStroke } from '@/utils/brushRaster';
import { useStore } from '@/store/useStore';
import type { BrushPreset } from '@/types';

function TipPreview({ preset, color }: { preset: BrushPreset; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBrushStroke(ctx, { id: 'tip', points: [0.5, 0.5], size: 0.9, color, opacity: 1, hardness: 0.6, brushPreset: preset }, canvas.width, canvas.height);
  }, [preset, color]);
  return <canvas ref={ref} width={110} height={52} aria-hidden="true" />;
}

export function BrushLibrary() {
  const settings = useStore(state => state.cleanupSettings);
  const update = useStore(state => state.updateCleanupSettings);
  return <details className="brush-library" open>
    <summary>Кисти и подложки</summary>
    <div className="brush-preset-grid">
      {BRUSH_PRESETS.map(preset => <button key={preset.id} type="button" title={preset.hint}
        aria-label={`Кисть: ${preset.name}`} aria-pressed={(settings.brushPreset ?? 'round') === preset.id}
        onClick={() => {
          update({ brushPreset: preset.id, mode: 'brush', ...(preset.id !== 'round' && settings.brushSize < 0.06 ? { brushSize: 0.12 } : {}) });
          useStore.getState().setActiveTool('brush');
        }}>
        <TipPreview preset={preset.id} color={settings.brushColor} /><span>{preset.name}</span>
      </button>)}
    </div>
    <p className="library-hint">Клик — отпечаток, движение — штрих. Цвет и размер задаются ниже.</p>
  </details>;
}
