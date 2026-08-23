import type { WatermarkObject } from '@/types';

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
const MAX_CACHED_WATERMARK_IMAGES = 8;

function loadWatermarkImage(src: string) {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const pending = new Promise<HTMLImageElement | null>(resolve => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  while (imageCache.size >= MAX_CACHED_WATERMARK_IMAGES) {
    const oldest = imageCache.keys().next().value as string | undefined;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
  imageCache.set(src, pending);
  return pending;
}

/**
 * Shared watermark compositor used by export and by object rasterization.
 * Keeping this in one place prevents a watermark from changing size, opacity,
 * font or aspect ratio when a pixel effect is applied to it.
 */
export async function drawWatermarkToContext(
  context: CanvasRenderingContext2D,
  watermark: WatermarkObject,
  documentWidth: number,
  documentHeight: number,
) {
  if (!watermark.visible) return;
  context.save();
  try {
    context.globalAlpha = watermark.opacity;
    context.translate(watermark.x * documentWidth, watermark.y * documentHeight);
    context.rotate((watermark.rotation * Math.PI) / 180);
    context.scale(watermark.scaleX, watermark.scaleY);
    if (watermark.type === 'text' && watermark.text) {
      const fontSize = (watermark.fontSize ?? 0.06) * documentHeight;
      context.font = `${fontSize}px "${watermark.fontFamily ?? 'Arial'}"`;
      context.fillStyle = watermark.fill ?? '#ffffff';
      context.textBaseline = 'top';
      context.fillText(watermark.text, 0, 0);
      return;
    }
    if (watermark.type !== 'image' || !watermark.imageSrc) return;
    const image = await loadWatermarkImage(watermark.imageSrc);
    if (!image) return;
    const width = (watermark.imageWidth ?? 0.25) * documentWidth;
    const height = image.naturalWidth > 0
      ? width * (image.naturalHeight / image.naturalWidth)
      : (watermark.imageHeight ?? 0.12) * documentHeight;
    context.drawImage(image, 0, 0, width, height);
  } finally {
    context.restore();
  }
}
