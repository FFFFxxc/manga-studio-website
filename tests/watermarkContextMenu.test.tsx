import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WatermarkContextMenu, replaceWatermarkWithRaster } from '@/components/editor/WatermarkContextMenu';
import { useStore } from '@/store/useStore';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import type { WatermarkObject } from '@/types';
import { resolveLayerOrder } from '@/utils/layerOrder';
import { makeEditorDocument } from './helpers/makeEditorDocument';

const watermark: WatermarkObject = {
  id: 'watermark-menu',
  type: 'text',
  text: '© Manga Studio',
  fontFamily: 'Arial',
  fontSize: 0.06,
  fill: '#ffffff',
  x: 0.25,
  y: 0.3,
  scaleX: 1,
  scaleY: 1,
  rotation: 12,
  opacity: 0.8,
  visible: true,
  isBatch: false,
};

describe('watermark context menu', () => {
  beforeEach(() => {
    useStore.setState({
      documents: [makeEditorDocument({
        id: 'watermark-menu-doc',
        watermarks: [{ ...watermark }],
        layerOrder: [
          { type: 'base', id: 'base-watermark-menu-doc' },
          { type: 'watermark', id: watermark.id },
        ],
      })],
      activeDocIndex: 0,
      selectedObject: null,
      activeTool: 'select',
    });
  });

  afterEach(() => {
    cleanup();
    useEditorUiStore.getState().clearTransientUi();
  });

  it('offers transform, perspective, opacity and raster effects after insertion', () => {
    render(<WatermarkContextMenu menu={{ x: 10, y: 10, watermarkId: watermark.id }} onClose={() => {}} />);

    expect(screen.getByRole('menu', { name: 'Действия с вотеркой' })).toBeTruthy();
    expect((screen.getByRole('menuitem', { name: 'Трансформировать' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Перспектива (в растр)' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Размыть вотерку (в растр)' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Пикселизировать (в растр)' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByLabelText('Прозрачность вотерки')).toBeTruthy();
  });

  it('stores one history boundary while opacity is changed live', () => {
    render(<WatermarkContextMenu menu={{ x: 10, y: 10, watermarkId: watermark.id }} onClose={() => {}} />);
    const opacity = screen.getByLabelText('Прозрачность вотерки');

    fireEvent.pointerDown(opacity);
    fireEvent.change(opacity, { target: { value: '35' } });

    const document = useStore.getState().documents[0];
    expect(document.past).toHaveLength(1);
    expect(document.watermarks[0].opacity).toBe(0.35);
  });

  it('replaces a watermark at the same z-order and one undo restores the editable object', async () => {
    const state = useStore.getState();
    const document = state.documents[0];
    const source = { toDataURL: () => 'data:image/png;base64,watermark' } as HTMLCanvasElement;

    const layerId = await replaceWatermarkWithRaster(document, document.watermarks[0], source);
    const converted = useStore.getState().documents[0];
    expect(converted.watermarks).toEqual([]);
    expect(converted.aiLayers).toHaveLength(1);
    expect(converted.aiLayers[0].id).toBe(layerId);
    expect(resolveLayerOrder(converted)).toEqual([
      { type: 'base', id: 'base-watermark-menu-doc' },
      { type: 'ai', id: layerId },
    ]);
    expect(converted.past).toHaveLength(1);

    useStore.getState().undo();
    const restored = useStore.getState().documents[0];
    expect(restored.watermarks.map(item => item.id)).toEqual([watermark.id]);
    expect(restored.aiLayers).toEqual([]);
  });
});
