import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { createPastedImageLayer } from '@/utils/pastedImageLayers';
import { resolveLayerOrder } from '@/utils/layerOrder';

describe('image layer batch', () => {
  beforeEach(() => useStore.setState({ documents: [makeEditorDocument({ id: 'page' })], activeDocIndex: 0, selectedObject: null, activeTool: 'brush' }));

  it('inserts images in order, selects the top layer and undoes the batch in one step', () => {
    const state = useStore.getState();
    const doc = state.documents[0];
    const layers = ['a.png', 'b.png'].map(name => createPastedImageLayer(doc, { src: 'data:image/png;base64,x', width: 100, height: 100, name }));
    state.addAiLayers(doc.id, layers);
    let next = useStore.getState();
    expect(next.documents[0].aiLayers.map(layer => layer.name)).toEqual(['a.png', 'b.png']);
    expect(resolveLayerOrder(next.documents[0]).slice(-2)).toEqual(layers.map(layer => ({ id: layer.id, type: 'ai' })));
    expect(next.documents[0].selectedLayer).toEqual({ id: layers[1].id, type: 'ai' });
    expect(next.activeTool).toBe('select');
    expect(next.documents[0].past).toHaveLength(1);
    next.undo();
    expect(useStore.getState().documents[0].aiLayers).toHaveLength(0);
    useStore.getState().redo();
    expect(useStore.getState().documents[0].aiLayers).toHaveLength(2);
  });

  it('keeps the current page and tool when the target page is in the background', () => {
    const doc = useStore.getState().documents[0];
    const other = makeEditorDocument({ id: 'other' });
    useStore.setState({ documents: [doc, other], activeDocIndex: 1, activeTool: 'text' });
    const layer = createPastedImageLayer(doc, { src: 'data:image/png;base64,x', width: 100, height: 100 });
    useStore.getState().addAiLayers(doc.id, [layer]);
    expect(useStore.getState().activeDocIndex).toBe(1);
    expect(useStore.getState().activeTool).toBe('text');
    expect(useStore.getState().documents[0].aiLayers).toHaveLength(1);
    expect(useStore.getState().documents[1].aiLayers).toHaveLength(0);
  });
});
