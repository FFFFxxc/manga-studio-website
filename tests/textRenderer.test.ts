import { describe, expect, it, vi } from 'vitest';
import type { TextObject } from '@/types';
import { sanitizeText } from '@/utils/coordinates';
import { createTextNodeConfig, renderTextObjectToContext } from '@/utils/textRenderer';

const konvaText = vi.hoisted(() => ({
  destroy: vi.fn(),
  toCanvas: vi.fn(() => 'text-canvas' as unknown as HTMLCanvasElement),
  getClientRect: vi.fn(() => ({ x: 20.4, y: 30.2, width: 240.2, height: 150.6 })),
}));

vi.mock('konva', () => ({
  default: {
    Text: class {
      destroy = konvaText.destroy;
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
    const rect = vi.fn();
    const clip = vi.fn();
    const drawImage = vi.fn();
    const restore = vi.fn();
    const context = { save, beginPath, rect, clip, drawImage, restore } as unknown as CanvasRenderingContext2D;

    renderTextObjectToContext(context, { ...text, textMode: 'paragraph', height: 0.12 }, 2000, 1000);

    expect(rect).toHaveBeenCalledWith(500, 300, 480, 108);
    expect(clip).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith('text-canvas', 20, 30);
    expect(restore).toHaveBeenCalledTimes(1);
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
});
