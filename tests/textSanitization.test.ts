import { beforeEach, describe, expect, it } from 'vitest';
import type { TextObject } from '@/types';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { useStore } from '@/store/useStore';
import { sanitizeText } from '@/utils/coordinates';

const paragraph: TextObject = {
  id: 'edge-paragraph',
  text: 'Original',
  fontFamily: 'Arial',
  fontSize: 0.01,
  fill: '#000000',
  stroke: '',
  strokeWidth: 0,
  shadowColor: 'transparent',
  shadowBlur: 0,
  lineHeight: 1.2,
  align: 'left',
  textMode: 'paragraph',
  x: 1 - 24 / 4000,
  y: 1 - 24 / 12000,
  width: 24 / 4000,
  height: 24 / 12000,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  visible: true,
};

describe('paragraph text sanitization', () => {
  beforeEach(() => {
    useStore.setState({
      documents: [makeEditorDocument({
        width: 4000,
        height: 12000,
        texts: [paragraph],
        layerOrder: [{ type: 'text', id: paragraph.id }],
      })],
      activeDocIndex: 0,
      selectedObject: { type: 'text', id: paragraph.id },
    });
  });

  // Mutation caught: applying legacy 0.01/0.003 minima during a content-only
  // store update expands a valid 24px paragraph beyond the document edge.
  it('preserves high-resolution paragraph geometry during content-only updates', () => {
    useStore.getState().updateText(paragraph.id, { text: 'Updated', fill: '#ff0000' });

    const updated = useStore.getState().documents[0].texts[0];
    expect(updated).toMatchObject({
      text: 'Updated',
      fill: '#ff0000',
      x: 1 - 24 / 4000,
      y: 1 - 24 / 12000,
      width: 24 / 4000,
      height: 24 / 12000,
    });
    expect(updated.x + updated.width).toBeLessThanOrEqual(1);
    expect(updated.y + (updated.height ?? 0)).toBeLessThanOrEqual(1);
  });

  it('clamps paragraph dimensions to the remaining document bounds', () => {
    const sanitized = sanitizeText({ ...paragraph, x: 0.997, y: 0.999, width: 0.006, height: 0.002 });
    expect(sanitized).toMatchObject({ x: 0.997, y: 0.999 });
    expect(sanitized?.width).toBeCloseTo(0.003, 12);
    expect(sanitized?.height).toBeCloseTo(0.001, 12);
  });

  it('retains legacy and point minimum-width compatibility', () => {
    expect(sanitizeText({ ...paragraph, textMode: undefined, width: 0.006 })?.width).toBe(0.01);
    expect(sanitizeText({ ...paragraph, textMode: 'point', width: 0.006 })?.width).toBe(0.01);
  });
});
