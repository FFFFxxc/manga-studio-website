import { describe, expect, it } from 'vitest';
import {
  mapCloneSamplePoint,
  mapDocumentPointToRasterPoint,
  mapRasterPointToDocumentPoint,
  renderCloneStampStroke,
} from '@/utils/cloneStamp';
import { affineToPerspective } from '@/utils/perspective';

describe('clone stamp coordinates', () => {
  const memoryCanvas = (width: number, height: number, pixels = new Uint8ClampedArray(width * height * 4)) => {
    const context = {
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
  };

  it('keeps a constant source offset through an aligned stroke', () => {
    expect(mapCloneSamplePoint(
      { x: 90, y: 80 },
      { x: 20, y: 30 },
      { x: 70, y: 60 },
    )).toEqual({ x: 40, y: 50 });
  });

  it('round-trips document points through an affine raster placement', () => {
    const placement = { x: 0.12, y: -0.08, scaleX: 0.75, scaleY: 1.2, rotation: 17 };
    const documentPoint = { x: 0.42, y: 0.37 };
    const local = mapDocumentPointToRasterPoint(documentPoint, placement, 1200, 800);
    expect(local).not.toBeNull();
    const roundTrip = mapRasterPointToDocumentPoint(local!, placement, 1200, 800);
    expect(roundTrip?.x).toBeCloseTo(documentPoint.x, 8);
    expect(roundTrip?.y).toBeCloseTo(documentPoint.y, 8);
  });

  it('round-trips document points through a perspective quad', () => {
    const perspective = affineToPerspective(1000, 800, { x: 0.05, y: 0.1, scaleX: 0.8, scaleY: 0.7, rotation: 9 });
    perspective.topRight.x -= 0.12;
    perspective.bottomLeft.y -= 0.08;
    const placement = { perspective };
    const local = { x: 0.31, y: 0.58 };
    const documentPoint = mapRasterPointToDocumentPoint(local, placement, 1000, 800);
    expect(documentPoint).not.toBeNull();
    const roundTrip = mapDocumentPointToRasterPoint(documentPoint!, placement, 1000, 800);
    expect(roundTrip?.x).toBeCloseTo(local.x, 7);
    expect(roundTrip?.y).toBeCloseTo(local.y, 7);
  });

  it('copies the sampled pixel only inside the brush alpha', () => {
    const originalPixels = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 3; index < originalPixels.length; index += 4) originalPixels[index] = 255;
    const samplePixels = new Uint8ClampedArray(originalPixels);
    samplePixels.set([220, 30, 40, 255], (1 * 4 + 0) * 4);
    const maskPixels = new Uint8ClampedArray(4 * 4 * 4);
    maskPixels[(1 * 4 + 2) * 4 + 3] = 255;
    const original = memoryCanvas(4, 4, originalPixels);
    const working = memoryCanvas(4, 4, new Uint8ClampedArray(originalPixels));
    const sample = memoryCanvas(4, 4, samplePixels);
    const mask = memoryCanvas(4, 4, maskPixels);

    renderCloneStampStroke({
      original,
      working,
      sample,
      samplePixels,
      strokeMask: mask,
      placement: {},
      documentBounds: { x: 2, y: 1, width: 1, height: 1 },
      sourceAnchor: { x: 0.125, y: 0.375 },
      strokeAnchor: { x: 0.625, y: 0.375 },
      opacity: 1,
    });

    expect(Array.from(working.pixels.slice((1 * 4 + 2) * 4, (1 * 4 + 2) * 4 + 4))).toEqual([220, 30, 40, 255]);
    expect(Array.from(working.pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });
});
