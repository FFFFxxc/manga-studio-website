import { describe, expect, it } from 'vitest';
import {
  BASIC_SHAPE_PRESETS,
  POINTER_PRESETS,
  createShapeFromSettings,
} from '@/utils/shapePresets';
import type { ShapeSettings } from '@/types';

const settings: ShapeSettings = {
  fill: '#ffffff',
  stroke: '#000000',
  strokeWidth: 4,
  opacity: 1,
  cornerRadius: 0,
  fillStyle: { type: 'solid', color: '#ffffff' },
  strokeStyle: { type: 'solid', color: '#000000' },
  glow: { enabled: false, color: '#00e5ff', blur: 24, opacity: 0.8, intensity: 1 },
  lineStyle: 'solid',
  curve: 0.35,
};

describe('shape presets', () => {
  it('exposes five base shapes and seven pointers', () => {
    expect(BASIC_SHAPE_PRESETS).toHaveLength(5);
    expect(POINTER_PRESETS).toHaveLength(7);
    expect(POINTER_PRESETS.map(item => item.kind)).toEqual([
      'arrow', 'double-arrow', 'curved-arrow', 'elbow-arrow',
      'block-arrow', 'chevron', 'pointer',
    ]);
  });

  it('creates line pointers with transparent fill and usable height', () => {
    const arrow = createShapeFromSettings('curved-arrow', settings);
    expect(arrow.fill).toBe('');
    expect(arrow.height).toBeGreaterThan(0.01);
    expect(arrow.strokeStyle).not.toBe(settings.strokeStyle);
  });

  it('creates closed pointers with the configured fill', () => {
    const pointer = createShapeFromSettings('block-arrow', settings);
    expect(pointer.fill).toBe('#ffffff');
    expect(pointer.fillStyle).toEqual(settings.fillStyle);
    expect(pointer.fillStyle).not.toBe(settings.fillStyle);
  });

  it('keeps closed outlines off by default while open paths remain visible', () => {
    const noOutline = { ...settings, strokeWidth: 0 };
    expect(createShapeFromSettings('rect', noOutline).strokeWidth).toBe(0);
    expect(createShapeFromSettings('line', noOutline).strokeWidth).toBe(4);
  });
});
