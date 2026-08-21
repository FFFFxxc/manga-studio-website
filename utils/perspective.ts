import type { PerspectiveQuad, NormalizedPoint } from '@/types';
import { drawPerspectiveCanvas, type PerspectiveCanvasOptions } from '@/utils/perspectiveCanvas';
import { renderPerspectiveWebgl } from '@/utils/perspectiveWebgl';

export type Homography = [number, number, number, number, number, number, number, number, number];
export type PerspectiveQuality = 'drag' | 'preview' | 'export';

export interface PerspectiveValidationOptions {
  minArea?: number;
  minEdge?: number;
}

const QUAD_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

export function clonePerspectiveQuad(quad: PerspectiveQuad | null | undefined): PerspectiveQuad | null {
  if (!quad) return null;
  return {
    topLeft: { ...quad.topLeft },
    topRight: { ...quad.topRight },
    bottomRight: { ...quad.bottomRight },
    bottomLeft: { ...quad.bottomLeft },
  };
}

export function affineToPerspective(
  width: number,
  height: number,
  transform: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number },
): PerspectiveQuad {
  const { x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0 } = transform;
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = x * width;
  const ty = y * height;
  const map = (px: number, py: number): NormalizedPoint => {
    const sx = px * scaleX;
    const sy = py * scaleY;
    return {
      x: (tx + sx * cos - sy * sin) / width,
      y: (ty + sx * sin + sy * cos) / height,
    };
  };
  return {
    topLeft: map(0, 0),
    topRight: map(width, 0),
    bottomRight: map(width, height),
    bottomLeft: map(0, height),
  };
}

export function affineBoundsToPerspective(
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  transform: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number },
): PerspectiveQuad {
  const { x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0 } = transform;
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tx = x * width;
  const ty = y * height;
  const map = (px: number, py: number): NormalizedPoint => ({
    x: (tx + px * scaleX * cos - py * scaleY * sin) / width,
    y: (ty + px * scaleX * sin + py * scaleY * cos) / height,
  });
  return {
    topLeft: map(bounds.x, bounds.y),
    topRight: map(bounds.x + bounds.width, bounds.y),
    bottomRight: map(bounds.x + bounds.width, bounds.y + bounds.height),
    bottomLeft: map(bounds.x, bounds.y + bounds.height),
  };
}

function cross(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint, d: NormalizedPoint) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

export function perspectiveQuadArea(quad: PerspectiveQuad) {
  const p = QUAD_KEYS.map(key => quad[key]);
  let area = 0;
  for (let index = 0; index < p.length; index++) {
    const next = p[(index + 1) % p.length];
    area += p[index].x * next.y - next.x * p[index].y;
  }
  return area / 2;
}

export function getPerspectiveSubdivisionCount(
  quad: PerspectiveQuad,
  width: number,
  height: number,
  quality: PerspectiveQuality,
) {
  const diagonals = [
    Math.hypot(quad.topLeft.x - quad.bottomRight.x, quad.topLeft.y - quad.bottomRight.y),
    Math.hypot(quad.topRight.x - quad.bottomLeft.x, quad.topRight.y - quad.bottomLeft.y),
  ];
  const distortion = Math.min(1, Math.abs(diagonals[0] - diagonals[1]) + Math.abs(perspectiveQuadArea(quad) - 1));
  const side = Math.max(width, height);
  const base = quality === 'drag' ? 8 : quality === 'preview' ? 14 : 20;
  const resolutionBonus = quality === 'drag' ? 0 : Math.ceil(Math.max(0, side - 1200) / 600);
  return Math.max(6, Math.min(40, base + Math.ceil(distortion * 12) + resolutionBonus));
}

export function isValidPerspectiveQuad(
  quad: PerspectiveQuad,
  options: number | PerspectiveValidationOptions = 0.0004,
) {
  const { minArea = 0.0004, minEdge = 0.005 } = typeof options === 'number' ? { minArea: options } : options;
  const points = QUAD_KEYS.map(key => quad[key]);
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  if (perspectiveQuadArea(quad) <= minArea) return false;
  if (points.some((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(point.x - next.x, point.y - next.y) < minEdge;
  })) return false;
  const turnSign = Math.sign(cross(points[0], points[1], points[2]));
  if (turnSign === 0 || points.some((point, index) => (
    Math.sign(cross(point, points[(index + 1) % points.length], points[(index + 2) % points.length])) !== turnSign
  ))) return false;
  return !segmentsIntersect(points[0], points[1], points[2], points[3])
    && !segmentsIntersect(points[1], points[2], points[3], points[0]);
}

