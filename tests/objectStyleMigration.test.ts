import { describe, expect, it } from 'vitest';
import { sanitizeBubble, sanitizeShape, sanitizeText } from '@/utils/coordinates';
import type { BubbleObject, ShapeObject, TextObject } from '@/types';

const legacyShape: ShapeObject = {
  id: 'shape-1',
  kind: 'rect',
  x: 0.5,
  y: 0.5,
  width: 0.2,
  height: 0.1,
  fill: '#123456',
  stroke: '#abcdef',
  strokeWidth: 4,
  opacity: 1,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  cornerRadius: 0,
  visible: true,
};

const legacyBubble: BubbleObject = {
  id: 'bubble-1',
  kind: 'speech',
  visible: true,
  x: 0.5,
  y: 0.5,
  width: 0.3,
  height: 0.2,
  rotation: 0,
  autoSize: true,
  tail: null,
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 2,
  text: {
    content: 'тест',
    fontFamily: 'Arial',
    fontSize: 16,
    fill: '#000000',
    align: 'center',
    lineHeight: 1.3,
  },
};

const legacyText: TextObject = {
  id: 'text-1', text: 'Текст', fontFamily: 'Arial', fontSize: 0.05,
  fill: '#123456', stroke: '', strokeWidth: 0,
  shadowColor: 'transparent', shadowBlur: 0, lineHeight: 1.2, align: 'center',
  width: 0.3, x: 0.2, y: 0.2, scaleX: 1, scaleY: 1, rotation: 0, visible: true,
};

describe('vector style migration', () => {
  it('creates solid styles from legacy shape colors', () => {
    const sanitized = sanitizeShape(legacyShape);
    expect(sanitized?.fillStyle).toEqual({ type: 'solid', color: '#123456' });
    expect(sanitized?.strokeStyle).toEqual({ type: 'solid', color: '#abcdef' });
    expect(sanitized?.glow?.enabled).toBe(false);
    expect(sanitized?.lineStyle).toBe('solid');
  });

  it('creates solid styles from legacy bubble colors', () => {
    const sanitized = sanitizeBubble(legacyBubble);
    expect(sanitized?.fillStyle).toEqual({ type: 'solid', color: '#ffffff' });
    expect(sanitized?.strokeStyle).toEqual({ type: 'solid', color: '#000000' });
    expect(sanitized?.glow?.enabled).toBe(false);
  });

  it('creates solid paints from legacy text colors', () => {
    const sanitized = sanitizeText(legacyText);
    expect(sanitized?.fillStyle).toEqual({ type: 'solid', color: '#123456' });
    expect(sanitized?.strokeStyle).toEqual({ type: 'solid', color: 'transparent' });
  });

  it('sanitizes an invalid gradient without dropping the object', () => {
    const sanitized = sanitizeShape({
      ...legacyShape,
      fillStyle: {
        type: 'radial',
        centerX: 5,
        centerY: -2,
        radius: 99,
        stops: [{ id: 'only', offset: 4, color: '' }],
      },
    });
    expect(sanitized?.fillStyle?.type).toBe('radial');
    if (sanitized?.fillStyle?.type !== 'radial') throw new Error('expected radial');
    expect(sanitized.fillStyle.centerX).toBe(1);
    expect(sanitized.fillStyle.centerY).toBe(0);
    expect(sanitized.fillStyle.radius).toBe(2);
    expect(sanitized.fillStyle.stops).toHaveLength(2);
  });

  it('drops unknown shape and bubble kinds from corrupted documents', () => {
    expect(sanitizeShape({ ...legacyShape, kind: 'unknown-shape' as never })).toBeNull();
    expect(sanitizeBubble({ ...legacyBubble, kind: 'unknown-bubble' as never })).toBeNull();
  });

  it('keeps an empty legacy shape fill transparent', () => {
    expect(sanitizeShape({ ...legacyShape, fill: '', fillStyle: undefined })?.fillStyle)
      .toEqual({ type: 'solid', color: 'transparent' });
  });

  it('keeps explicitly empty legacy strokes transparent', () => {
    expect(sanitizeShape({ ...legacyShape, stroke: '', strokeStyle: undefined })?.strokeStyle)
      .toEqual({ type: 'solid', color: 'transparent' });
    expect(sanitizeBubble({ ...legacyBubble, stroke: '', strokeStyle: undefined })?.strokeStyle)
      .toEqual({ type: 'solid', color: 'transparent' });
  });
});
