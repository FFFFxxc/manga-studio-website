import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawBrushStroke } from '@/utils/brushRaster';
import { getBrushSpacingPx, getBrushTipRadii } from '@/utils/brushTip';

describe('brush tip geometry', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [0, 0],
    [0.5, 25],
    [1, 50],
  ])('maps hardness %s to a visible hard core', (hardness, expected) => {
    expect(getBrushTipRadii(100, hardness).hard).toBe(expected);
  });

  it('clamps invalid diameter and hardness values', () => {
    expect(getBrushTipRadii(0, -2)).toEqual({ outer: 0.5, hard: 0 });
    expect(getBrushTipRadii(20, 3)).toEqual({ outer: 10, hard: 10 });
  });

  it('keeps stamp spacing dense enough for soft strokes', () => {
    expect(getBrushSpacingPx(100, 0)).toBe(8);
    expect(getBrushSpacingPx(100, 1)).toBeCloseTo(14, 10);
  });

  // Mutations caught: restoring brushRaster's old spacing or deriving its
  // radial stop independently makes live and committed strokes disagree.
  it('uses shared tip radii and spacing in committed raster interpolation', () => {
    const contexts: Array<{
      drawImage: ReturnType<typeof vi.fn>;
      radialArgs: number[][];
      stops: Array<[number, string]>;
    }> = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext() {
      const radialArgs: number[][] = [];
      const stops: Array<[number, string]> = [];
      const context = {
        fillStyle: '',
        globalCompositeOperation: 'source-over',
        createRadialGradient: (...args: number[]) => {
          radialArgs.push(args);
          return { addColorStop: (offset: number, color: string) => stops.push([offset, color]) };
        },
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      };
      contexts.push({ drawImage: context.drawImage, radialArgs, stops });
      return context as unknown as CanvasRenderingContext2D;
    });
    const target = {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      save: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawBrushStroke(target, {
      id: 'shared-soft-tip',
      points: [0.2, 0.5, 0.8, 0.5],
      size: 0.1,
      color: 'rgb(1, 2, 3)',
      opacity: 1,
      hardness: 0.5,
      mode: 'paint',
      purpose: 'paint',
    }, 1000, 1000);

    expect(contexts[0].radialArgs[0]).toEqual([52, 52, 0, 52, 52, 50]);
    expect(contexts[0].stops).toContainEqual([0.5, 'rgba(255,255,255,1)']);
    // 600px / 8px = 75 interpolated stamps, plus the starting stamp.
    expect(contexts[1].drawImage).toHaveBeenCalledTimes(76);

    const contextCount = contexts.length;
    drawBrushStroke(target, {
      id: 'near-hard-tip',
      points: [0.5, 0.5],
      size: 0.08,
      color: 'rgb(9, 8, 7)',
      opacity: 1,
      hardness: 0.999,
      mode: 'paint',
      purpose: 'paint',
    }, 1000, 1000);

    // Near-hard tips remain a narrow real gradient. The cursor's 99.9% hard
    // core must not abruptly turn into a fully-hard raster disk.
    expect(contexts[contextCount].radialArgs).not.toHaveLength(0);
    expect(contexts[contextCount].stops[1][0]).toBeCloseTo(0.999, 10);
  });
});
