import type { BrushPreset } from '@/types';

export const BRUSH_PRESETS: Array<{ id: BrushPreset; name: string; hint: string; spacing: number }> = [
  { id: 'round', name: 'Круглая', hint: 'Обычная кисть с мягким или жёстким краем', spacing: 0.08 },
  { id: 'cloud', name: 'Облака', hint: 'Объёмные облака с неровным воздушным краем', spacing: 0.24 },
  { id: 'wisps', name: 'Перистые', hint: 'Тонкие вытянутые облака и воздушные полосы', spacing: 0.32 },
  { id: 'smoke', name: 'Дымка', hint: 'Полупрозрачный туман и мягкая дымка', spacing: 0.2 },
  { id: 'backing', name: 'Подложка', hint: 'Плотная подложка под надпись с неровными краями', spacing: 0.16 },
  { id: 'chalk', name: 'Мел', hint: 'Сухая зернистая кисть для скетчей и текстур', spacing: 0.12 },
  { id: 'halftone', name: 'Растр', hint: 'Точки для манга-подложек и теней', spacing: 0.5 },
];

function hash(x: number, y: number) {
  const v = Math.sin(x * 127.1 + y * 311.7 + 9.2) * 43758.5453;
  return v - Math.floor(v);
}
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx) * (1 - sy)
    + (hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx) * sy;
}
function fractal(x: number, y: number) {
  return noise(x, y) * 0.55 + noise(x * 2, y * 2) * 0.27 + noise(x * 4, y * 4) * 0.13 + noise(x * 8, y * 8) * 0.05;
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Deterministic alpha tips: independent of preview/export resolution. */
export function presetAlpha(preset: BrushPreset, x: number, y: number, hardness: number): number {
  const radius = Math.hypot(x, y);
  if (radius >= 1) return 0;
  const grain = fractal(x * 4 + 10, y * 4 + 10);
  if (preset === 'backing') {
    const edge = Math.max(Math.abs(x), Math.abs(y) / 0.48);
    return clamp((0.9 - edge + (grain - 0.5) * 0.16) * (12 + hardness * 35));
  }
  if (preset === 'halftone') {
    const dx = (x + 1) * 5 - Math.round((x + 1) * 5);
    const dy = (y + 1) * 5 - Math.round((y + 1) * 5);
    return clamp((0.27 - Math.hypot(dx, dy)) * 45) * clamp((1 - radius) * 12);
  }
  if (preset === 'chalk') return clamp((1 - radius) * 8) * (hash(Math.floor(x * 160), Math.floor(y * 160)) > 0.3 ? 0.8 : 0.05);
  if (preset === 'wisps') {
    const wave = y + Math.sin(x * 5 + grain * 3) * 0.16;
    const envelope = clamp(1 - Math.hypot(x, wave * 3.2));
    return clamp(envelope * (grain * 1.5 + 0.1)) * 0.65;
  }
  if (preset === 'smoke') return clamp((1 - radius) * 1.6) * clamp(grain * 1.5 - 0.15) * 0.45;
  const edge = 1 - Math.hypot(x, y * 1.25) + (grain - 0.5) * 0.8;
  return clamp(edge * (2 + hardness * 4)) * clamp(grain * 2 - 0.25);
}

export function createPresetTip(preset: BrushPreset, diameter: number, hardness: number): HTMLCanvasElement {
  // Bound the texture work for very large pages; Canvas scales the cached tip.
  const size = Math.max(8, Math.min(512, Math.ceil(diameter)));
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
    pixels.data[i + 3] = Math.round(presetAlpha(preset, (x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1, hardness) * 255);
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
