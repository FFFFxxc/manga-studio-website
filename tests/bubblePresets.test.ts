import { describe, expect, it } from 'vitest';
import { BUBBLE_PRESETS, createDefaultBubble } from '@/components/editor/panels/BubblePanel';
import type { BubbleKind } from '@/types';

describe('bubble presets', () => {
  it('exposes ten unique classic and decorative bubble kinds', () => {
    const kinds = BUBBLE_PRESETS.map(preset => preset.kind);
    expect(kinds).toHaveLength(10);
    expect(new Set(kinds).size).toBe(10);
    expect(kinds).toEqual(expect.arrayContaining([
      'speech', 'thought', 'scream', 'narration', 'whisper',
      'soft', 'cloud', 'comic', 'electric', 'caption',
    ] satisfies BubbleKind[]));
  });

  it('creates new bubbles with independent style objects', () => {
    const first = createDefaultBubble('soft');
    const second = createDefaultBubble('soft');
    expect(first.fillStyle).toEqual(second.fillStyle);
    expect(first.fillStyle).not.toBe(second.fillStyle);
    expect(first.glow?.enabled).toBe(false);
    expect(first.strokeWidth).toBe(0);
  });

  it('creates tails only for bubble kinds that render them', () => {
    expect(createDefaultBubble('scream').tail).not.toBeNull();
    expect(createDefaultBubble('caption').tail).toBeNull();
    expect(createDefaultBubble('narration').tail).toBeNull();
  });

  it('uses the current foreground color only for newly created bubble text', () => {
    expect(createDefaultBubble('speech', '#12ab34').text.fill).toBe('#12ab34');
    expect(createDefaultBubble('speech').text.fill).toBe('#000000');
  });
});
