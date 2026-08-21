import { beforeEach, describe, expect, it } from 'vitest';
import { createBaseLayerState } from '@/types';
import type { ImageDocument, ShapeObject, TextObject, WatermarkObject } from '@/types';
import { useStore } from '@/store/useStore';
import { canTransformRasterLayer } from '@/utils/layerGuards';

const validQuad = {
  topLeft: { x: 0.1, y: 0.1 },
  topRight: { x: 0.9, y: 0.1 },
  bottomRight: { x: 0.9, y: 0.9 },
  bottomLeft: { x: 0.1, y: 0.9 },
};

const concaveQuad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 0.2, y: 0.2 },
  bottomLeft: { x: 0, y: 1 },
};

const text: TextObject = {
  id: 'text', text: 'locked', fontFamily: 'Arial', fontSize: 0.05,
  fill: '#000', stroke: '', strokeWidth: 0, shadowColor: 'transparent', shadowBlur: 0,
  lineHeight: 1.2, align: 'left', width: 0.3, x: 0.1, y: 0.2,
  scaleX: 1, scaleY: 1, rotation: 0, visible: true, locked: true,
};
const shape: ShapeObject = {
  id: 'shape', kind: 'rect', x: 0.2, y: 0.3, width: 0.2, height: 0.1,
  fill: '#fff', stroke: '#000', strokeWidth: 2, opacity: 1, rotation: 0,
  scaleX: 1, scaleY: 1, cornerRadius: 0, visible: true, locked: true,
};
const watermark: WatermarkObject = {
  id: 'wm', type: 'text', text: 'wm', x: 0.3, y: 0.4, scaleX: 1, scaleY: 1,
  rotation: 0, opacity: 1, visible: true, isBatch: false, locked: true,
};

function makeDocument(): ImageDocument {
  return {
    id: 'doc', file: new File(['x'], 'page.png', { type: 'image/png' }),
    originalSrc: 'blob:page', thumbnail: '', width: 1000, height: 800, name: 'page.png',
    cleanup: { committed: null, strokes: [], locked: true },
    baseLayer: { ...createBaseLayerState('doc'), x: 0.05, opacity: 1, locked: true, perspective: null },
    masks: [{ id: 'mask', name: 'Mask', strokes: [], elements: [], visible: true, opacity: 0.55, locked: true }],
    aiLayers: [{
      id: 'ai', name: 'AI', src: 'data:image/png;base64,x', visible: true, opacity: 1,
      operation: 'drawing', locked: true, x: 0.1, y: 0.1, scaleX: 1, scaleY: 1, rotation: 0, perspective: null,
    }],
    activeMaskId: 'mask', selectedLayer: null,
    watermarks: [watermark], texts: [text], shapes: [shape], bubbles: [],
    past: [], future: [], hasChanges: false,
  };
}

