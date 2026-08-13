import type { PerspectiveQuad, NormalizedPoint } from '@/types';

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

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  src: [NormalizedPoint, NormalizedPoint, NormalizedPoint],
  dst: [NormalizedPoint, NormalizedPoint, NormalizedPoint],
) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 1e-8) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.lineTo(d2.x, d2.y); ctx.closePath();
  ctx.clip();
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

export function drawPerspectiveImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  quad: PerspectiveQuad,
  width: number,
  height: number,
  options: { crop?: { x: number; y: number; width: number; height: number } | null; sourceBounds?: { x: number; y: number; width: number; height: number } | null; opacity?: number; subdivisions?: number } = {},
) {
  const homography = perspectiveHomography(quad, width, height);
  if (!homography) return;
  const sizedSource = source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; displayWidth?: number; displayHeight?: number };
  const sourceWidth = sizedSource.naturalWidth || sizedSource.videoWidth || sizedSource.displayWidth || sizedSource.width || 0;
  const sourceHeight = sizedSource.naturalHeight || sizedSource.videoHeight || sizedSource.displayHeight || sizedSource.height || 0;
  if (!sourceWidth || !sourceHeight) return;
  const crop = options.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sourceBounds = options.sourceBounds ?? null;
  const subdivisions = Math.max(2, Math.min(32, Math.round(options.subdivisions ?? 14)));
  ctx.save();
  ctx.globalAlpha *= options.opacity ?? 1;
  for (let row = 0; row < subdivisions; row++) {
    const localV0 = row / subdivisions;
    const localV1 = (row + 1) / subdivisions;
    const v0 = sourceBounds ? sourceBounds.y + sourceBounds.height * localV0 : crop.y + crop.height * localV0;
    const v1 = sourceBounds ? sourceBounds.y + sourceBounds.height * localV1 : crop.y + crop.height * localV1;
    for (let column = 0; column < subdivisions; column++) {
      const localU0 = column / subdivisions;
      const localU1 = (column + 1) / subdivisions;
      const u0 = sourceBounds ? sourceBounds.x + sourceBounds.width * localU0 : crop.x + crop.width * localU0;
      const u1 = sourceBounds ? sourceBounds.x + sourceBounds.width * localU1 : crop.x + crop.width * localU1;
      const s00 = { x: u0 * sourceWidth, y: v0 * sourceHeight };
      const s10 = { x: u1 * sourceWidth, y: v0 * sourceHeight };
      const s11 = { x: u1 * sourceWidth, y: v1 * sourceHeight };
      const s01 = { x: u0 * sourceWidth, y: v1 * sourceHeight };
      const d00 = projectHomography(homography, sourceBounds ? { x: localU0, y: localV0 } : { x: u0, y: v0 });
      const d10 = projectHomography(homography, sourceBounds ? { x: localU1, y: localV0 } : { x: u1, y: v0 });
      const d11 = projectHomography(homography, sourceBounds ? { x: localU1, y: localV1 } : { x: u1, y: v1 });
      const d01 = projectHomography(homography, sourceBounds ? { x: localU0, y: localV1 } : { x: u0, y: v1 });
      drawTriangle(ctx, source, [s00, s10, s11], [d00, d10, d11]);
      drawTriangle(ctx, source, [s00, s11, s01], [d00, d11, d01]);
    }
  }
  ctx.restore();
}
