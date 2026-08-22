import { describe, expect, it } from 'vitest';
import { createTextDraftRect, normalizeParagraphTransform } from '@/utils/textBox';

describe('paragraph text geometry', () => {
  it('treats a short gesture as point text', () => {
    expect(createTextDraftRect({ x: 100, y: 100 }, { x: 102, y: 101 }, { width: 1000, height: 800 }, 5).mode).toBe('point');
  });

  it('normalizes reverse drag into a paragraph rectangle', () => {
    expect(createTextDraftRect({ x: 500, y: 400 }, { x: 200, y: 100 }, { width: 1000, height: 800 }, 5)).toMatchObject({
      mode: 'paragraph', x: 0.2, y: 0.125, width: 0.3, height: 0.375,
    });
  });

  it('bakes horizontal transformer scale into width', () => {
    expect(normalizeParagraphTransform(
      { width: 0.2, height: 0.1 },
      { x: 100, y: 80, width: 200, height: 100, scaleX: 1.5, scaleY: 1 },
      { width: 1000, height: 800 },
    )).toMatchObject({ width: 0.3, height: 0.125, scaleX: 1, scaleY: 1 });
  });

  it('keeps paragraph boxes at least twenty-four document pixels tall', () => {
    expect(createTextDraftRect(
      { x: 100, y: 100 },
      { x: 112, y: 110 },
      { width: 1000, height: 800 },
      5,
    )).toMatchObject({ mode: 'paragraph', width: 0.024, height: 0.03 });
  });

  // Mutation caught: clamping only the drag origin lets the 24px minimum box
  // extend past the document when the gesture begins at its lower-right edge.
  it('keeps a minimum paragraph draft inside the document near its edges', () => {
    expect(createTextDraftRect(
      { x: 995, y: 795 },
      { x: 1000, y: 800 },
      { width: 1000, height: 800 },
      5,
    )).toMatchObject({
      mode: 'paragraph',
      x: 0.976,
      y: 0.97,
      width: 0.024,
      height: 0.03,
    });
  });
});
