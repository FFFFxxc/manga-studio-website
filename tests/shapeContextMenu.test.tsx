import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShapeContextMenu, replaceShapeWithRaster } from '@/components/editor/ShapeContextMenu';
import { useStore } from '@/store/useStore';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import { makeEditorDocument } from './helpers/makeEditorDocument';
import { createShapeFromSettings } from '@/utils/shapePresets';
import { resolveLayerOrder } from '@/utils/layerOrder';

describe('shape context menu', () => {
  beforeEach(() => {
    const shape = createShapeFromSettings('rect', useStore.getState().shapeSettings);
    shape.id = 'shape-menu';
    useStore.setState({
      documents: [makeEditorDocument({
        id: 'shape-menu-doc',
        shapes: [shape],
        layerOrder: [
          { type: 'base', id: 'base-shape-menu-doc' },
          { type: 'shape', id: shape.id },
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

  it('offers transform, perspective, opacity and raster effects for a vector shape', () => {
    render(<ShapeContextMenu menu={{ x: 10, y: 10, shapeId: 'shape-menu' }} onClose={() => {}} />);

    expect(screen.getByRole('menu', { name: 'Действия с фигурой' })).toBeTruthy();
    expect((screen.getByRole('menuitem', { name: 'Трансформировать' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Перспектива (в растр)' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Размыть фигуру (в растр)' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('menuitem', { name: 'Пикселизировать (в растр)' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByLabelText('Прозрачность фигуры')).toBeTruthy();
  });

  it('stores one history boundary while opacity is changed live', () => {
    render(<ShapeContextMenu menu={{ x: 10, y: 10, shapeId: 'shape-menu' }} onClose={() => {}} />);
    const opacity = screen.getByLabelText('Прозрачность фигуры');

    fireEvent.pointerDown(opacity);
    fireEvent.change(opacity, { target: { value: '35' } });

    const document = useStore.getState().documents[0];
    expect(document.past).toHaveLength(1);
    expect(document.shapes[0].opacity).toBe(0.35);
  });

  it('replaces a vector with one raster at the same z-order and undo restores it', async () => {
    const state = useStore.getState();
    const document = state.documents[0];
    const shape = document.shapes[0];
    const source = { toDataURL: () => 'data:image/png;base64,shape' } as HTMLCanvasElement;

    const layerId = await replaceShapeWithRaster(document, shape, source);
    const converted = useStore.getState().documents[0];
    expect(converted.shapes).toEqual([]);
    expect(converted.aiLayers).toHaveLength(1);
    expect(converted.aiLayers[0].id).toBe(layerId);
    expect(resolveLayerOrder(converted)).toEqual([
      { type: 'base', id: 'base-shape-menu-doc' },
      { type: 'ai', id: layerId },
    ]);
    expect(converted.past).toHaveLength(1);

    useStore.getState().undo();
    const restored = useStore.getState().documents[0];
    expect(restored.shapes.map(item => item.id)).toEqual(['shape-menu']);
    expect(restored.aiLayers).toEqual([]);
  });
});