export function sanitizePerspectiveQuad(quad: PerspectiveQuad | null | undefined): PerspectiveQuad | null {
  if (!quad) return null;
  const clamp = (value: number) => Math.max(-4, Math.min(4, value));
  const next: PerspectiveQuad = {
    topLeft: { x: clamp(quad.topLeft?.x), y: clamp(quad.topLeft?.y) },
    topRight: { x: clamp(quad.topRight?.x), y: clamp(quad.topRight?.y) },
    bottomRight: { x: clamp(quad.bottomRight?.x), y: clamp(quad.bottomRight?.y) },
    bottomLeft: { x: clamp(quad.bottomLeft?.x), y: clamp(quad.bottomLeft?.y) },
  };
  return isValidPerspectiveQuad(next) ? next : null;
}

function solveLinearSystem(matrix: number[][], values: number[]) {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let item = column; item <= size; item++) rows[column][item] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let item = column; item <= size; item++) rows[row][item] -= factor * rows[column][item];
    }
  }
  return rows.map(row => row[size]);
}

export function perspectiveHomography(quad: PerspectiveQuad, width: number, height: number): Homography | null {
  if (!isValidPerspectiveQuad(quad) || width <= 0 || height <= 0) return null;
  const destinations = QUAD_KEYS.map(key => ({ x: quad[key].x * width, y: quad[key].y * height }));
  const sources = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const matrix: number[][] = [];
  const values: number[] = [];
  for (let index = 0; index < 4; index++) {
    const { x: u, y: v } = sources[index];
    const { x, y } = destinations[index];
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); values.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]); values.push(y);
  }
  const solved = solveLinearSystem(matrix, values);
  return solved ? [...solved, 1] as Homography : null;
}

export function projectHomography(matrix: Homography, point: NormalizedPoint): NormalizedPoint {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  };
}

export function invertHomography(m: Homography): Homography | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const determinant = a * A + b * D + c * G;
  if (Math.abs(determinant) < 1e-12) return null;
  return [A, B, C, D, E, F, G, H, I].map(value => value / determinant) as Homography;
}

export function mapDocumentPointToLayerPoint(
  point: NormalizedPoint,
  quad: PerspectiveQuad,
  width: number,
  height: number,
): NormalizedPoint | null {
  const forward = perspectiveHomography(quad, width, height);
  const inverse = forward && invertHomography(forward);
  if (!inverse) return null;
  return projectHomography(inverse, { x: point.x * width, y: point.y * height });
}

export type PerspectiveDrawOptions = PerspectiveCanvasOptions;

function clipPerspectiveCrop(
  ctx: CanvasRenderingContext2D,
  quad: PerspectiveQuad,
  width: number,
  height: number,
  crop: NonNullable<PerspectiveDrawOptions['crop']>,
) {
  const homography = perspectiveHomography(quad, width, height);
  if (!homography) return false;
  const points = [
    { x: crop.x, y: crop.y },
    { x: crop.x + crop.width, y: crop.y },
    { x: crop.x + crop.width, y: crop.y + crop.height },
    { x: crop.x, y: crop.y + crop.height },
  ].map(point => projectHomography(homography, point));
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.lineTo(points[2].x, points[2].y);
  ctx.lineTo(points[3].x, points[3].y);
  ctx.closePath();
  ctx.clip();
  return true;
}

export function drawPerspectiveImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  quad: PerspectiveQuad,
  width: number,
  height: number,
  options: PerspectiveDrawOptions = {},
) {
  const rendered = options.sourceBounds
    ? null
    : renderPerspectiveWebgl(source, quad, width, height);
  if (rendered) {
    const { bounds, canvas } = rendered;
    ctx.save();
    ctx.globalAlpha *= options.opacity ?? 1;
    if (options.crop && !clipPerspectiveCrop(ctx, quad, width, height, options.crop)) {
      ctx.restore();
      return;
    }
    ctx.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
    return;
  }
  drawPerspectiveCanvas(ctx, source, quad, width, height, options);
}
