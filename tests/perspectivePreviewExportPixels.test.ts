import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/perspectiveWebgl', () => ({ renderPerspectiveWebgl: () => null }));

import { drawPlacedLayer } from '@/utils/cleanupRaster';
import { drawPerspectiveImage, perspectiveHomography, projectHomography } from '@/utils/perspective';

type Matrix = [number, number, number, number, number, number];
type Point = { x: number; y: number };

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function invert([a, b, c, d, e, f]: Matrix): Matrix | null {
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-10) return null;
  return [d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

function map([a, b, c, d, e, f]: Matrix, point: Point): Point {
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

function contains(polygon: Point[] | null, point: Point) {
  if (!polygon) return true;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

class PixelCanvas {
  private currentWidth = 0;
  private currentHeight = 0;
  pixels = new Uint8ClampedArray();
  readonly context = new PixelContext(this);

  get width() { return this.currentWidth; }
  set width(value: number) { this.currentWidth = value; this.reset(); }
  get height() { return this.currentHeight; }
  set height(value: number) { this.currentHeight = value; this.reset(); }
  getContext(kind: string) { return kind === '2d' ? this.context : null; }

  setPixel(x: number, y: number, rgba: number[]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.pixels.set(rgba, (y * this.width + x) * 4);
  }

  getPixel(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    return Array.from(this.pixels.slice((y * this.width + x) * 4, (y * this.width + x) * 4 + 4));
  }

  private reset() { this.pixels = new Uint8ClampedArray(this.width * this.height * 4); }
}

interface DrawState {
  matrix: Matrix;
  clip: Point[] | null;
  alpha: number;
  composite: GlobalCompositeOperation;
}

class PixelContext {
  private state: DrawState = { matrix: [1, 0, 0, 1, 0, 0], clip: null, alpha: 1, composite: 'source-over' };
  private stack: DrawState[] = [];
  private path: Point[] = [];

  constructor(private canvas: PixelCanvas) {}
  get globalAlpha() { return this.state.alpha; }
  set globalAlpha(value: number) { this.state.alpha = value; }
  get globalCompositeOperation() { return this.state.composite; }
  set globalCompositeOperation(value: GlobalCompositeOperation) { this.state.composite = value; }
  save() { this.stack.push({ ...this.state, matrix: [...this.state.matrix], clip: this.state.clip?.map(point => ({ ...point })) ?? null }); }
  restore() { const restored = this.stack.pop(); if (restored) this.state = restored; }
  beginPath() { this.path = []; }
  moveTo(x: number, y: number) { this.path.push(map(this.state.matrix, { x, y })); }
  lineTo(x: number, y: number) { this.path.push(map(this.state.matrix, { x, y })); }
  closePath() {}
  clip() { this.state.clip = this.path.map(point => ({ ...point })); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.state.matrix = multiply(this.state.matrix, [a, b, c, d, e, f]);
  }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  rotate(angle: number) { this.transform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }

  drawImage(sourceValue: CanvasImageSource, ...values: number[]) {
    const source = sourceValue as unknown as PixelCanvas;
    if (!(source instanceof PixelCanvas)) throw new Error('Pixel test received an unsupported image source');
    const [dx, dy, dw, dh] = values.length === 2
      ? [values[0], values[1], source.width, source.height]
      : [values[0], values[1], values[2], values[3]];
    const inverse = invert(this.state.matrix);
    if (!inverse) return;
    for (let y = 0; y < this.canvas.height; y++) {
      for (let x = 0; x < this.canvas.width; x++) {
        const destination = { x: x + 0.5, y: y + 0.5 };
        if (!contains(this.state.clip, destination)) continue;
        const local = map(inverse, destination);
        const u = (local.x - dx) / dw;
        const v = (local.y - dy) / dh;
        if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
        const sampled = source.getPixel(Math.min(source.width - 1, Math.floor(u * source.width)), Math.min(source.height - 1, Math.floor(v * source.height)));
        this.composite(x, y, sampled);
      }
    }
  }

  getImageData(x: number, y: number) {
    return { data: new Uint8ClampedArray(this.canvas.getPixel(Math.round(x), Math.round(y))) };
  }

  private composite(x: number, y: number, source: number[]) {
    const alpha = source[3] / 255 * this.state.alpha;
    const next = [source[0], source[1], source[2], Math.round(alpha * 255)];
    if (this.state.composite === 'copy') {
      this.canvas.setPixel(x, y, next);
      return;
    }
    const destination = this.canvas.getPixel(x, y);
    const destinationAlpha = destination[3] / 255;
    const outputAlpha = alpha + destinationAlpha * (1 - alpha);
    if (outputAlpha === 0) { this.canvas.setPixel(x, y, [0, 0, 0, 0]); return; }
    this.canvas.setPixel(x, y, [
      Math.round((source[0] * alpha + destination[0] * destinationAlpha * (1 - alpha)) / outputAlpha),
      Math.round((source[1] * alpha + destination[1] * destinationAlpha * (1 - alpha)) / outputAlpha),
      Math.round((source[2] * alpha + destination[2] * destinationAlpha * (1 - alpha)) / outputAlpha),
      Math.round(outputAlpha * 255),
    ]);
  }
}

function makeDiagonalSource() {
  const source = new PixelCanvas();
  source.width = source.height = 160;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const checker = (Math.floor(x / 20) + Math.floor(y / 20)) % 2 ? 255 : 5;
      const diagonal = Math.abs(x + y - 159) <= 6;
      source.setPixel(x, y, diagonal ? [255, 0, 255, 255] : [checker, checker, checker, 255]);
    }
  }
  return source;
}

afterEach(() => vi.restoreAllMocks());

describe('perspective preview/export pixels', () => {
  // Mutations caught: omitting perspective in drawPlacedLayer, using a
  // different quad, or bypassing the shared renderer in either consumer.
  it('matches projected high-contrast diagonal pixels at the export compositor boundary', () => {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() === 'canvas') return new PixelCanvas() as unknown as HTMLCanvasElement;
      return createElement(tagName);
    }) as typeof document.createElement);
    const source = makeDiagonalSource();
    const preview = new PixelCanvas();
    const exported = new PixelCanvas();
    preview.width = exported.width = 240;
    preview.height = exported.height = 180;
    const quad = {
      topLeft: { x: 0.08, y: 0.14 }, topRight: { x: 0.9, y: 0.04 },
      bottomRight: { x: 0.82, y: 0.92 }, bottomLeft: { x: 0.18, y: 0.78 },
    };

    drawPerspectiveImage(preview.context as unknown as CanvasRenderingContext2D, source as unknown as CanvasImageSource, quad, preview.width, preview.height, { quality: 'preview' });
    drawPlacedLayer(exported.context as unknown as CanvasRenderingContext2D, source as unknown as HTMLCanvasElement, { perspective: quad, opacity: 1 }, exported.width, exported.height);

    const homography = perspectiveHomography(quad, preview.width, preview.height)!;
    const comparisons = [0.2, 0.35, 0.5, 0.65, 0.8].map(value => {
      const point = projectHomography(homography, { x: value, y: 1 - value });
      return { preview: preview.getPixel(Math.round(point.x), Math.round(point.y)), exported: exported.getPixel(Math.round(point.x), Math.round(point.y)) };
    });
    expect(comparisons.map(sample => sample.preview)).toEqual(Array(5).fill([255, 0, 255, 255]));
    expect(comparisons.map(sample => sample.exported)).toEqual(comparisons.map(sample => sample.preview));
  });
});
