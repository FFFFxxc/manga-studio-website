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

describe('perspective Canvas renderer', () => {
  beforeEach(() => {
    vi.mocked(renderPerspectiveWebgl).mockReset();
  });

  it('overlaps internal triangles while retaining the exact external quad clip', () => {
    const paths: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
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
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    const source = { width: 200, height: 100 } as unknown as CanvasImageSource;

    drawPerspectiveCanvas(ctx, source, rectangle, 200, 100, {
      quality: 'drag',
      seamOverlapPx: 0.75,
    });

    expect(paths[0]).toEqual([[0, 0], [200, 0], [200, 100], [0, 100]]);
    expect(paths.length).toBeGreaterThan(2);
    expect(paths.slice(1).some(path => path.some(([x]) => x < 0 || x > 200))).toBe(true);
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
    const paths: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
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
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    drawPerspectiveImage(ctx, source, rectangle, 200, 100, {
      sourceBounds: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      subdivisions: 2,
    });

    expect(paths[0]).toEqual([[0, 0], [200, 0], [200, 100], [0, 100]]);
    expect(ctx.drawImage).toHaveBeenCalledTimes(8);
    expect(vi.mocked(ctx.drawImage).mock.calls.every(([image]) => image === source)).toBe(true);
  });
});
