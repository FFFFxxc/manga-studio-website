import { describe, expect, it, vi } from 'vitest';
import type { TextObject } from '@/types';
import { sanitizeText } from '@/utils/coordinates';
import { createTextNodeConfig, renderTextObjectToContext } from '@/utils/textRenderer';

const konvaText = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  destroy: vi.fn(),
  toCanvas: vi.fn(() => 'text-canvas' as unknown as HTMLCanvasElement),
  getClientRect: vi.fn(() => ({ x: 20.4, y: 30.2, width: 240.2, height: 150.6 })),
}));

vi.mock('konva', () => ({
  default: {
    Text: class {
      constructor(config: Record<string, unknown>) {
        konvaText.config = config;
      }
      destroy = konvaText.destroy;
      height = vi.fn(() => 125);
      getClientRect = konvaText.getClientRect;
      toCanvas = konvaText.toCanvas;
    },
  },
}));

const text: TextObject = {
  id: 'text-1',
  text: 'Очень длинная строка текста для переноса по словам',
  fontFamily: 'Arial',
  fontSize: 0.1,
  fill: '#123456',
  stroke: '#ffffff',
  strokeWidth: 6,
  shadowColor: '#000000',
  shadowBlur: 8,
  lineHeight: 1.25,
  align: 'center',
  width: 0.2,
  x: 0.25,
  y: 0.3,
  scaleX: 1.2,
  scaleY: 0.9,
  rotation: 12,
  visible: true,
};

