import { describe, expect, it } from 'vitest';
import {
  createPastedImageLayer,
  planPastedImagePlacement,
  findAlphaBounds,
} from '@/utils/pastedImageLayers';

describe('pasted image placement', () => {
  it('aligns a full-page PNG exactly instead of shrinking it to 95 percent', () => {
    expect(planPastedImagePlacement(1000, 800, 1000, 800)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('snaps a small PNG to pixels on an odd-sized page', () => {
    const crop = planPastedImagePlacement(1001, 801, 100, 100);
    expect(Number.isInteger(crop.x * 1001)).toBe(true);
    expect(Number.isInteger(crop.y * 801)).toBe(true);
    expect(crop.width * 1001).toBe(100);
    expect(crop.height * 801).toBe(100);
  });

  it('places a dropped image at the pointer while keeping it inside the page', () => {
    const crop = planPastedImagePlacement(1000, 800, 100, 100, 0, { x: 0.2, y: 0.3 });
    expect(crop.x).toBe(0.15);
    expect(crop.y).toBe(0.2375);
    const edge = planPastedImagePlacement(1000, 800, 100, 100, 0, { x: 1, y: 1 });
    expect(edge.x + edge.width).toBe(1);
    expect(edge.y + edge.height).toBe(1);
  });

  it('uses only nontransparent pixels for the frame, including faint edge pixels', () => {
    const data = new Uint8ClampedArray(8 * 6 * 4);
    data[(2 * 8 + 3) * 4 + 3] = 255;
    data[(4 * 8 + 5) * 4 + 3] = 1;
    expect(findAlphaBounds(data, 8, 6)).toEqual({ x: 3, y: 2, width: 3, height: 3 });
    expect(findAlphaBounds(new Uint8ClampedArray(8 * 6 * 4), 8, 6)).toBeNull();
  });
  it('keeps a smaller image at pixel size and centers it', () => {
    expect(planPastedImagePlacement(1000, 800, 400, 300)).toEqual({
      x: 0.3,
      y: 0.3125,
      width: 0.4,
      height: 0.375,
    });
  });

  it('fits oversized images to 95 percent without changing aspect ratio', () => {
    const crop = planPastedImagePlacement(1000, 1000, 2000, 1000);
    expect(crop.width).toBeCloseTo(0.95);
    expect(crop.height).toBeCloseTo(0.475);
    expect(crop.x).toBeCloseTo(0.025);
  });

  it('cascades multiple images while keeping them inside the page', () => {
    const first = planPastedImagePlacement(1000, 800, 400, 300, 0);
    const second = planPastedImagePlacement(1000, 800, 400, 300, 1);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.x + second.width).toBeLessThanOrEqual(1);
    expect(second.y + second.height).toBeLessThanOrEqual(1);
  });

  it('creates an unlocked drawing layer with a visible crop', () => {
    const layer = createPastedImageLayer({
      id: 'doc',
      width: 1000,
      height: 800,
      aiLayers: [],
    }, {
      src: 'data:image/png;base64,x',
      width: 400,
      height: 300,
      name: 'panel.png',
    });
    expect(layer).toMatchObject({
      operation: 'drawing',
      locked: false,
      visible: true,
      opacity: 1,
      name: 'panel.png',
      crop: { x: 0.3, y: 0.3125, width: 0.4, height: 0.375 },
    });
  });
});
