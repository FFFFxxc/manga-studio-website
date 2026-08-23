import type { ImageDocument } from '@/types';
import { drawRasterReferenceToContext } from '@/utils/cleanupRaster';
import { renderDocumentToCanvas } from '@/utils/documentComposite';

export type EyedropperSampleMode = 'all' | 'current';

export interface SampledColor {
  hex: string;
  rgba: [number, number, number, number];
}

const byteHex = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');

export function sampleCanvasColor(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
): SampledColor | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || canvas.width < 1 || canvas.height < 1) return null;
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y)));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const data = context.getImageData(x, y, 1, 1).data;
  const rgba: [number, number, number, number] = [data[0], data[1], data[2], data[3]];
  if (rgba[3] === 0) return null;
  return { hex: `#${byteHex(rgba[0])}${byteHex(rgba[1])}${byteHex(rgba[2])}`, rgba };
}

/** Builds an overlay-free sampling source at document resolution. */
export async function buildColorSamplingCanvas(
  doc: ImageDocument,
  mode: EyedropperSampleMode,
): Promise<HTMLCanvasElement> {
  if (mode === 'all') return renderDocumentToCanvas(doc, 'png', { willReadFrequently: true });
  const selected = doc.selectedLayer;
  if (selected?.type === 'mask') throw new Error('Выберите базовый или растровый слой.');
  const target = selected?.type === 'ai'
    ? { type: 'ai' as const, id: selected.id }
    : { type: 'base' as const, id: doc.baseLayer.id };
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas недоступен.');
  await drawRasterReferenceToContext(context, doc, target);
  return canvas;
}
