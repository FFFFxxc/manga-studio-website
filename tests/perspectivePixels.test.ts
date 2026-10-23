import { describe, expect, it } from 'vitest';
import { invertHomography, perspectiveHomography } from '@/utils/perspective';
import { rasterizePerspectivePixels } from '@/utils/perspectivePixels';

const rectangle = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } };
const full = { x: 0, y: 0, width: 1, height: 1 };

describe('seam-free perspective pixels', () => {
  it('leaves an identity projection pixel-perfect', () => {
    const source = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
    for (let index = 0; index < source.data.length; index += 4) source.data.set([index * 3, index * 2, index, 255], index);
    const inverse = invertHomography(perspectiveHomography(rectangle, 4, 4)!)!;
    const pixels = rasterizePerspectivePixels({ source, inverse, bounds: { x: 0, y: 0, width: 4, height: 4 }, destination: full });
    expect(pixels).toEqual(source.data);
  });

  it('does not create opaque seams anywhere on a translucent skewed surface', () => {
    const source = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4) };
    for (let index = 0; index < source.data.length; index += 4) source.data.set([220, 30, 80, 128], index);
    const quad = { topLeft: { x: 0.1, y: 0.1 }, topRight: { x: 0.8, y: 0.2 }, bottomRight: { x: 0.9, y: 0.9 }, bottomLeft: { x: 0.2, y: 0.8 } };
    const inverse = invertHomography(perspectiveHomography(quad, 64, 48)!)!;
    const pixels = rasterizePerspectivePixels({ source, inverse, bounds: { x: 0, y: 0, width: 64, height: 48 }, destination: full });
    const alphas = Array.from(pixels).filter((_, index) => index % 4 === 3);
    expect(Math.max(...alphas)).toBe(128);
    expect(alphas.filter(alpha => alpha === 128).length).toBeGreaterThan(1000);
    expect(alphas.some(alpha => alpha > 0 && alpha < 128)).toBe(true);
  });

  it('maps a cropped subsection without stretching it to the whole source', () => {
    const source = { width: 4, height: 2, data: new Uint8ClampedArray(32) };
    for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) source.data.set([x * 60, 20, 50, 255], (y * 4 + x) * 4);
    const inverse = invertHomography(perspectiveHomography(rectangle, 2, 2)!)!;
    const pixels = rasterizePerspectivePixels({ source, inverse, bounds: { x: 0, y: 0, width: 2, height: 2 }, destination: full, sourceBounds: { x: 0.5, y: 0, width: 0.5, height: 1 } });
    expect(pixels[0]).toBe(120);
    expect(pixels[4]).toBe(180);
  });
});
