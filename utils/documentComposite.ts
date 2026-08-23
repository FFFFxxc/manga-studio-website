import type { ImageDocument } from '@/types';
import { drawRasterReferenceToContext } from '@/utils/cleanupRaster';
import { resolveVisualLayerOrder } from '@/utils/layerOrder';
import { drawBrushStroke } from '@/utils/brushRaster';
import { drawBubbleToContext, drawShapeToContext } from '@/utils/drawVectorObject';
import { initializeExportCanvas, renderTextObjectToContext } from '@/utils/textRenderer';
import { drawWatermarkToContext } from '@/utils/watermarkRenderer';

/**
 * Renders only document content. Konva transformers, selection outlines,
 * perspective handles and tool cursors are intentionally never included.
 * Export and the composited eyedropper share this path so sampled pixels match
 * the saved image.
 */
export async function renderDocumentToCanvas(
  doc: ImageDocument,
  format: 'png' | 'jpg' = 'png',
  options?: { willReadFrequently?: boolean },
): Promise<HTMLCanvasElement> {
  try { await document.fonts.ready; } catch { /* font readiness is best-effort */ }
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext(
    '2d',
    options?.willReadFrequently ? { willReadFrequently: true } : undefined,
  );
  if (!ctx) throw new Error('Canvas недоступен.');
  initializeExportCanvas(ctx, doc.width, doc.height, format);

  const drawTranslationMask = (mask: NonNullable<ImageDocument['translationMasks']>[number]) => {
    if (!mask.visible) return;
    const width = mask.width * doc.width;
    const height = mask.height * doc.height;
    ctx.save();
    ctx.translate(mask.x * doc.width, mask.y * doc.height);
    ctx.rotate(mask.rotation * Math.PI / 180);
    ctx.scale(mask.scaleX, mask.scaleY);
    ctx.globalAlpha = mask.opacity;
    ctx.fillStyle = mask.fill;
    if (mask.feather > 0) ctx.filter = `blur(${mask.feather}px)`;
    ctx.beginPath();
    if (mask.shape === 'ellipse') {
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if (mask.shape === 'polygon') {
      const points = mask.points?.length ? mask.points : [0, 0, 1, 0, 1, 1, 0, 1];
      points.forEach((value, index) => {
        if (index % 2 !== 0) return;
        const x = value * width;
        const y = points[index + 1] * height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    } else if (mask.shape === 'rounded-rect') {
      ctx.roundRect(0, 0, width, height, Math.min(width, height) * 0.12);
    } else {
      ctx.rect(0, 0, width, height);
    }
    ctx.fill();
    ctx.restore();
  };

  for (const ref of resolveVisualLayerOrder(doc)) {
    if (ref.type === 'base' || ref.type === 'ai') {
      await drawRasterReferenceToContext(ctx, doc, ref);
    } else if (ref.type === 'strokes') {
      for (const stroke of doc.cleanup.strokes.filter(item => item.purpose !== 'mask')) {
        drawBrushStroke(ctx, stroke, doc.width, doc.height);
      }
    } else if (ref.type === 'watermark') {
      const watermark = doc.watermarks.find(item => item.id === ref.id);
      if (watermark) await drawWatermarkToContext(ctx, watermark, doc.width, doc.height);
    } else if (ref.type === 'text') {
      const text = doc.texts.find(item => item.id === ref.id);
      if (text) renderTextObjectToContext(ctx, text, doc.width, doc.height);
    } else if (ref.type === 'translationMask') {
      const mask = (doc.translationMasks ?? []).find(item => item.id === ref.id);
      if (mask) drawTranslationMask(mask);
    } else if (ref.type === 'shape') {
      const shape = (doc.shapes ?? []).find(item => item.id === ref.id);
      if (shape) drawShapeToContext(ctx, shape, doc.width, doc.height);
    } else if (ref.type === 'bubble') {
      const bubble = (doc.bubbles ?? []).find(item => item.id === ref.id);
      if (bubble) drawBubbleToContext(ctx, bubble, doc.width, doc.height);
    }
  }
  return canvas;
}
