import type { TextMode, TextObject } from '@/types';

export interface TextDraftRect {
  mode: TextMode;
  x: number;
  y: number;
  width: number;
  height?: number;
}

interface Point {
  x: number;
  y: number;
}

interface DocumentSize {
  width: number;
  height: number;
}

interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
}

const DEFAULT_POINT_TEXT_WIDTH = 0.35;
const MIN_PARAGRAPH_BOX_PX = 24;

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeDimension(value: number) {
  return finitePositive(value) ? value : 1;
}

export function createTextDraftRect(
  start: Point,
  end: Point,
  documentSize: DocumentSize,
  thresholdPx: number,
): TextDraftRect {
  const documentWidth = safeDimension(documentSize.width);
  const documentHeight = safeDimension(documentSize.height);
  const startX = clamp(start.x / documentWidth, 0, 1);
  const startY = clamp(start.y / documentHeight, 0, 1);
  const dragWidthPx = Math.abs(end.x - start.x);
  const dragHeightPx = Math.abs(end.y - start.y);
  const dragDistancePx = Math.hypot(dragWidthPx, dragHeightPx);

  if (dragDistancePx < Math.max(0, thresholdPx)) {
    return {
      mode: 'point',
      x: startX,
      y: startY,
      width: Math.min(DEFAULT_POINT_TEXT_WIDTH, 1 - startX),
    };
  }

  const minimumWidthPx = Math.min(MIN_PARAGRAPH_BOX_PX, documentWidth);
  const minimumHeightPx = Math.min(MIN_PARAGRAPH_BOX_PX, documentHeight);
  const xPx = clamp(Math.min(start.x, end.x), 0, documentWidth - minimumWidthPx);
  const yPx = clamp(Math.min(start.y, end.y), 0, documentHeight - minimumHeightPx);
  const maxWidthPx = documentWidth - xPx;
  const maxHeightPx = documentHeight - yPx;
  const widthPx = clamp(Math.max(dragWidthPx, minimumWidthPx), minimumWidthPx, maxWidthPx);
  const heightPx = clamp(Math.max(dragHeightPx, minimumHeightPx), minimumHeightPx, maxHeightPx);

  return {
    mode: 'paragraph',
    x: xPx / documentWidth,
    y: yPx / documentHeight,
    width: widthPx / documentWidth,
    height: heightPx / documentHeight,
  };
}

export function normalizeParagraphTransform(
  text: Pick<TextObject, 'width' | 'height'>,
  nodeBox: NodeBox,
  documentSize: DocumentSize,
): Partial<TextObject> {
  const documentWidth = safeDimension(documentSize.width);
  const documentHeight = safeDimension(documentSize.height);
  const scaleX = Number.isFinite(nodeBox.scaleX) ? nodeBox.scaleX ?? 1 : 1;
  const scaleY = Number.isFinite(nodeBox.scaleY) ? nodeBox.scaleY ?? 1 : 1;
  const xPx = Number.isFinite(nodeBox.x) ? nodeBox.x : 0;
  const yPx = Number.isFinite(nodeBox.y) ? nodeBox.y : 0;
  const widthPx = finitePositive(nodeBox.width)
    ? Math.abs(nodeBox.width * scaleX)
    : Math.abs(text.width * documentWidth * scaleX);
  const heightPx = finitePositive(nodeBox.height)
    ? Math.abs(nodeBox.height * scaleY)
    : Math.abs((text.height ?? MIN_PARAGRAPH_BOX_PX / documentHeight) * documentHeight * scaleY);

  return {
    x: clamp(xPx / documentWidth, 0, 1),
    y: clamp(yPx / documentHeight, 0, 1),
    width: Math.max(MIN_PARAGRAPH_BOX_PX / documentWidth, widthPx / documentWidth),
    height: Math.max(MIN_PARAGRAPH_BOX_PX / documentHeight, heightPx / documentHeight),
    scaleX: 1,
    scaleY: 1,
  };
}
