import { BRUSH_PRESETS } from '@/utils/brushPresets';
import { drawBrushStroke } from '@/utils/brushRaster';
import { saveSticker, listSavedStickers, deleteSavedSticker } from '@/utils/stickerLibrary';
import { saveCustomFont, loadSavedCustomFonts } from '@/utils/fonts';
import { renderDocumentToCanvas } from '@/utils/documentComposite';
import { initializeExportCanvas } from '@/utils/textRenderer';
import { pasteExternalImagesAsLayers } from '@/utils/pastedImageLayers';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import type { StrokeData } from '@/types';

function assert(condition: boolean, message: string) { if (!condition) throw Error(message); }
export async function runAssetLibraryBrowserSmoke() {
  const restoring = localStorage.getItem('asset-library-smoke') === 'saved';
  const before = await listSavedStickers();
  if (restoring) {
    assert(before.some(item => item.name === 'library-test'), 'PNG did not survive a full page reload');
    assert((await loadSavedCustomFonts()).includes('LibrarySmokeFont'), 'Font did not survive a full page reload');
    assert(document.fonts.check('16px "LibrarySmokeFont"'), 'Restored font is not registered for canvas');
  }
  const stickerCanvas = document.createElement('canvas'); stickerCanvas.width = stickerCanvas.height = 40;
  const sctx = stickerCanvas.getContext('2d')!;
  sctx.fillStyle = 'rgba(255,100,20,.5)'; sctx.beginPath(); sctx.arc(20, 20, 15, 0, Math.PI * 2); sctx.fill();
  const blob = await new Promise<Blob>(resolve => stickerCanvas.toBlob(blob => resolve(blob!), 'image/png'));
  const saved = await saveSticker(new File([blob], 'library-test.png', { type: 'image/png' }));
  await saveSticker(new File([blob], 'library-test.png', { type: 'image/png' }));
  assert((await listSavedStickers()).filter(item => item.id === saved.id).length === 1, 'Duplicate PNG was stored twice');
  let rejected = false;
  try { await saveSticker(new File(['not png'], 'broken.png')); } catch { rejected = true; }
  assert(rejected, 'Invalid PNG was accepted');
  const font = await fetch('/fonts/balsamiq-sans-400-cyrillic.woff2').then(response => response.arrayBuffer());
  await saveCustomFont('LibrarySmokeFont', font);
  localStorage.setItem('asset-library-smoke', 'saved');

  const blank = document.createElement('canvas'); blank.width = 400; blank.height = 180;
  const doc = makeEditorDocument({ id: 'asset-library', width: 400, height: 180, originalSrc: blank.toDataURL() });
  const previews: Array<{name: string; src: string}> = [];
  for (const preset of BRUSH_PRESETS) {
    const stroke: StrokeData = { id: preset.id, points: [0.22, 0.5, 0.78, 0.5], size: 0.65, hardness: 0.6, opacity: 0.8, color: '#e5f1ff', brushPreset: preset.id };
    const expected = document.createElement('canvas'); expected.width = 400; expected.height = 180;
    const ctx = expected.getContext('2d')!;
    initializeExportCanvas(ctx, 400, 180, 'png'); drawBrushStroke(ctx, stroke, 400, 180);
    doc.cleanup.strokes = [stroke];
    const exported = await renderDocumentToCanvas(doc, 'png');
    const a = ctx.getImageData(0, 0, 400, 180).data;
    const b = exported.getContext('2d')!.getImageData(0, 0, 400, 180).data;
    for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `Export changed ${preset.name} pixels`);
    previews.push({ name: preset.name, src: exported.toDataURL() });
  }
  doc.cleanup.strokes = [];
  useStore.setState({ documents: [doc], activeDocIndex: 0 });
  await pasteExternalImagesAsLayers([new File([saved.blob], 'Saved sticker.png', { type: 'image/png' })], doc.id);
  assert(useStore.getState().documents[0].aiLayers.length === 1, 'Saved sticker did not insert as a layer');
  const builtin = await fetch('/stickers/favmemojis/001.png').then(response => response.blob());
  await pasteExternalImagesAsLayers([new File([builtin], 'Memoji 001.png', { type: 'image/png' })], doc.id);
  assert(useStore.getState().documents[0].aiLayers.length === 2, 'Built-in sticker did not insert');
  await deleteSavedSticker(saved.id);
  assert((await listSavedStickers()).every(item => item.id !== saved.id), 'Sticker deletion did not persist');
  assert(useStore.getState().documents[0].aiLayers.length === 2, 'Deleting a library sticker removed document layers');
  await saveSticker(new File([saved.blob], 'library-test.png', { type: 'image/png' }));
  return { status: restoring ? 'PASS — PNG и шрифт восстановлены после полной перезагрузки' : 'PASS — сохранено; нажмите «Перезагрузить» для проверки восстановления', details: '7 кистей: экспорт совпадает попиксельно. PNG: проверка формата, защита от дублей, вставка своего и встроенного стикера слоями, независимое удаление.', previews };
}
