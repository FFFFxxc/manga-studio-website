import type { PerspectiveQuad } from '@/types';
import {
  getPerspectiveSubdivisionCount,
  perspectiveHomography,
  projectHomography,
  type PerspectiveQuality,
} from '@/utils/perspective';

interface Point {
  x: number;
  y: number;
}

interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PerspectiveCanvasOptions {
  crop?: NormalizedRect | null;
  sourceBounds?: NormalizedRect | null;
  opacity?: number;
  quality?: PerspectiveQuality;
  seamOverlapPx?: number;
  subdivisions?: number;
  canvasFactory?: () => HTMLCanvasElement;
}

function expandTriangle(points: [Point, Point, Point], overlap: number) {
  const center = points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3 }),
    { x: 0, y: 0 },
  );
  return points.map(point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    return { x: point.x + dx / length * overlap, y: point.y + dy / length * overlap };
  }) as [Point, Point, Point];
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  src: [Point, Point, Point],
  dst: [Point, Point, Point],
  seamOverlapPx: number,
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
  const clip = expandTriangle(dst, seamOverlapPx);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(clip[0].x, clip[0].y);
  ctx.lineTo(clip[1].x, clip[1].y);
  ctx.lineTo(clip[2].x, clip[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.globalCompositeOperation = 'copy';
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function getBounds(points: Point[]) {
  const x = Math.floor(Math.min(...points.map(point => point.x)));
  const y = Math.floor(Math.min(...points.map(point => point.y)));
  const right = Math.ceil(Math.max(...points.map(point => point.x)));
  const bottom = Math.ceil(Math.max(...points.map(point => point.y)));
  return { x, y, width: right - x, height: bottom - y };
}

function createCanvas(options: PerspectiveCanvasOptions) {
  if (options.canvasFactory) return options.canvasFactory();
  return typeof document === 'undefined' ? null : document.createElement('canvas');
}

function getSourceSize(source: CanvasImageSource) {
  const sized = source as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  return {
    width: sized.naturalWidth || sized.videoWidth || sized.displayWidth || sized.width || 0,
    height: sized.naturalHeight || sized.videoHeight || sized.displayHeight || sized.height || 0,
  };
}

function intersectRects(left: NormalizedRect, right: NormalizedRect): NormalizedRect | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= x || bottomEdge <= y) return null;
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

export function drawPerspectiveCanvas(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  quad: PerspectiveQuad,
  width: number,
  height: number,
  options: PerspectiveCanvasOptions = {},
) {
  const homography = perspectiveHomography(quad, width, height);
  if (!homography) return;
  const sourceSize = getSourceSize(source);
  if (!sourceSize.width || !sourceSize.height) return;
  const crop = options.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const sourceBounds = options.sourceBounds ?? null;
  if (crop.width <= 0 || crop.height <= 0) return;
  if (sourceBounds && (sourceBounds.width <= 0 || sourceBounds.height <= 0)) return;
  const sampledSource = sourceBounds ? intersectRects(crop, sourceBounds) : crop;
  if (!sampledSource) return;
  const destination = sourceBounds
    ? {
        x: (sampledSource.x - sourceBounds.x) / sourceBounds.width,
        y: (sampledSource.y - sourceBounds.y) / sourceBounds.height,
        width: sampledSource.width / sourceBounds.width,
        height: sampledSource.height / sourceBounds.height,
      }
    : sampledSource;
  const subdivisions = options.subdivisions == null
    ? getPerspectiveSubdivisionCount(quad, width, height, options.quality ?? 'preview')
    : Math.max(2, Math.min(32, Math.round(options.subdivisions)));
  const seamOverlapPx = Math.max(0, options.seamOverlapPx ?? 0.75);
  const outerDestination = [
    { x: destination.x, y: destination.y },
    { x: destination.x + destination.width, y: destination.y },
    { x: destination.x + destination.width, y: destination.y + destination.height },
    { x: destination.x, y: destination.y + destination.height },
  ];
  const outer = outerDestination.map(point => projectHomography(homography, point));
  const bounds = getBounds(outer);
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const canvas = createCanvas(options);
  if (!canvas) return;
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const meshContext = canvas.getContext('2d');
  if (!meshContext) return;
  const localize = (point: Point) => ({ x: point.x - bounds.x, y: point.y - bounds.y });

  for (let row = 0; row < subdivisions; row++) {
    const localV0 = row / subdivisions;
    const localV1 = (row + 1) / subdivisions;
    const v0 = sampledSource.y + sampledSource.height * localV0;
    const v1 = sampledSource.y + sampledSource.height * localV1;
    const destinationV0 = destination.y + destination.height * localV0;
    const destinationV1 = destination.y + destination.height * localV1;
    for (let column = 0; column < subdivisions; column++) {
      const localU0 = column / subdivisions;
      const localU1 = (column + 1) / subdivisions;
      const u0 = sampledSource.x + sampledSource.width * localU0;
      const u1 = sampledSource.x + sampledSource.width * localU1;
      const destinationU0 = destination.x + destination.width * localU0;
      const destinationU1 = destination.x + destination.width * localU1;
      const s00 = { x: u0 * sourceSize.width, y: v0 * sourceSize.height };
      const s10 = { x: u1 * sourceSize.width, y: v0 * sourceSize.height };
      const s11 = { x: u1 * sourceSize.width, y: v1 * sourceSize.height };
      const s01 = { x: u0 * sourceSize.width, y: v1 * sourceSize.height };
      const d00 = projectHomography(homography, { x: destinationU0, y: destinationV0 });
      const d10 = projectHomography(homography, { x: destinationU1, y: destinationV0 });
      const d11 = projectHomography(homography, { x: destinationU1, y: destinationV1 });
      const d01 = projectHomography(homography, { x: destinationU0, y: destinationV1 });
      drawTriangle(meshContext, source, [s00, s10, s11], [localize(d00), localize(d10), localize(d11)], seamOverlapPx);
      drawTriangle(meshContext, source, [s00, s11, s01], [localize(d00), localize(d11), localize(d01)], seamOverlapPx);
    }
  }
  ctx.save();
  ctx.globalAlpha *= options.opacity ?? 1;
  ctx.beginPath();
  ctx.moveTo(outer[0].x, outer[0].y);
  ctx.lineTo(outer[1].x, outer[1].y);
  ctx.lineTo(outer[2].x, outer[2].y);
  ctx.lineTo(outer[3].x, outer[3].y);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.restore();
}