describe('shared text renderer', () => {
  it('maps normalized document units and pixel effects to a preview scale', () => {
    expect(createTextNodeConfig(text, 2000, 1000, 0.5)).toMatchObject({
      x: 250,
      y: 150,
      width: 200,
      fontSize: 50,
      strokeWidth: 3,
      shadowBlur: 4,
      align: 'center',
      lineHeight: 1.25,
      scaleX: 1.2,
      scaleY: 0.9,
      rotation: 12,
    });
  });

  it('asks the shared Konva renderer for word wrapping and top alignment', () => {
    expect(createTextNodeConfig(text, 2000, 1000, 1)).toMatchObject({
      width: 400,
      wrap: 'word',
      verticalAlign: 'top',
      align: 'center',
    });
  });

  it('maps a text gradient into Konva so preview and export share the same paint', () => {
    const config = createTextNodeConfig({
      ...text,
      fillStyle: {
        type: 'linear',
        angle: 0,
        stops: [
          { id: 'left', offset: 0, color: '#ff0000' },
          { id: 'right', offset: 1, color: '#0000ff' },
        ],
      },
    }, 2000, 1000, 1);

    expect(config).toMatchObject({
      fill: undefined,
      fillPriority: 'linear-gradient',
      fillLinearGradientStartPoint: { x: 0, y: 62.5 },
      fillLinearGradientEndPoint: { x: 400, y: 62.5 },
      fillLinearGradientColorStops: [0, '#ff0000', 1, '#0000ff'],
    });
  });

  it('keeps the text outline disabled until its width is explicitly increased', () => {
    expect(createTextNodeConfig({
      ...text,
      stroke: '#ff00ff',
      strokeStyle: { type: 'solid', color: '#ff00ff' },
      strokeWidth: 0,
    }, 2000, 1000)).toMatchObject({ stroke: undefined, strokeWidth: 0 });
  });

  it('uses the preview wrapping config unchanged for export', () => {
    const paragraph = { ...text, textMode: 'paragraph' as const, height: 0.15 };
    const previewConfig = createTextNodeConfig(paragraph, 2000, 1000, 1);
    const context = {
      save: vi.fn(), beginPath: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      rect: vi.fn(), clip: vi.fn(), drawImage: vi.fn(), restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    renderTextObjectToContext(context, paragraph, 2000, 1000);

    expect(konvaText.config).toMatchObject({
      text: previewConfig.text,
      width: previewConfig.width,
      height: previewConfig.height,
      fontFamily: previewConfig.fontFamily,
      fontSize: previewConfig.fontSize,
      lineHeight: previewConfig.lineHeight,
      align: previewConfig.align,
      wrap: 'word',
      verticalAlign: 'top',
    });
  });

  it('passes explicit paragraph height to the shared Konva config', () => {
    expect(createTextNodeConfig({ ...text, textMode: 'paragraph', height: 0.15 }, 2000, 1000, 1)).toMatchObject({
      width: 400,
      height: 150,
    });
  });

  it('leaves legacy point text heightless so export size follows wrapped content', () => {
    expect(createTextNodeConfig(text, 2000, 1000, 1)).not.toHaveProperty('height');
  });

  it('clips export drawing only for paragraph text with an explicit height', () => {
    const save = vi.fn();
    const beginPath = vi.fn();
    const translate = vi.fn();
    const rotate = vi.fn();
    const scale = vi.fn();
    const rect = vi.fn();
    const clip = vi.fn();
    const drawImage = vi.fn();
    const restore = vi.fn();
    const context = { save, beginPath, translate, rotate, scale, rect, clip, drawImage, restore } as unknown as CanvasRenderingContext2D;

    renderTextObjectToContext(context, { ...text, textMode: 'paragraph', height: 0.12 }, 2000, 1000);

    expect(translate).toHaveBeenCalledWith(500, 300);
    expect(rotate).toHaveBeenCalledWith(12 * Math.PI / 180);
    expect(scale).toHaveBeenCalledWith(1.2, 0.9);
    expect(rect).toHaveBeenCalledWith(0, 0, 400, 120);
    expect(clip).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith('text-canvas', 20, 30);
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('rotates the paragraph export clip with the text box transform', () => {
    const calls: Array<[string, ...number[]]> = [];
    const record = (name: string, ...values: number[]): [string, ...number[]] => [
      name,
      ...values.map(value => Number(value.toFixed(6))),
    ];
    const context = {
      save: vi.fn(),
      beginPath: vi.fn(() => calls.push(['beginPath'])),
      translate: vi.fn((x: number, y: number) => calls.push(record('translate', x, y))),
      rotate: vi.fn((angle: number) => calls.push(record('rotate', angle))),
      scale: vi.fn((x: number, y: number) => calls.push(record('scale', x, y))),
      rect: vi.fn((x: number, y: number, width: number, height: number) => calls.push(record('rect', x, y, width, height))),
      clip: vi.fn(() => calls.push(['clip'])),
      drawImage: vi.fn(),
      restore: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    renderTextObjectToContext(context, {
      ...text,
      text: 'Asymmetric rotated paragraph clipping sample',
      textMode: 'paragraph',
      x: 0.11,
      y: 0.23,
      width: 0.17,
      height: 0.09,
      scaleX: 1.4,
      scaleY: 0.6,
      rotation: 37,
    }, 1234, 789);

    expect(calls).toEqual([
      ['beginPath'],
      ['translate', 135.74, 181.47],
      ['rotate', 0.645772],
      ['scale', 1.4, 0.6],
      ['rect', 0, 0, 209.78, 71.01],
      ['clip'],
    ]);
  });

  it('does not clip legacy export drawing', () => {
    const clip = vi.fn();
    const drawImage = vi.fn();
    const context = { clip, drawImage } as unknown as CanvasRenderingContext2D;

    renderTextObjectToContext(context, text, 2000, 1000);

    expect(clip).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith('text-canvas', 20, 30);
  });

  it('sanitizes paragraph height without discarding legacy text', () => {
    expect(sanitizeText({ ...text, height: 0.2 })).toMatchObject({ width: 0.2, height: 0.2 });
    expect(sanitizeText({ ...text, height: -0.2 })).toMatchObject({ width: 0.2 });
    expect(sanitizeText({ ...text, height: -0.2 })).not.toHaveProperty('height');
  });

  it('rejects non-finite required geometry and drops invalid optional paragraph metadata', () => {
    expect(sanitizeText({ ...text, x: Number.NaN })).toBeNull();
    expect(sanitizeText({ ...text, width: Number.POSITIVE_INFINITY })).toBeNull();
    expect(sanitizeText({ ...text, fontSize: Number.NEGATIVE_INFINITY })).toBeNull();
    expect(sanitizeText({ ...text, textMode: 'invalid' as never, height: Number.NaN })).not.toHaveProperty('textMode');
    expect(sanitizeText({ ...text, textMode: 'invalid' as never, height: Number.POSITIVE_INFINITY })).not.toHaveProperty('height');
  });

  it('renders a legacy text object without paragraph metadata', () => {
    const context = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    expect(() => renderTextObjectToContext(context, text, 2000, 1000)).not.toThrow();
  });
});
