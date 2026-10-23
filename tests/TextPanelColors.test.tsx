import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TextPanel } from '@/components/editor/panels/TextPanel';
import { createBaseLayerState } from '@/types';
import type { ImageDocument, TextObject } from '@/types';
import { useStore } from '@/store/useStore';

const text: TextObject = {
  id: 'text', text: 'hello', fontFamily: 'Arial', fontSize: 0.05,
  fill: '#000000', stroke: '', strokeWidth: 0, shadowColor: 'transparent', shadowBlur: 0,
  lineHeight: 1.2, align: 'center', width: 0.3, x: 0.2, y: 0.2,
  scaleX: 1, scaleY: 1, rotation: 0, visible: true,
};

function makeDocument(): ImageDocument {
  return {
    id: 'doc', file: new File(['x'], 'page.png', { type: 'image/png' }), originalSrc: 'blob:page',
    thumbnail: '', width: 1000, height: 800, name: 'page.png', cleanup: { committed: null, strokes: [] },
    baseLayer: createBaseLayerState('doc'), masks: [], aiLayers: [], activeMaskId: null, selectedLayer: null,
    watermarks: [], texts: [text], shapes: [], bubbles: [], past: [], future: [], hasChanges: false,
  };
}

describe('TextPanel color commit', () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      documents: [makeDocument()], activeDocIndex: 0,
      selectedObject: { id: 'text', type: 'text' },
      recentColors: [],
      textSettings: { ...useStore.getState().textSettings, fill: '#000000' },
    });
  });

  it('applies solid text paint with one history entry for the whole picker gesture', async () => {
    render(<TextPanel />);
    const input = screen.getByLabelText('Цвет текста');

    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '#ff0000' } });
    fireEvent.change(input, { target: { value: '#00ff00' } });
    await waitFor(() => expect(useStore.getState().documents[0].texts[0].fill).toBe('#00ff00'));
    expect(useStore.getState().documents[0].texts[0].fillStyle).toEqual({ type: 'solid', color: '#00ff00' });
    expect(useStore.getState().textSettings.fill).toBe('#00ff00');
    expect(useStore.getState().recentColors[0]).toBe('#00ff00');
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('offers a gradient fill for selected text without enabling its outline', () => {
    render(<TextPanel />);

    // Gradients are available for the fill only; the outline is a single color.
    expect(screen.getAllByRole('button', { name: 'Линейный' })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Линейный' })[0]);

    const updated = useStore.getState().documents[0].texts[0];
    expect(updated.fillStyle?.type).toBe('linear');
    expect(updated.strokeWidth).toBe(0);
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('changes the outline to a solid color and supports undo', () => {
    render(<TextPanel />);
    fireEvent.change(screen.getByLabelText('Цвет обводки'), { target: { value: '#ff0000' } });
    expect(useStore.getState().documents[0].texts[0].strokeStyle).toEqual({ type: 'solid', color: '#ff0000' });
    expect(useStore.getState().documents[0].texts[0].stroke).toBe('#ff0000');
    act(() => useStore.getState().undo());
    expect(useStore.getState().documents[0].texts[0].stroke).toBe('');
  });
});
