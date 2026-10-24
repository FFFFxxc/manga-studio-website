import { createSmudgeSession } from '@/utils/smudgeRaster';
import { useStore } from '@/store/useStore';
import { buildBaseCanvas } from '@/utils/cleanupRaster';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';

export async function runSmudgeBrowserSmoke() {
  const source = document.createElement('canvas');
  source.width = 320; source.height = 160;
  const context = source.getContext('2d')!;
  context.fillStyle = 'rgba(230,30,40,0.5)'; context.fillRect(0, 0, 100, 160);
  context.fillStyle = 'rgba(30,60,230,0.5)'; context.fillRect(100, 0, 220, 160);
  const points = [80, 80, 220, 80, 220, 40, 80, 40, 80, 80].map((point, index) => point / (index % 2 === 0 ? 320 : 160));
  const run = async (streamed: boolean, sampleAllLayers = false) => {
    const doc = makeEditorDocument({ width: 320, height: 160, originalSrc: source.toDataURL() });
    doc.baseLayer.locked = false;
    useStore.setState({ documents: [doc], activeDocIndex: 0, selectedObject: null });
    const session = await createSmudgeSession({ documentId: doc.id, layer: { type: 'base' }, previewScale: 1, settings: { size: 0.25, hardness: 0.6, strength: 0.5, sampleAllLayers } });
    if (streamed) for (let index = 0; index < points.length; index += 2) session.append(points.slice(index, index + 2));
    else session.append(points);
    await session.commit();
    return buildBaseCanvas(useStore.getState().documents[0]);
  };
  const batch = await run(false), streamed = await run(true);
  const allBatch = await run(false, true), allStreamed = await run(true, true);
  const allBatchPixels = allBatch.getContext('2d')!.getImageData(0, 0, 320, 160).data;
  const allStreamedPixels = allStreamed.getContext('2d')!.getImageData(0, 0, 320, 160).data;
  let sampleAllDifferingChannels = 0;
  for (let i = 0; i < allBatchPixels.length; i++) if (allBatchPixels[i] !== allStreamedPixels[i]) sampleAllDifferingChannels++;
  if (sampleAllDifferingChannels) throw Error(`Sampling all layers depends on pointer batches: ${sampleAllDifferingChannels}`);
  const original = context.getImageData(0, 0, 320, 160).data;
  const actual = batch.getContext('2d')!.getImageData(0, 0, 320, 160).data;
  const streamedPixels = streamed.getContext('2d')!.getImageData(0, 0, 320, 160).data;
  let differingChannels = 0, changedChannels = 0, maxAlpha = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== streamedPixels[i]) differingChannels++;
    if (actual[i] !== original[i]) changedChannels++;
    if (i % 4 === 3) maxAlpha = Math.max(maxAlpha, actual[i]);
  }
  if (differingChannels) throw Error(`Pointer batch size changed ${differingChannels} channels`);
  if (changedChannels < 100) throw Error('A closed smudge stroke did not carry any pixels');
  if (maxAlpha > 128) throw Error(`Smudging accumulated alpha: ${maxAlpha}`);
  const outside = (140 * 320 + 300) * 4;
  if (actual.slice(outside, outside + 4).some((value, index) => value !== original[outside + index])) throw Error('Pixels outside the brush changed');
  return { differingChannels, sampleAllDifferingChannels, changedChannels, maxAlpha, before: source.toDataURL(), after: batch.toDataURL() };
}
