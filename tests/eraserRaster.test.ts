import { describe, expect, it } from 'vitest';
import { renderEraserMaskToRaster } from '@/utils/eraserRaster';
import { affineToPerspective } from '@/utils/perspective';

function memoryCanvas(width: number, height: number, pixels = new Uint8ClampedArray(width * height * 4)) {
  const context = {
    getImageData(x: number, y: number, readWidth: number, readHeight: number) {
      const data = new Uint8ClampedArray(readWidth * readHeight * 4);
      for (let row = 0; row < readHeight; row += 1) for (let column = 0; column < readWidth; column += 1) {
        const source = ((y + row) * width + x + column) * 4;
        data.set(pixels.slice(source, source + 4), (row * readWidth + column) * 4);
      }
      return { data, width: readWidth, height: readHeight } as ImageData;
    },
    putImageData(image: ImageData, x: number, y: number) {
      for (let row = 0; row < image.height; row += 1) for (let column = 0; column < image.width; column += 1) {
        const target = ((y + row) * width + x + column) * 4;
        pixels.set(image.data.slice((row * image.width + column) * 4, (row * image.width + column) * 4 + 4), target);
      }
    },
  };
  return { width, height, pixels, getContext: () => context } as unknown as HTMLCanvasElement & { pixels: Uint8ClampedArray };
}

describe('eraser rasterization', () => {
  it('samples a document mask through the inverse affine placement and removes alpha immediately', () => {
    const originalPixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 0; index < originalPixels.length; index += 4) {
      originalPixels.set([90, 120, 150, 255], index);
    }
    const documentMaskPixels = new Uint8ClampedArray(originalPixels.length);
    // Local pixel (1, 2) maps through x=0.25, scale=.5 to document pixel
    // floor((.375 * .5 + .25) * 4) = 1, y=floor(.625 * 4) = 2.
    documentMaskPixels[(2 * 4 + 1) * 4 + 3] = 255;
    const original = memoryCanvas(4, 4, originalPixels);
    const working = memoryCanvas(4, 4, new Uint8ClampedArray(originalPixels));
    const localMask = memoryCanvas(4, 4);
    const documentMask = memoryCanvas(4, 4, documentMaskPixels);

    const changed = renderEraserMaskToRaster({
      original,
      working,
      localMask,
      documentMask,
      placement: { x: 0.25, scaleX: 0.5 },
      documentBounds: { x: 1, y: 2, width: 1, height: 1 },
    });

    expect(changed).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(working.pixels[(2 * 4 + 1) * 4 + 3]).toBe(0);
    expect(localMask.pixels[(2 * 4 + 1) * 4 + 3]).toBe(255);
    expect(working.pixels[(2 * 4 + 2) * 4 + 3]).toBe(255);
  });

  it('preserves soft opacity in the committed local mask', () => {
    const originalPixels = new Uint8ClampedArray(2 * 2 * 4);
    for (let index = 3; index < originalPixels.length; index += 4) originalPixels[index] = 200;
    const documentMaskPixels = new Uint8ClampedArray(originalPixels.length);
    documentMaskPixels[3] = 128;
    const original = memoryCanvas(2, 2, originalPixels);
    const working = memoryCanvas(2, 2, new Uint8ClampedArray(originalPixels));
    const localMask = memoryCanvas(2, 2);

    renderEraserMaskToRaster({
      original,
      working,
      localMask,
      documentMask: memoryCanvas(2, 2, documentMaskPixels),
      placement: {},
      documentBounds: { x: 0, y: 0, width: 1, height: 1 },
      opacity: 0.5,
    });

    expect(localMask.pixels[3]).toBe(64);
    expect(working.pixels[3]).toBe(150);
  });

  it('uses inverse projective coordinates for a perspective layer', () => {
    const originalPixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 3; index < originalPixels.length; index += 4) originalPixels[index] = 255;
    const original = memoryCanvas(4, 4, originalPixels);
    const working = memoryCanvas(4, 4, new Uint8ClampedArray(originalPixels));
    const localMask = memoryCanvas(4, 4);
    const documentMaskPixels = new Uint8ClampedArray(originalPixels.length);
    documentMaskPixels[(2 * 4 + 1) * 4 + 3] = 255;

    renderEraserMaskToRaster({
      original,
      working,
      localMask,
      documentMask: memoryCanvas(4, 4, documentMaskPixels),
      placement: { perspective: affineToPerspective(4, 4, { x: 0.25, scaleX: 0.5 }) },
      documentBounds: { x: 1, y: 2, width: 1, height: 1 },
    });

    expect(working.pixels[(2 * 4 + 1) * 4 + 3]).toBe(0);
    expect(localMask.pixels[(2 * 4 + 1) * 4 + 3]).toBe(255);
    expect(working.pixels[(2 * 4 + 2) * 4 + 3]).toBe(255);
  });

  it('does not restore pixels erased by an earlier preview segment', () => {
    const originalPixels = new Uint8ClampedArray(6 * 2 * 4);
    for (let index = 3; index < originalPixels.length; index += 4) originalPixels[index] = 255;
    const original = memoryCanvas(6, 2, originalPixels);
    const working = memoryCanvas(6, 2, new Uint8ClampedArray(originalPixels));
    const localMask = memoryCanvas(6, 2);
    const documentMaskPixels = new Uint8ClampedArray(originalPixels.length);
    documentMaskPixels[(0 * 6 + 1) * 4 + 3] = 255;
    const documentMask = memoryCanvas(6, 2, documentMaskPixels);

    renderEraserMaskToRaster({
      original, working, localMask, documentMask, placement: {},
      documentBounds: { x: 1, y: 0, width: 1, height: 1 },
    });
    expect(working.pixels[(0 * 6 + 1) * 4 + 3]).toBe(0);

    documentMaskPixels[(0 * 6 + 3) * 4 + 3] = 255;
    renderEraserMaskToRaster({
      original, working, localMask, documentMask, placement: {},
      documentBounds: { x: 3, y: 0, width: 1, height: 1 },
    });

    expect(working.pixels[(0 * 6 + 1) * 4 + 3]).toBe(0);
    expect(working.pixels[(0 * 6 + 3) * 4 + 3]).toBe(0);
  });
});
