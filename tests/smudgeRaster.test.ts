import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderSmudgeSegment } from '@/utils/smudgeRaster';

function memoryCanvas(width: number, height: number, pixels: Uint8ClampedArray) {
  const context = {
    drawImage(source: HTMLCanvasElement) {
      pixels.set((source as HTMLCanvasElement & { pixels: Uint8ClampedArray }).pixels);
    },
    getImageData(x: number, y: number, readWidth: number, readHeight: number) {
      const data = new Uint8ClampedArray(readWidth * readHeight * 4);
      for (let row = 0; row < readHeight; row++) for (let column = 0; column < readWidth; column++) {
        const source = ((y + row) * width + x + column) * 4;
        data.set(pixels.slice(source, source + 4), (row * readWidth + column) * 4);
      }
      return { data, width: readWidth, height: readHeight } as ImageData;
    },
    putImageData(image: ImageData, x: number, y: number) {
      for (let row = 0; row < image.height; row++) for (let column = 0; column < image.width; column++) {
        const target = ((y + row) * width + x + column) * 4;
        pixels.set(image.data.slice((row * image.width + column) * 4, (row * image.width + column) * 4 + 4), target);
      }
    },
  };
  return { width, height, pixels, getContext: () => context } as unknown as HTMLCanvasElement & { pixels: Uint8ClampedArray };
}

describe('smudge raster primitive', () => {
  afterEach(() => vi.restoreAllMocks());

  it('moves sampled color in pointer direction without changing pixels outside the brush', () => {
    const sourcePixels = new Uint8ClampedArray(5 * 3 * 4);
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      sourcePixels.set(x < 2 ? [230, 20, 20, 255] : [20, 20, 230, 255], (y * 5 + x) * 4);
    }
    const source = memoryCanvas(5, 3, sourcePixels);
    const output = memoryCanvas(5, 3, new Uint8ClampedArray(5 * 3 * 4));
    vi.spyOn(document, 'createElement').mockReturnValue(output);

    const result = renderSmudgeSegment(source, { x: 1, y: 1 }, { x: 3, y: 1 }, {
      size: 3,
      hardness: 1,
      strength: 1,
    }) as HTMLCanvasElement & { pixels: Uint8ClampedArray };

    const destination = Array.from(result.pixels.slice((1 * 5 + 3) * 4, (1 * 5 + 3) * 4 + 4));
    expect(destination[0]).toBeGreaterThan(200);
    expect(Array.from(result.pixels.slice(0, 4))).toEqual([230, 20, 20, 255]);
  });
});
