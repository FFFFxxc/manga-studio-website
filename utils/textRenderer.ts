import Konva from 'konva';
import type { TextConfig } from 'konva/lib/shapes/Text';
import type { ExportSettings, TextObject } from '@/types';

/**
 * Text coordinates/font size/width are normalized to the source document.
 * Stroke and shadow sizes are stored in source-document pixels, so previews
 * scale them by the same factor as the image.
 */
export function createTextNodeConfig(
  text: TextObject,
  documentWidth: number,
  documentHeight: number,
  outputScale = 1,
): TextConfig {
  const safeScale = Number.isFinite(outputScale) && outputScale > 0 ? outputScale : 1;
  const width = Math.max(1, documentWidth * safeScale);
  const height = Math.max(1, documentHeight * safeScale);

  const config: TextConfig = {
    x: text.x * width,
    y: text.y * height,
    text: text.vertical ? Array.from(text.text).join('\n') : text.text,
    fontFamily: text.fontFamily,
    fontSize: text.fontSize * height,
    fill: text.fill,
    stroke: text.stroke || undefined,
    strokeWidth: text.stroke ? text.strokeWidth * safeScale : 0,
    shadowColor: text.shadowBlur > 0 ? text.shadowColor : undefined,
    shadowBlur: text.shadowBlur * safeScale,
    shadowOffsetX: (text.shadowOffsetX ?? 0) * safeScale,
    shadowOffsetY: (text.shadowOffsetY ?? 0) * safeScale,
    fontStyle: [text.bold ? 'bold' : '', text.italic ? 'italic' : ''].filter(Boolean).join(' ') || 'normal',
    lineHeight: text.lineHeight,
    align: text.align,
    verticalAlign: 'top',
    wrap: 'word',
    width: text.vertical ? Math.max(text.fontSize * height * 1.35, 1) : text.width * width,
    scaleX: text.scaleX,
    scaleY: text.scaleY,
    rotation: text.rotation,
  };
  if (text.textMode === 'paragraph' && Number.isFinite(text.height) && text.height! > 0) {
    config.height = text.height! * height;
  }
  return config;
}

/** Draw with Konva itself so export uses the same wrapping/baseline metrics as preview. */
export function renderTextObjectToContext(
  context: CanvasRenderingContext2D,
  text: TextObject,
  documentWidth: number,
  documentHeight: number,
): void {
  if (!text.visible || !text.text) return;
  const node = new Konva.Text(createTextNodeConfig(text, documentWidth, documentHeight));
  const bounds = node.getClientRect();
  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const width = Math.max(1, Math.ceil(bounds.x + bounds.width) - x);
  const height = Math.max(1, Math.ceil(bounds.y + bounds.height) - y);
  const canvas = node.toCanvas({ x, y, width, height, pixelRatio: 1 });
  const shouldClip = text.textMode === 'paragraph' && Number.isFinite(text.height) && text.height! > 0;
  if (shouldClip) {
    const scaleX = Number.isFinite(text.scaleX) ? text.scaleX : 1;
    const scaleY = Number.isFinite(text.scaleY) ? text.scaleY : 1;
    context.save();
    context.beginPath();
    context.translate(text.x * documentWidth, text.y * documentHeight);
    context.rotate((text.rotation * Math.PI) / 180);
    context.scale(scaleX, scaleY);
    context.rect(0, 0, Math.max(1, text.width * documentWidth), Math.max(1, text.height! * documentHeight));
    context.restore();
    context.save();
    context.clip();
  }
  context.drawImage(canvas, x, y);
  if (shouldClip) context.restore();
  node.destroy();
}

export function initializeExportCanvas(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  format: ExportSettings['format'],
): void {
  if (format !== 'jpg') return;
  context.save?.();
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.restore?.();
}
