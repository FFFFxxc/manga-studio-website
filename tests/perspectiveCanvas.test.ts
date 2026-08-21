import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/perspectiveWebgl', () => ({
  renderPerspectiveWebgl: vi.fn(),
}));

import { drawPerspectiveCanvas } from '@/utils/perspectiveCanvas';
import { drawPerspectiveImage } from '@/utils/perspective';
import { renderPerspectiveWebgl } from '@/utils/perspectiveWebgl';

const rectangle = {
  topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
};

function createRecordingContext(initialAlpha = 1) {
  const paths: Array<Array<[number, number]>> = [];
  const alphaWrites: number[] = [];
  const compositeWrites: GlobalCompositeOperation[] = [];
  let current: Array<[number, number]> = [];
  let globalAlpha = initialAlpha;
  let globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: () => { current = []; },
    moveTo: (x: number, y: number) => current.push([x, y]),
    lineTo: (x: number, y: number) => current.push([x, y]),
    closePath: vi.fn(),
    clip: () => paths.push([...current]),
    transform: vi.fn(),
    drawImage: vi.fn(),
    get globalAlpha() { return globalAlpha; },
    set globalAlpha(value: number) { globalAlpha = value; alphaWrites.push(value); },
    get globalCompositeOperation() { return globalCompositeOperation; },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      globalCompositeOperation = value;
      compositeWrites.push(value);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, paths, alphaWrites, compositeWrites };
}

function createRecordingCanvas(context: CanvasRenderingContext2D) {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
}

