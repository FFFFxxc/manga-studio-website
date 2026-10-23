import { beforeAll, describe, expect, it } from 'vitest';
import { drawBubbleToContext, drawShapeToContext } from '@/utils/drawVectorObject';
import { createDefaultBubble } from '@/components/editor/panels/BubblePanel';
import { createShapeFromSettings } from '@/utils/shapePresets';
import type { ShapeSettings } from '@/types';
import { getEditableShapePaths, moveShapePoint } from '@/utils/shapePoints';

class FakePath2D {
  constructor(public data?: string) {}
}

function recordingContext() {
  const calls: string[] = [];
  const gradient = { addColorStop: (offset: number, color: string) => calls.push(`stop:${offset}:${color}`) };
  const context = {
    calls,
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    scale: () => calls.push('scale'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillText: () => calls.push('fillText'),
    setLineDash: (dash: number[]) => calls.push(`dash:${dash.join(',')}`),
    createLinearGradient: () => { calls.push('linear'); return gradient; },
    createRadialGradient: () => { calls.push('radial'); return gradient; },
  };
  return context;
}

const settings: ShapeSettings = {
  fill: '#fff',
  stroke: '#000',
  strokeWidth: 4,
  opacity: 1,
  cornerRadius: 4,
  fillStyle: {
    type: 'linear',
    angle: 45,
    stops: [
      { id: 'a', offset: 0, color: '#f00' },
      { id: 'b', offset: 1, color: '#00f' },
    ],
  },
  strokeStyle: { type: 'solid', color: '#000' },
  glow: { enabled: true, color: '#0ff', blur: 20, opacity: 0.8, intensity: 2 },
  lineStyle: 'dashed',
  curve: 0.35,
};

beforeAll(() => {
  Object.defineProperty(globalThis, 'Path2D', { value: FakePath2D, configurable: true });
});

describe('vector export renderer', () => {
  it('exports the edited contour instead of the original shape preset', () => {
    const shape = createShapeFromSettings('rect', { ...settings, cornerRadius: 0, glow: { ...settings.glow, enabled: false } });
    shape.paths = moveShapePoint(getEditableShapePaths(shape, 1000, 800), { x: -0.5, y: -0.5 }, { x: -0.3, y: -0.1 });
    const ctx = recordingContext();
    const exportedPaths: string[] = [];
    ctx.fill = (path?: FakePath2D) => exportedPaths.push(path?.data ?? '');
    drawShapeToContext(ctx as unknown as CanvasRenderingContext2D, shape, 1000, 800);
    expect(exportedPaths[0]).toContain('M -75 -16');
  });
  it('uses gradients, glow passes, and dash styles for shapes', () => {
    const ctx = recordingContext();
    drawShapeToContext(ctx as unknown as CanvasRenderingContext2D, createShapeFromSettings('block-arrow', settings), 1000, 800);
    expect(ctx.calls).toContain('linear');
    expect(ctx.calls).toContain('dash:12,8');
    expect(ctx.calls.filter(call => call === 'fill').length).toBeGreaterThan(1);
  });

  it('draws a closed shape stroke only once when glow is disabled', () => {
    const ctx = recordingContext();
    drawShapeToContext(ctx as unknown as CanvasRenderingContext2D, createShapeFromSettings('rect', {
      ...settings,
      fillStyle: { type: 'solid', color: '#ffffff' },
      glow: { ...settings.glow, enabled: false },
      lineStyle: 'solid',
    }), 1000, 800);
    expect(ctx.calls.filter(call => call === 'stroke')).toHaveLength(1);
  });

  it('draws every decorative bubble kind without invalid state', () => {
    for (const kind of ['soft', 'cloud', 'comic', 'electric', 'caption'] as const) {
      const ctx = recordingContext();
      const bubble = createDefaultBubble(kind);
      bubble.fillStyle = settings.fillStyle;
      bubble.glow = settings.glow;
      drawBubbleToContext(ctx as unknown as CanvasRenderingContext2D, bubble, 1000, 800);
      expect(ctx.calls).toContain('fill');
      expect(ctx.calls.at(-1)).toBe('restore');
    }
  });
});
