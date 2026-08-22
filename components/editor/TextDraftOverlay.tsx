'use client';

import type { ViewportState } from '@/types';
import type { TextDraftRect } from '@/utils/textBox';

interface Props {
  rect: TextDraftRect;
  docWidth: number;
  docHeight: number;
  viewport: ViewportState;
}

export function TextDraftOverlay({ rect, docWidth, docHeight, viewport }: Props) {
  const left = viewport.x + rect.x * docWidth * viewport.scale;
  const top = viewport.y + rect.y * docHeight * viewport.scale;
  const width = rect.width * docWidth * viewport.scale;
  const height = (rect.height ?? 0) * docHeight * viewport.scale;

  return (
    <div
      data-testid="text-draft-overlay"
      data-text-mode={rect.mode}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left,
        top,
        width: Math.max(1, width),
        height: Math.max(1, height),
        border: '1px dashed var(--accent)',
        background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 45,
      }}
    />
  );
}