describe('store layer locking', () => {
  beforeEach(() => {
    useStore.setState({ documents: [makeDocument()], activeDocIndex: 0, selectedObject: null });
  });

  it('blocks geometry but keeps non-geometric updates for every transformable layer', () => {
    const store = useStore.getState();
    store.updateText('text', { x: 0.9, fill: '#f00' });
    store.updateShape('shape', { width: 0.8, opacity: 0.5 });
    store.updateWatermark('wm', { rotation: 90, visible: false });
    store.updateAiLayer('ai', { x: 0.8, opacity: 0.4 });
    store.updateBaseLayer({ x: 0.7, opacity: 0.3 });

    const doc = useStore.getState().documents[0];
    expect(doc.texts[0]).toMatchObject({ x: 0.1, fill: '#f00' });
    expect(doc.shapes[0]).toMatchObject({ width: 0.2, opacity: 0.5 });
    expect(doc.watermarks[0]).toMatchObject({ rotation: 0, visible: false });
    expect(doc.aiLayers[0]).toMatchObject({ x: 0.1, opacity: 0.4 });
    expect(doc.baseLayer).toMatchObject({ x: 0.05, opacity: 0.3 });
  });

  // Mutation caught: omitting perspectiveSourceBounds from the central
  // geometry-key set lets generic update actions reshape locked raster data.
  it('blocks perspective source-bound metadata updates on locked raster layers', () => {
    const current = makeDocument();
    const originalBounds = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
    current.baseLayer = { ...current.baseLayer, perspectiveSourceBounds: originalBounds };
    current.aiLayers[0] = { ...current.aiLayers[0], perspectiveSourceBounds: { ...originalBounds } };
    useStore.setState({ documents: [current], activeDocIndex: 0 });

    useStore.getState().updateBaseLayer({
      perspectiveSourceBounds: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 },
    });
    useStore.getState().updateAiLayer('ai', {
      perspectiveSourceBounds: { x: 0.3, y: 0.1, width: 0.4, height: 0.7 },
    });

    const unchanged = useStore.getState().documents[0];
    expect(unchanged.baseLayer.perspectiveSourceBounds).toEqual(originalBounds);
    expect(unchanged.aiLayers[0].perspectiveSourceBounds).toEqual(originalBounds);
    expect(unchanged.past).toHaveLength(0);
    expect(unchanged.hasChanges).toBe(false);
  });

  it('does not add strokes or mask elements to locked paint layers', () => {
    const store = useStore.getState();
    const stroke = { id: 'stroke', points: [0.1, 0.1], size: 0.02, color: '#fff', opacity: 1 };
    store.addStroke(stroke);
    store.addMaskElement({ id: 'element', type: 'polygon', points: [0, 0, 1, 0, 1, 1] });
    store.clearActiveMask();
    store.addEraseElement({ id: 'ai', type: 'ai' }, { id: 'erase-ai', type: 'polygon', points: [0, 0, 1, 0, 1, 1] });
    store.addEraseElement({ type: 'base' }, { id: 'erase-base', type: 'polygon', points: [0, 0, 1, 0, 1, 1] });

    const doc = useStore.getState().documents[0];
    expect(doc.cleanup.strokes).toEqual([]);
    expect(doc.masks[0].elements).toEqual([]);
    expect(doc.aiLayers[0].eraseElements ?? []).toEqual([]);
    expect(doc.baseLayer.eraseElements).toEqual([]);
  });

  it('does not let crop, reset, or erase restoration bypass a raster lock', () => {
    const current = makeDocument();
    current.baseLayer = {
      ...current.baseLayer,
      x: 0.2,
      crop: null,
      locked: true,
      eraseElements: [{ id: 'erase-base', type: 'polygon', points: [0, 0, 1, 0, 1, 1] }],
    };
    current.aiLayers[0] = {
      ...current.aiLayers[0],
      eraseElements: [{ id: 'erase-ai', type: 'polygon', points: [0, 0, 1, 0, 1, 1] }],
    };
    useStore.setState({ documents: [current], activeDocIndex: 0 });
    const store = useStore.getState();
    store.setLayerCropTarget({ id: current.baseLayer.id, type: 'base' });
    store.setCropRect({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 });
    store.applyLayerCrop();
    store.resetBaseLayerSettings();
    store.clearEraseElements({ type: 'base' });
    store.clearEraseElements({ id: 'ai', type: 'ai' });

    const unchanged = useStore.getState().documents[0];
    expect(unchanged.baseLayer).toMatchObject({ locked: true, crop: null, x: 0.2 });
    expect(unchanged.baseLayer.eraseElements).toHaveLength(1);
    expect(unchanged.aiLayers[0].eraseElements).toHaveLength(1);
    expect(unchanged.past).toHaveLength(0);
  });

  // Mutation caught: removing the direct perspective-action lock check would
  // mutate either raster layer and create an undo snapshot.
  it('does not update perspective on locked base or AI layers', () => {
    useStore.getState().updateBasePerspective(validQuad);
    let unchanged = useStore.getState().documents[0];
    expect(unchanged.baseLayer.perspective).toBeNull();
    expect(unchanged.past).toHaveLength(0);

    const lockedAiDocument = makeDocument();
    lockedAiDocument.aiLayers[0] = { ...lockedAiDocument.aiLayers[0], id: 'ai-locked' };
    useStore.setState({ documents: [lockedAiDocument], activeDocIndex: 0 });
    useStore.getState().updateAiLayerPerspective('ai-locked', validQuad);
    unchanged = useStore.getState().documents[0];
    expect(unchanged.aiLayers[0].perspective).toBeNull();
    expect(unchanged.past).toHaveLength(0);
  });

  // Mutation caught: relying on UI validation lets direct store callers write
  // a concave quad and manufacture a history entry.
  it('rejects concave perspective updates before mutating base or AI layers', () => {
    const baseDocument = makeDocument();
    baseDocument.baseLayer = { ...baseDocument.baseLayer, locked: false };
    useStore.setState({ documents: [baseDocument], activeDocIndex: 0 });

    useStore.getState().updateBasePerspective(concaveQuad);

    let unchanged = useStore.getState().documents[0];
    expect(unchanged.baseLayer.perspective).toBeNull();
    expect(unchanged.past).toHaveLength(0);
    expect(unchanged.hasChanges).toBe(false);

    const aiDocument = makeDocument();
    aiDocument.aiLayers[0] = { ...aiDocument.aiLayers[0], locked: false };
    useStore.setState({ documents: [aiDocument], activeDocIndex: 0 });

    useStore.getState().updateAiLayerPerspective('ai', concaveQuad);

    unchanged = useStore.getState().documents[0];
    expect(unchanged.aiLayers[0].perspective).toBeNull();
    expect(unchanged.past).toHaveLength(0);
    expect(unchanged.hasChanges).toBe(false);
  });

  // Mutations caught: accepting a mismatched/missing layer reference, treating
  // either locked raster type as transformable, or rejecting a legacy unlocked
  // AI layer whose optional lock field is absent.
  it('resolves transform permission from the selected raster target and lock state', () => {
    const document = makeDocument();
    document.baseLayer = { ...document.baseLayer, locked: false };
    document.aiLayers = [
      { ...document.aiLayers[0], id: 'ai-unlocked', locked: undefined },
      { ...document.aiLayers[0], id: 'ai-locked', locked: true },
    ];

    expect(canTransformRasterLayer(document, { id: document.baseLayer.id, type: 'base' })).toBe(true);
    expect(canTransformRasterLayer(document, { id: 'missing-base', type: 'base' })).toBe(false);
    expect(canTransformRasterLayer(document, { id: 'ai-unlocked', type: 'ai' })).toBe(true);
    expect(canTransformRasterLayer(document, { id: 'ai-locked', type: 'ai' })).toBe(false);
    expect(canTransformRasterLayer(document, { id: 'missing-ai', type: 'ai' })).toBe(false);
    expect(canTransformRasterLayer(document, { id: 'mask', type: 'mask' })).toBe(false);
    expect(canTransformRasterLayer(document, null)).toBe(false);
  });

  // Mutation caught: manufacturing a missing AI target or history entry when
  // the direct perspective action receives a stale layer id.
  it('does not create a layer or history for a missing perspective target', () => {
    const before = useStore.getState().documents[0];

    useStore.getState().updateAiLayerPerspective('missing-ai', validQuad);

    const after = useStore.getState().documents[0];
    expect(after.aiLayers).toEqual(before.aiLayers);
    expect(after.past).toHaveLength(0);
    expect(after.hasChanges).toBe(false);
  });

  // Mutation caught: copying only the quad drops the source rectangle that
  // defines which original pixels are mapped into that quad.
  it('duplicates base perspective source bounds as independent layer metadata', () => {
    const current = makeDocument();
    const sourceBounds = { x: 0.12, y: 0.18, width: 0.64, height: 0.58 };
    current.baseLayer = {
      ...current.baseLayer,
      perspective: validQuad,
      perspectiveSourceBounds: sourceBounds,
    };
    useStore.setState({ documents: [current], activeDocIndex: 0 });

    const copyId = useStore.getState().duplicateBaseLayer();

    const copy = useStore.getState().documents[0].aiLayers.find(layer => layer.id === copyId);
    expect(copy?.perspective).toEqual(validQuad);
    expect(copy?.perspectiveSourceBounds).toEqual(sourceBounds);
    expect(copy?.perspectiveSourceBounds).not.toBe(sourceBounds);
  });
});