describe('perspective Canvas renderer', () => {
  beforeEach(() => {
    vi.mocked(renderPerspectiveWebgl).mockReset();
  });

  it('overlaps internal triangles while retaining the exact external quad clip', () => {
    const target = createRecordingContext();
    const mesh = createRecordingContext();
    const canvas = createRecordingCanvas(mesh.ctx);
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;

    drawPerspectiveCanvas(target.ctx, source, rectangle, 200, 100, {
      quality: 'drag',
      seamOverlapPx: 0.75,
      canvasFactory: () => canvas,
    });

    expect(target.paths).toEqual([[[0, 0], [200, 0], [200, 100], [0, 100]]]);
    expect(mesh.paths.length).toBeGreaterThan(2);
    expect(mesh.paths.slice(1).some(path => path.some(([x]) => x < 0 || x > 200))).toBe(true);
  });

  it('replaces overlapping triangle samples instead of source-over accumulating alpha', () => {
    const target = createRecordingContext();
    const mesh = createRecordingContext();
    const canvas = createRecordingCanvas(mesh.ctx);
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;

    drawPerspectiveCanvas(target.ctx, source, rectangle, 200, 100, {
      subdivisions: 2,
      canvasFactory: () => canvas,
    });

    expect(mesh.compositeWrites).toContain('copy');
    expect(target.compositeWrites).toEqual([]);
    expect(mesh.ctx.drawImage).toHaveBeenCalledTimes(8);
    expect(target.ctx.drawImage).toHaveBeenCalledOnce();
  });

  it('applies caller opacity once when compositing the completed fallback surface', () => {
    const target = createRecordingContext(0.8);
    const mesh = createRecordingContext();
    const canvas = createRecordingCanvas(mesh.ctx);
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;

    drawPerspectiveCanvas(target.ctx, source, rectangle, 200, 100, {
      opacity: 0.5,
      subdivisions: 2,
      canvasFactory: () => canvas,
    });

    expect(mesh.alphaWrites).toEqual([]);
    expect(target.alphaWrites).toEqual([0.4]);
    expect(target.ctx.drawImage).toHaveBeenCalledOnce();
    expect(target.ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 200, 100);
  });

  it('bounds the fallback surface to the projected crop and clips it exactly at composition', () => {
    const target = createRecordingContext();
    const mesh = createRecordingContext();
    const canvas = createRecordingCanvas(mesh.ctx);
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;

    drawPerspectiveCanvas(target.ctx, source, rectangle, 200, 100, {
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      subdivisions: 2,
      canvasFactory: () => canvas,
    });

    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
    expect(target.paths).toEqual([[[50, 25], [150, 25], [150, 75], [50, 75]]]);
    expect(target.ctx.drawImage).toHaveBeenCalledWith(canvas, 50, 25, 100, 50);
  });

  it('draws a successful WebGL render once at its bounded destination', () => {
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;
    const rendered = { width: 160, height: 80 } as HTMLCanvasElement;
    vi.mocked(renderPerspectiveWebgl).mockReturnValue({
      canvas: rendered,
      bounds: { x: 20, y: 10, width: 160, height: 80 },
    });
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    drawPerspectiveImage(ctx, source, rectangle, 200, 100);

    expect(renderPerspectiveWebgl).toHaveBeenCalledWith(source, rectangle, 200, 100);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledWith(rendered, 20, 10, 160, 80);
  });

  it('clips a WebGL render to the projected crop without changing its texture mapping', () => {
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;
    const rendered = { width: 200, height: 100 } as HTMLCanvasElement;
    vi.mocked(renderPerspectiveWebgl).mockReturnValue({
      canvas: rendered,
      bounds: { x: 0, y: 0, width: 200, height: 100 },
    });
    const paths: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    const alphaWrites: number[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: () => { current = []; },
      moveTo: (x: number, y: number) => current.push([x, y]),
      lineTo: (x: number, y: number) => current.push([x, y]),
      closePath: vi.fn(),
      clip: () => paths.push([...current]),
      drawImage: vi.fn(),
      get globalAlpha() { return 0.8; },
      set globalAlpha(value: number) { alphaWrites.push(value); },
    } as unknown as CanvasRenderingContext2D;

    drawPerspectiveImage(ctx, source, rectangle, 200, 100, {
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      opacity: 0.5,
    });

    expect(paths).toEqual([[[50, 25], [150, 25], [150, 75], [50, 75]]]);
    expect(alphaWrites).toEqual([0.4]);
    expect(ctx.drawImage).toHaveBeenCalledOnce();
  });

  it('keeps sourceBounds on the Canvas fallback so the selected source rect fills the quad', () => {
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;
    const rendered = { width: 200, height: 100 } as HTMLCanvasElement;
    vi.mocked(renderPerspectiveWebgl).mockReturnValue({
      canvas: rendered,
      bounds: { x: 0, y: 0, width: 200, height: 100 },
    });
    const target = createRecordingContext();
    const mesh = createRecordingContext();
    const canvas = createRecordingCanvas(mesh.ctx);

    drawPerspectiveImage(target.ctx, source, rectangle, 200, 100, {
      sourceBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      subdivisions: 2,
      canvasFactory: () => canvas,
    });

    expect(target.paths).toEqual([[[0, 0], [200, 0], [200, 100], [0, 100]]]);
    expect(mesh.ctx.drawImage).toHaveBeenCalledTimes(8);
    expect(vi.mocked(mesh.ctx.drawImage).mock.calls.every(([image]) => image === source)).toBe(true);
    expect(target.ctx.drawImage).toHaveBeenCalledWith(canvas, 0, 0, 200, 100);
  });

  // Mutation caught: ignoring crop whenever sourceBounds is present stretches
  // the full source-bounds sample across the quad instead of retaining the
  // crop's original-source position inside that mapping.
  it('maps the crop and source-bounds intersection into its local quad subregion', () => {
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;
    const target = createRecordingContext();
    const mesh = createRecordingContext();
    const canvas = createRecordingCanvas(mesh.ctx);

    drawPerspectiveImage(target.ctx, source, rectangle, 200, 100, {
      sourceBounds: { x: 0.125, y: 0.125, width: 0.5, height: 0.5 },
      crop: { x: 0.1875, y: 0.25, width: 0.25, height: 0.1875 },
      subdivisions: 2,
      canvasFactory: () => canvas,
    });

    const expectedPath = [[25, 25], [125, 25], [125, 62.5], [25, 62.5]];
    expect(target.paths[0]).toHaveLength(expectedPath.length);
    target.paths[0].forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expectedPath[index][0], 8);
      expect(y).toBeCloseTo(expectedPath[index][1], 8);
    });
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(38);
    expect(target.ctx.drawImage).toHaveBeenCalledWith(canvas, 25, 25, 100, 38);
  });
});
