import { createEraserSession } from '@/utils/eraserRaster';
import { buildBaseCanvas, buildRasterLayerCanvas } from '@/utils/cleanupRaster';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';

const W = 240, H = 180;
function alpha(canvas: HTMLCanvasElement, x: number, y: number) {
  return canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3];
}
function assert(condition: boolean, message: string) { if (!condition) throw Error(message); }

export async function runEraserBrowserSmoke() {
  const source = document.createElement('canvas'); source.width = W; source.height = H;
  const context = source.getContext('2d')!;
  context.fillStyle = '#4879ba'; context.fillRect(0, 0, W, H);
  const src = source.toDataURL();
  const results: string[] = [];
  let previewSrc = '';
  for (const target of ['base', 'ai'] as const) {
    for (const hardness of [1, 0.5]) for (const opacity of [1, 0.5]) {
      const doc = makeEditorDocument({ id: `eraser-${target}-${hardness}`, width: W, height: H, originalSrc: src });
      doc.baseLayer.locked = false;
      if (target === 'ai') doc.aiLayers = [{ id: 'overlay', name: 'PNG', src, operation: 'drawing', visible: true, opacity: 1, locked: false, eraseElements: [] }];
      doc.selectedLayer = target === 'base' ? { type: 'base', id: doc.baseLayer.id } : { type: 'ai', id: 'overlay' };
      useStore.setState({ documents: [doc], activeDocIndex: 0 });
      const session = await createEraserSession({ documentId: doc.id, layer: target === 'base' ? { type: 'base' } : { type: 'ai', id: 'overlay' }, settings: { size: 60 / H, hardness, opacity }, previewScale: 1 });
      session.append([0.3, 0.5]);
      const first = await session.renderPreview();
      assert(Boolean(first), 'No live preview');
      const live = first!.canvas as HTMLCanvasElement;
      assert(alpha(live, 5, 5) === 255, 'Live preview cleared pixels outside the round brush');
      const centerAlpha = Math.round(255 * (1 - opacity));
      assert(Math.abs(alpha(live, 72, 90) - centerAlpha) <= 1, 'Brush center did not respect opacity');
      assert(alpha(live, 98, 116) === 255, 'Circular brush erased its square corner');
      if (hardness < 1) assert(alpha(live, 97, 90) > 0 && alpha(live, 97, 90) < 255, 'Soft edge is missing');
      session.append([0.45, 0.5]); await session.renderPreview();
      session.append([0.65, 0.5]);
      const last = await session.renderPreview();
      assert(alpha(last!.canvas as HTMLCanvasElement, 5, 5) === 255, 'Later preview cleared untouched pixels');
      assert(Math.abs(alpha(last!.canvas as HTMLCanvasElement, 72, 90) - centerAlpha) <= 1, 'Later preview restored an earlier erased area');
      assert(Math.abs(alpha(last!.canvas as HTMLCanvasElement, 120, 90) - centerAlpha) <= 1, 'Fast stroke has gaps');
      await session.commit();
      const updated = useStore.getState().documents[0];
      const committed = target === 'base' ? await buildBaseCanvas(updated) : await buildRasterLayerCanvas(updated.aiLayers[0], W, H);
      const liveData = (last!.canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, W, H).data;
      const savedData = committed.getContext('2d')!.getImageData(0, 0, W, H).data;
      for (let i = 3; i < savedData.length; i += 4) assert(Math.abs(savedData[i] - liveData[i]) <= 1, 'Live preview differs from committed mask');
      assert(updated.past.length === 1, 'Stroke must be one undo step');
      useStore.getState().undo();
      const undone = useStore.getState().documents[0];
      assert((target === 'base' ? undone.baseLayer.eraseElements : undone.aiLayers[0].eraseElements)?.length === 0, 'Undo did not restore the layer');
      useStore.getState().redo();
      results.push(`${target}, hardness ${hardness}, opacity ${opacity}: round footprint, soft edge, continuous stroke, preview/commit, undo/redo PASS`);
      previewSrc = committed.toDataURL();
    }
  }
  return { results, preview: previewSrc };
}
