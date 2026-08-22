import { createBaseLayerState, DEFAULT_BASE_ADJUSTMENTS } from '@/types';
import type {
  BubbleKind,
  BubbleObject,
  CropRect,
  ImageDocument,
  ShapeKind,
  ShapeObject,
  StrokeData,
  TextObject,
  WatermarkObject,
  TranslationMaskObject,
} from '@/types';
import { sanitizePerspectiveQuad } from '@/utils/perspective';
import { normalizeGlowStyle, normalizePaintStyle } from '@/utils/objectPaint';

export interface CoordinateSpace {
  viewport: { x: number; y: number; scale: number };
  imageWidth: number;
  imageHeight: number;
}

const finite = (value: number) => Number.isFinite(value);
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const SHAPE_KINDS = new Set<ShapeKind>([
  'rect', 'ellipse', 'line', 'arrow', 'star',
  'double-arrow', 'curved-arrow', 'elbow-arrow',
  'block-arrow', 'chevron', 'pointer',
]);
const BUBBLE_KINDS = new Set<BubbleKind>([
  'speech', 'thought', 'scream', 'narration', 'whisper',
  'soft', 'cloud', 'comic', 'electric', 'caption',
]);

export function screenToImage(point: { x: number; y: number }, space: CoordinateSpace) {
  const { viewport, imageWidth, imageHeight } = space;
  if (viewport.scale <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
  const x = (point.x - viewport.x) / viewport.scale / imageWidth;
  const y = (point.y - viewport.y) / viewport.scale / imageHeight;
  return { x, y, inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

export function imageToScreen(point: { x: number; y: number }, space: CoordinateSpace) {
  return {
    x: space.viewport.x + point.x * space.imageWidth * space.viewport.scale,
    y: space.viewport.y + point.y * space.imageHeight * space.viewport.scale,
  };
}

/** Placement transform shared by raster layers (Konva order: translate → rotate → scale). */
export interface PlacementTransform {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
}

function transformRectBBox(
  rect: CropRect,
  docW: number,
  docH: number,
  mapPoint: (px: number, py: number) => { x: number; y: number },
): CropRect {
  const corners = [
    [rect.x * docW, rect.y * docH],
    [(rect.x + rect.width) * docW, rect.y * docH],
    [(rect.x + rect.width) * docW, (rect.y + rect.height) * docH],
    [rect.x * docW, (rect.y + rect.height) * docH],
  ].map(([px, py]) => mapPoint(px, py));
  const xs = corners.map(corner => corner.x);
  const ys = corners.map(corner => corner.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX / docW,
    y: minY / docH,
    width: (Math.max(...xs) - minX) / docW,
    height: (Math.max(...ys) - minY) / docH,
  };
}

/**
 * Map a layer-local normalized rect (e.g. the layer's crop) to the
 * document-normalized rect where that area is actually rendered on canvas,
 * honoring the layer's move/scale/rotation. For rotated layers this is the
 * axis-aligned bounding box of the transformed rect.
 */
export function localRectToDocRect(rect: CropRect, placement: PlacementTransform, docW: number, docH: number): CropRect {
  const tx = (placement.x ?? 0) * docW;
  const ty = (placement.y ?? 0) * docH;
  const sx = placement.scaleX ?? 1;
  const sy = placement.scaleY ?? 1;
  const rad = ((placement.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return transformRectBBox(rect, docW, docH, (px, py) => ({
    x: tx + cos * sx * px - sin * sy * py,
    y: ty + sin * sx * px + cos * sy * py,
  }));
}

/**
 * Inverse of localRectToDocRect: map an on-canvas (document-normalized) rect
 * back into the layer's local normalized space, intersected with the layer's
 * own [0..1] bounds. Used to store a crop drawn over a moved/scaled layer.
 */
export function docRectToLocalRect(rect: CropRect, placement: PlacementTransform, docW: number, docH: number): CropRect {
  const tx = (placement.x ?? 0) * docW;
  const ty = (placement.y ?? 0) * docH;
  const sx = placement.scaleX ?? 1;
  const sy = placement.scaleY ?? 1;
  if (sx === 0 || sy === 0 || !finite(sx) || !finite(sy)) return rect;
  const rad = ((placement.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const raw = transformRectBBox(rect, docW, docH, (px, py) => {
    const vx = px - tx;
    const vy = py - ty;
    return { x: (cos * vx + sin * vy) / sx, y: (-sin * vx + cos * vy) / sy };
  });
  const x1 = clamp01(raw.x);
  const y1 = clamp01(raw.y);
  const x2 = clamp01(raw.x + raw.width);
  const y2 = clamp01(raw.y + raw.height);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.max(0.005, Math.abs(x2 - x1)),
    height: Math.max(0.005, Math.abs(y2 - y1)),
  };
}

function validPosition(value: number) {
  return finite(value) && Math.abs(value) <= 2;
}

export function sanitizeText(text: TextObject): TextObject | null {
  if (![text.x, text.y, text.width, text.fontSize].every(validPosition)) return null;
  const x = clamp01(text.x);
  const y = clamp01(text.y);
  const { height, textMode, ...rest } = text;
  const paragraph = textMode === 'paragraph';
  const sanitized: TextObject = {
    ...rest,
    x,
    y,
    width: paragraph
      ? Math.min(1 - x, Math.abs(text.width))
      : Math.max(0.01, Math.min(1 - x, Math.abs(text.width))),
    fontSize: Math.max(0.003, Math.min(0.5, Math.abs(text.fontSize))),
  };
  if (textMode === 'point' || textMode === 'paragraph') sanitized.textMode = textMode;
  if (Number.isFinite(height) && height! > 0) {
    sanitized.height = paragraph
      ? Math.min(1 - y, height!)
      : Math.max(0.003, Math.min(1 - y, height!));
  }
  return sanitized;
}

export function sanitizeWatermark(wm: WatermarkObject): WatermarkObject | null {
  if (![wm.x, wm.y, wm.scaleX, wm.scaleY].every(validPosition)) return null;
  return { ...wm, x: clamp01(wm.x), y: clamp01(wm.y), scaleX: Math.max(0.01, Math.min(2, Math.abs(wm.scaleX))), scaleY: Math.max(0.01, Math.min(2, Math.abs(wm.scaleY))) };
}

export function sanitizeShape(shape: ShapeObject): ShapeObject | null {
  if (!SHAPE_KINDS.has(shape.kind)) return null;
  if (![shape.x, shape.y, shape.width, shape.height].every(validPosition)) return null;
  return {
    ...shape,
    x: clamp01(shape.x),
    y: clamp01(shape.y),
    width: Math.max(0.005, Math.min(1, Math.abs(shape.width))),
    height: Math.max(0.005, Math.min(1, Math.abs(shape.height))),
    fillStyle: normalizePaintStyle(shape.fillStyle, shape.fill || 'transparent'),
    strokeStyle: normalizePaintStyle(
      shape.strokeStyle,
      shape.stroke === '' ? 'transparent' : shape.stroke || '#000000',
    ),
    glow: normalizeGlowStyle(shape.glow),
    lineStyle: shape.lineStyle === 'dashed' || shape.lineStyle === 'dotted' ? shape.lineStyle : 'solid',
    curve: Number.isFinite(shape.curve) ? Math.max(-1, Math.min(1, shape.curve!)) : 0.35,
  };
}

export function sanitizeBubble(bubble: BubbleObject): BubbleObject | null {
  if (!BUBBLE_KINDS.has(bubble.kind)) return null;
  if (![bubble.x, bubble.y, bubble.width, bubble.height].every(validPosition)) return null;
  const sanitized: BubbleObject = {
    ...bubble,
    x: clamp01(bubble.x),
    y: clamp01(bubble.y),
    width: Math.max(0.005, Math.min(1, Math.abs(bubble.width))),
    height: Math.max(0.005, Math.min(1, Math.abs(bubble.height))),
    text: { ...bubble.text },
    fillStyle: normalizePaintStyle(bubble.fillStyle, bubble.fill || 'transparent'),
    strokeStyle: normalizePaintStyle(
      bubble.strokeStyle,
      bubble.stroke === '' ? 'transparent' : bubble.stroke || '#000000',
    ),
    glow: normalizeGlowStyle(bubble.glow),
    tail: bubble.tail ? {
      ...bubble.tail,
      tipX: bubble.tail.tipX != null ? clamp01(bubble.tail.tipX) : undefined,
      tipY: bubble.tail.tipY != null ? clamp01(bubble.tail.tipY) : undefined,
      width: Math.max(0.01, Math.min(1, Math.abs(bubble.tail.width))),
    } : null,
  };
  return sanitized;
}

export function sanitizeStroke(stroke: StrokeData): StrokeData | null {
  if (stroke.points.length < 2 || stroke.points.some(value => !finite(value) || Math.abs(value) > 2)) return null;
  const points = stroke.points.map(clamp01);
  return {
    ...stroke,
    points,
    size: Math.max(0.001, Math.min(0.5, Math.abs(stroke.size))),
    hardness: Math.max(0, Math.min(1, Number.isFinite(stroke.hardness) ? stroke.hardness! : 1)),
  };
}

export function sanitizeImageDocument(document: ImageDocument): ImageDocument {
  return {
    ...document,
    texts: document.texts.map(sanitizeText).filter((item): item is TextObject => Boolean(item)),
    watermarks: document.watermarks.map(sanitizeWatermark).filter((item): item is WatermarkObject => Boolean(item)),
    shapes: (document.shapes ?? []).map(sanitizeShape).filter((item): item is ShapeObject => Boolean(item)),
    bubbles: (document.bubbles ?? []).map(sanitizeBubble).filter((item): item is BubbleObject => Boolean(item)),
    translationMasks: (document.translationMasks ?? []).flatMap((mask): TranslationMaskObject[] => {
      if (![mask.x, mask.y, mask.width, mask.height].every(finite)) return [];
      return [{
        ...mask,
        x: Math.max(-1, Math.min(2, mask.x)),
        y: Math.max(-1, Math.min(2, mask.y)),
        width: Math.max(0.002, Math.min(2, Math.abs(mask.width))),
        height: Math.max(0.002, Math.min(2, Math.abs(mask.height))),
        scaleX: finite(mask.scaleX) ? mask.scaleX : 1,
        scaleY: finite(mask.scaleY) ? mask.scaleY : 1,
        rotation: finite(mask.rotation) ? mask.rotation : 0,
        opacity: clamp01(finite(mask.opacity) ? mask.opacity : 1),
        feather: Math.max(0, finite(mask.feather) ? mask.feather : 0),
        padding: Math.max(0, finite(mask.padding) ? mask.padding : 0.04),
        visible: mask.visible !== false,
      }];
    }),
    cleanup: { ...document.cleanup, strokes: document.cleanup.strokes.map(sanitizeStroke).filter((item): item is StrokeData => Boolean(item)) },
    masks: (document.masks ?? []).map(mask => ({
      ...mask,
      visible: mask.visible !== false,
      opacity: clamp01(Number.isFinite(mask.opacity) ? mask.opacity : 0.55),
      strokes: (mask.strokes ?? []).map(sanitizeStroke).filter((item): item is StrokeData => Boolean(item)),
      elements: (mask.elements ?? (mask.strokes ?? []).map(stroke => ({ type: 'brush' as const, stroke }))).map(element => {
        if (element.type === 'brush') { const stroke = sanitizeStroke(element.stroke); return stroke ? { ...element, type: 'brush' as const, stroke } : null; }
        if (element.type === 'polygon') return element.points.length >= 6 ? { ...element, points: element.points.map(clamp01) } : null;
        return element.src ? element : null;
      }).filter((element): element is NonNullable<typeof element> => Boolean(element)),
    })),
    aiLayers: (document.aiLayers ?? []).map(layer => ({
      ...layer,
      visible: layer.visible !== false,
      opacity: clamp01(Number.isFinite(layer.opacity) ? layer.opacity : 1),
      eraseElements: layer.eraseElements ?? [],
      perspective: sanitizePerspectiveQuad(layer.perspective),
    })),
    baseLayer: document.baseLayer
      ? {
          ...document.baseLayer,
          opacity: clamp01(Number.isFinite(document.baseLayer.opacity) ? document.baseLayer.opacity : 1),
          eraseElements: document.baseLayer.eraseElements ?? [],
          adjustments: { ...DEFAULT_BASE_ADJUSTMENTS, ...document.baseLayer.adjustments },
          perspective: sanitizePerspectiveQuad(document.baseLayer.perspective),
        }
      : createBaseLayerState(document.id),
    activeMaskId: document.activeMaskId ?? null,
    selectedLayer: document.selectedLayer ?? null,
  };
}

export function clampOcrBox(box: { x: number; y: number; width: number; height: number }) {
  if (![box.x, box.y, box.width, box.height].every(finite) || box.width <= 0 || box.height <= 0) return null;
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const width = Math.max(0.005, Math.min(1 - x, box.width));
  const height = Math.max(0.005, Math.min(1 - y, box.height));
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
