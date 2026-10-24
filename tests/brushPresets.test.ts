import { describe, expect, it } from 'vitest';
import { BRUSH_PRESETS, presetAlpha } from '@/utils/brushPresets';
import { sanitizeStroke } from '@/utils/coordinates';

describe('textured brush tips', () => {
  it('keeps a transparent border and produces distinct, repeatable alpha textures', () => {
    const signatures = new Set<string>();
    for (const preset of BRUSH_PRESETS.filter(item => item.id !== 'round')) {
      const samples: number[] = [];
      for (let y = -1; y <= 1; y += 0.05) for (let x = -1; x <= 1; x += 0.05) {
        const alpha = presetAlpha(preset.id, x, y, 0.6);
        expect(alpha).toBeGreaterThanOrEqual(0); expect(alpha).toBeLessThanOrEqual(1);
        samples.push(Math.round(alpha * 255));
      }
      expect(samples.some(value => value > 0)).toBe(true);
      expect(presetAlpha(preset.id, 1, 0, 0.6)).toBe(0);
      expect(presetAlpha(preset.id, 0.1, 0.2, 0.6)).toBe(presetAlpha(preset.id, 0.1, 0.2, 0.6));
      signatures.add(samples.join(','));
    }
    expect(signatures.size).toBe(6);
  });
  it('preserves the chosen tip when a document stroke is sanitized', () => {
    expect(sanitizeStroke({ id: 'cloud', points: [0.5, 0.5], size: 0.1, opacity: 1, color: '#fff', brushPreset: 'cloud' })?.brushPreset).toBe('cloud');
  });
});
