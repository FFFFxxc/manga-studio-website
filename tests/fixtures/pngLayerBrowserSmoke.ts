import { pasteExternalImagesAsLayers } from '@/utils/pastedImageLayers';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { renderDocumentToCanvas } from '@/utils/documentComposite';

async function pngFile(canvas: HTMLCanvasElement, name: string) {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error('PNG encoding failed')), 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}

export async function runPngLayerBrowserSmoke() {
  const base = document.createElement('canvas'); base.width = 120; base.height = 100;
  const baseContext = base.getContext('2d')!;
  baseContext.fillStyle = '#ffffff'; baseContext.fillRect(0, 0, 120, 100);
  const doc = makeEditorDocument({ id: 'png-layer-smoke', width: 120, height: 100, originalSrc: base.toDataURL() });
  useStore.setState({ documents: [doc], activeDocIndex: 0, selectedObject: null });

  const overlay = document.createElement('canvas'); overlay.width = 120; overlay.height = 100;
  const overlayContext = overlay.getContext('2d')!;
  overlayContext.fillStyle = '#ff0000'; overlayContext.fillRect(20, 30, 40, 30);
  overlayContext.clearRect(30, 40, 10, 10);
  overlayContext.fillStyle = 'rgba(0,0,255,0.5)'; overlayContext.fillRect(60, 30, 10, 30);
  const empty = document.createElement('canvas'); empty.width = empty.height = 20;
  const errors: string[] = [];
  const files = [new File(['broken image'], 'broken.png', { type: 'image/png' }), await pngFile(overlay, 'overlay.png'), await pngFile(empty, 'empty.png')];
  const ids = await pasteExternalImagesAsLayers(files, doc.id, { onError: error => errors.push(error) });
  let state = useStore.getState();
  const imported = state.documents[0];
  if (ids.length !== 1 || errors.length !== 2) throw Error('Invalid files prevented importing the valid PNG');
  if (imported.watermarks.length || imported.aiLayers.length !== 1) throw Error('PNG was not inserted as a raster layer');
  const layer = imported.aiLayers[0];
  const expectedCrop = { x: 20 / 120, y: 30 / 100, width: 50 / 120, height: 30 / 100 };
  for (const key of ['x', 'y', 'width', 'height'] as const) if (Math.abs(layer.crop![key] - expectedCrop[key]) > 1e-8) throw Error('Visible PNG frame is misaligned');
  if (imported.past.length !== 1) throw Error('Import created more than one undo step');

  const layerImage = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = layer.src;
  });
  const pixelsCanvas = document.createElement('canvas'); pixelsCanvas.width = 120; pixelsCanvas.height = 100;
  const pixelsContext = pixelsCanvas.getContext('2d')!; pixelsContext.drawImage(layerImage, 0, 0);
  const pixel = (ctx: CanvasRenderingContext2D, x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  const opaque = pixel(pixelsContext, 20, 30);
  const hole = pixel(pixelsContext, 35, 45);
  const translucent = pixel(pixelsContext, 65, 45);
  if (opaque.join() !== '255,0,0,255' || hole[3] !== 0 || translucent[3] !== 128) throw Error('PNG pixels or alpha changed on import');
  const exported = await renderDocumentToCanvas(imported, 'png', { willReadFrequently: true });
  const exportContext = exported.getContext('2d')!;
  if (pixel(exportContext, 35, 45).join() !== '255,255,255,255') throw Error('Transparent PNG hole hid the page underneath');
  const mixed = pixel(exportContext, 65, 45);
  if (Math.abs(mixed[0] - 127) > 1 || Math.abs(mixed[1] - 127) > 1 || mixed[2] !== 255) throw Error('Export lost semitransparent PNG edges');
  state.undo();
  if (useStore.getState().documents[0].aiLayers.length) throw Error('Undo did not remove the import');
  useStore.getState().redo();
  if (useStore.getState().documents[0].aiLayers.length !== 1) throw Error('Redo did not restore the PNG');

  const small = document.createElement('canvas'); small.width = 10; small.height = 8;
  small.getContext('2d')!.fillRect(0, 0, 10, 8);
  const smallFile = await pngFile(small, 'small.png');
  const beforeBatch = useStore.getState().documents[0].past.length;
  await pasteExternalImagesAsLayers([smallFile, smallFile], doc.id);
  state = useStore.getState();
  if (state.documents[0].aiLayers.length !== 3 || state.documents[0].past.length !== beforeBatch + 1) throw Error('Multiple PNGs were not imported atomically');
  state.undo();
  if (useStore.getState().documents[0].aiLayers.length !== 1) throw Error('Undo removed the wrong import batch');
  return { importedLayers: ids.length, skippedFiles: errors.length, opaque, hole, translucent, batchUndo: 'passed', frame: layer.crop, preview: exported.toDataURL() };
}
