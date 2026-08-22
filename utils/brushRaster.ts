import type { StrokeData } from '@/types';
import { getBrushSpacingPx, getBrushTipRadii } from '@/utils/brushTip';

const stampCache = new Map<string, HTMLCanvasElement>();

function getBrushStamp(diameter: number, hardness: number, color: string) {
  const size = Math.max(1, Math.ceil(diameter));
  const normalizedHardness = Math.max(0, Math.min(1, hardness));
  const key = `${size}:${normalizedHardness.toFixed(3)}:${color}`;
  const cached = stampCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = size + 4;
  canvas.height = size + 4;
  const ctx = canvas.getContext('2d')!;
  const center = canvas.width / 2;
  const { outer, hard } = getBrushTipRadii(diameter, normalizedHardness);
  if (normalizedHardness >= 0.995) {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.arc(center, center, outer, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, outer);
    const solidStop = Math.max(0, Math.min(0.98, hard / outer));
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(solidStop, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  stampCache.set(key, canvas);
  if (stampCache.size > 80) stampCache.delete(stampCache.keys().next().value!);
  return canvas;
}

export function drawBrushStroke(
  ctx: CanvasRenderingContext2D,
  stroke: StrokeData,
  width: number,
  height: number,
  options: { color?: string; compositeOperation?: GlobalCompositeOperation } = {},
) {
  if (stroke.points.length < 2) return;
  const diameter = Math.max(1, stroke.size * height);
  const hardness = stroke.hardness ?? 1;
  const color = options.color ?? stroke.color;
  const stamp = getBrushStamp(diameter, hardness, color);
  const spacing = getBrushSpacingPx(diameter, hardness);
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < stroke.points.length; index += 2) {
    points.push({ x: stroke.points[index] * width, y: stroke.points[index + 1] * height });
  }

  const radiusX = stamp.width / 2;
  const radiusY = stamp.height / 2;
  let left = points[0].x;
  let top = points[0].y;
  let right = points[0].x;
  let bottom = points[0].y;
  for (let index = 1; index < points.length; index++) {
    left = Math.min(left, points[index].x);
    top = Math.min(top, points[index].y);
    right = Math.max(right, points[index].x);
    bottom = Math.max(bottom, points[index].y);
  }
  const minX = Math.max(0, Math.floor(left - radiusX));
  const minY = Math.max(0, Math.floor(top - radiusY));
  const maxX = Math.min(width, Math.ceil(right + radiusX));
  const maxY = Math.min(height, Math.ceil(bottom + radiusY));
  const strokeWidth = Math.max(0, Math.ceil(maxX - minX));
  const strokeHeight = Math.max(0, Math.ceil(maxY - minY));
  if (strokeWidth === 0 || strokeHeight === 0) return;

  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.width = strokeWidth;
  strokeCanvas.height = strokeHeight;
  const strokeCtx = strokeCanvas.getContext('2d')!;
  const stampAt = (x: number, y: number) => strokeCtx.drawImage(stamp, x - minX - radiusX, y - minY - radiusY);
  stampAt(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / spacing));
    for (let step = 1; step <= steps; step++) {
      const ratio = step / steps;
      stampAt(from.x + (to.x - from.x) * ratio, from.y + (to.y - from.y) * ratio);
    }
  }

  ctx.save();
  ctx.globalAlpha *= stroke.opacity;
  ctx.globalCompositeOperation = options.compositeOperation ?? (stroke.mode === 'erase' ? 'destination-out' : 'source-over');
  ctx.drawImage(strokeCanvas, minX, minY);
  ctx.restore();
}
