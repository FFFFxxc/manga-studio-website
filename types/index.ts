export interface StrokeData {
  id: string;
  points: number[]; // [x0,y0,x1,y1,...] normalized 0..1 relative to image
  size: number;     // fraction of image height
  color: string;
  opacity: number;
  /** 0 = fully soft edge, 1 = hard edge. Missing on legacy strokes means 1. */
  hardness?: number;
  /** Paint is the default for documents created before eraser support. */
  mode?: 'paint' | 'erase';
  purpose?: 'paint' | 'mask';
}

export interface WatermarkObject {
  id: string;
  type: 'text' | 'image';
  text?: string;
  fontFamily?: string;
  fontSize?: number;    // fraction of image height
  fill?: string;
  imageSrc?: string;    // dataURL
  imageWidth?: number;  // fraction of image width
  imageHeight?: number; // fraction of image height
  x: number;           // normalized top-left x
  y: number;           // normalized top-left y
  scaleX: number;
  scaleY: number;
  rotation: number;    // degrees
  opacity: number;     // 0..1
  visible: boolean;
  isBatch: boolean;
  locked?: boolean;
}

export type TextMode = 'point' | 'paragraph';

export interface TextObject {
  id: string;
  text: string;
  fontFamily: string;
  fontSize: number;     // fraction of image height
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  bold?: boolean;
  italic?: boolean;
  vertical?: boolean;
  textMode?: TextMode;
  width: number;        // fraction of image width
  height?: number;      // fraction of image height; only paragraph text clips to it
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  visible: boolean;
  locked?: boolean;
  /** OCR text exactly as it was seen before translation. */
  sourceText?: string;
  /** Identifies text created by a page auto-translation run. */
  translationBatchId?: string;
  /** Links this text to its editable auto-translation mask. */
  groupId?: string;
  /** Whether this object is currently showing its translated value. */
  isTranslated?: boolean;
}

export type TranslationMaskShape = 'rect' | 'rounded-rect' | 'ellipse' | 'polygon';

/** Editable fill generated underneath one auto-translated text block. */
export interface TranslationMaskObject {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  shape: TranslationMaskShape;
  /** Polygon points normalized inside the mask's own bounds. */
  points?: number[];
  fill: string;
  opacity: number;
  feather: number;
  padding: number;
  visible: boolean;
  locked?: boolean;
  groupId?: string;
  textId?: string;
  /** Original OCR bbox, retained for “fit mask to source text”. */
  sourceBounds?: CropRect;
}

export type ShapeKind =
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'star'
  | 'double-arrow'
  | 'curved-arrow'
  | 'elbow-arrow'
  | 'block-arrow'
  | 'chevron'
  | 'pointer';

export interface GradientStop {
  id: string;
  offset: number;
  color: string;
}

export type PaintStyle =
  | { type: 'solid'; color: string }
  | { type: 'linear'; angle: number; stops: GradientStop[] }
  | {
      type: 'radial';
      centerX: number;
      centerY: number;
      radius: number;
      stops: GradientStop[];
    };

export interface GlowStyle {
  enabled: boolean;
  color: string;
  blur: number;
  opacity: number;
  intensity: number;
}

export interface GradientPreset {
  id: string;
  name: string;
  style: PaintStyle;
  builtIn?: boolean;
}

export interface ShapeObject {
  id: string;
  kind: ShapeKind;
  x: number;        // normalized center x
  y: number;        // normalized center y
  width: number;    // normalized fraction of image width
  height: number;   // normalized fraction of image height
  fill: string;     // '' = no fill
  stroke: string;
  strokeWidth: number; // px at original resolution
  opacity: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  cornerRadius: number; // for rect, px at original resolution
  visible: boolean;
  locked?: boolean;
  fillStyle?: PaintStyle;
  strokeStyle?: PaintStyle;
  glow?: GlowStyle;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  curve?: number;
}

export type BubbleKind =
  | 'speech'
  | 'thought'
  | 'scream'
  | 'narration'
  | 'whisper'
  | 'soft'
  | 'cloud'
  | 'comic'
  | 'electric'
  | 'caption';

export interface BubbleTail {
  enabled: boolean;
  /** Which side of the bubble body the tail exits from */
  side: 'top' | 'right' | 'bottom' | 'left';
  /** 0…1 along the chosen side (clamped 0.12…0.88) */
  anchor: number;
  /** Length relative to the shorter body dimension (clamped 0.08…0.8) */
  length: number;
  /** Base width fraction (clamped 0.04…0.25) */
  width: number;
  /** Bézier curve amount 0…1 */
  curve: number;
  /** Legacy absolute tip position – used only for migration, not for rendering */
  tipX?: number;
  tipY?: number;
}

export interface BubbleObject {
  id: string;
  kind: BubbleKind;
  visible: boolean;
  x: number;         // normalized center x of body
  y: number;         // normalized center y of body
  width: number;     // normalized fraction of image width
  height: number;    // normalized fraction of image height
  rotation: number;
  autoSize: boolean; // grows with text by default
  tail: BubbleTail | null; // narration created with null
  fill: string;
  stroke: string;
  strokeWidth: number;
  locked?: boolean;
  fillStyle?: PaintStyle;
  strokeStyle?: PaintStyle;
  glow?: GlowStyle;
  text: {
    content: string;
    fontFamily: string;
    fontSize: number;
    fill: string;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
  };
}

export interface CleanupLayerState {
  committed: string | null; // legacy dataURL kept for older documents
  strokes: StrokeData[];
  locked?: boolean;
}

export type MaskElement =
  | { id?: string; type: 'brush'; stroke: StrokeData }
  | { id?: string; type: 'polygon'; points: number[]; mode?: 'add' | 'erase' }
  | { id?: string; type: 'bitmap'; src: string; mode?: 'add' | 'erase' };

export interface BaseLayerAdjustments {
  brightness: number; // 1 = neutral
  contrast: number;   // 1 = neutral
  saturation: number; // 1 = neutral
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

/** Four document-normalized corners of a projectively transformed raster layer. */
export interface PerspectiveQuad {
  topLeft: NormalizedPoint;
  topRight: NormalizedPoint;
  bottomRight: NormalizedPoint;
  bottomLeft: NormalizedPoint;
}

/** Non-destructive transform shared by raster layers (base + AI). x/y are normalized to doc size. */
export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // degrees
  /** When present, replaces the affine transform for rendering. */
  perspective?: PerspectiveQuad | null;
  /** Source alpha bounds mapped to the perspective quad. */
  perspectiveSourceBounds?: CropRect | null;
}

export const DEFAULT_LAYER_TRANSFORM: LayerTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

export interface BaseLayerState {
  id: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  eraseElements: MaskElement[];
  adjustments: BaseLayerAdjustments;
  /** Non-destructive crop, normalized to doc size. */
  crop?: CropRect | null;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  perspective?: PerspectiveQuad | null;
  /** Source alpha bounds mapped to the perspective quad. */
  perspectiveSourceBounds?: CropRect | null;
}

export const DEFAULT_BASE_ADJUSTMENTS: BaseLayerAdjustments = { brightness: 1, contrast: 1, saturation: 1 };

export function createBaseLayerState(documentId: string): BaseLayerState {
  return {
    id: `base-${documentId}`,
    visible: true,
    locked: true,
    opacity: 1,
    eraseElements: [],
    adjustments: { ...DEFAULT_BASE_ADJUSTMENTS },
    crop: null,
    ...DEFAULT_LAYER_TRANSFORM,
  };
}

export interface MaskLayer {
  id: string;
  name: string;
  strokes: StrokeData[]; // legacy mirror for existing documents
  elements: MaskElement[];
  visible: boolean;
  opacity: number;
  locked?: boolean;
  resultLayerId?: string;
}

export interface AiRasterLayer {
  id: string;
  name: string;
  src: string;
  visible: boolean;
  opacity: number;
  operation: 'cleanup' | 'remove-background' | 'duplicate' | 'local-cutout' | 'drawing' | 'effect';
  replacesBase?: boolean;
  maskId?: string;
  eraseElements?: MaskElement[];
  adjustments?: BaseLayerAdjustments;
  /** Non-destructive crop, normalized to doc size. */
  crop?: CropRect | null;
  locked?: boolean;
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  perspective?: PerspectiveQuad | null;
  /** Source alpha bounds mapped to the perspective quad. */
  perspectiveSourceBounds?: CropRect | null;
}

export type SelectedLayer = { id: string; type: 'base' | 'mask' | 'ai' };

/** A single entry in the document's unified z-order stack. */
export type LayerReference =
  | { type: 'base'; id: string }
  | { type: 'ai'; id: string }
  | { type: 'text'; id: string }
  | { type: 'watermark'; id: string }
  | { type: 'shape'; id: string }
  | { type: 'bubble'; id: string }
  | { type: 'translationMask'; id: string };

export interface HistorySnapshot {
  cleanup: CleanupLayerState;
  baseLayer: BaseLayerState;
  masks: MaskLayer[];
  aiLayers: AiRasterLayer[];
  activeMaskId: string | null;
  selectedLayer: SelectedLayer | null;
  watermarks: WatermarkObject[];
  texts: TextObject[];
  /** Editable fills created by page translation. Optional for legacy documents. */
  translationMasks?: TranslationMaskObject[];
  shapes: ShapeObject[];
  bubbles: BubbleObject[];
  layerOrder: LayerReference[];
}

export interface ImageDocument {
  id: string;
  file: File;
  originalSrc: string;  // blob URL
  thumbnail: string;    // small dataURL
  width: number;
  height: number;
  name: string;
  cleanup: CleanupLayerState;
  baseLayer: BaseLayerState;
  masks: MaskLayer[];
  aiLayers: AiRasterLayer[];
  activeMaskId: string | null;
  selectedLayer: SelectedLayer | null;
  watermarks: WatermarkObject[];
  texts: TextObject[];
  /** Editable fills created by page translation. Optional for legacy documents. */
  translationMasks?: TranslationMaskObject[];
  shapes: ShapeObject[];
  bubbles: BubbleObject[];
  /** Unified z-order stack (bottom → top). Missing refs are appended on top at resolve time. */
  layerOrder?: LayerReference[];
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  hasChanges: boolean;
}

export type CleanupMethod = 'auto' | 'white' | 'background' | 'inpaint';
export type ActiveTool = 'select' | 'brush' | 'maskBrush' | 'eraser' | 'pan' | 'lasso' | 'polyLasso' | 'rectSelect' | 'text' | 'wand' | 'crop' | 'blur';

export type SelectionMode = 'replace' | 'add' | 'subtract';
export type LeftTab = 'watermark' | 'cleanup' | 'text' | 'insert' | 'transform' | 'bubble';

export interface SelectedObject {
  id: string;
  type: 'watermark' | 'text' | 'shape' | 'bubble' | 'translationMask';
}

export interface CropRect {
  x: number; // normalized
  y: number;
  width: number;
  height: number;
}

export interface ShapeSettings {
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  cornerRadius: number;
  fillStyle: PaintStyle;
  strokeStyle: PaintStyle;
  glow: GlowStyle;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  curve: number;
}

export interface WatermarkSettings {
  type: 'text' | 'image';
  text: string;
  fontFamily: string;
  fontSize: number;
  fill: string;
  imageSrc: string | null;
  imageWidth: number;
  imageHeight: number;
  opacity: number;
  rotation: number;
  batchMode: 'fixed' | 'random' | 'scattered';
  scatterOffsetPct: number;
  scatterTiltDeg: number;
}

export interface CleanupSettings {
  brushSize: number;
  brushHardness: number;
  brushOpacity: number;
  brushColor: string;
  inpaintRadius: number;
  mode: 'brush' | 'inpaint' | 'magic';
  cleanupMethod: CleanupMethod;
  magicThreshold: number;
  selectionMode: SelectionMode;
  wandContiguous: boolean;
  /** Keep the active selection after applying an action (erase/fill/inpaint). */
  keepSelectionAfterAction: boolean;
  /** How «Перевести бабл» should remove the original text before insertion. */
  translationCleanupMethod: 'local' | 'clipdrop';
  /** Hide image-model translation/redraw actions and use OCR + text instead. */
  disableImageTranslationModel: boolean;
}

export interface TextSettings {
  fontFamily: string;
  fontSize: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  vertical: boolean;
  width: number;
  /** Text that will be placed on next click when the text tool is active. */
  draftText: string;
}

export interface CropSettings {
  scope: 'page' | 'layer' | 'canvas-size' | 'image-size';
  lockAspect: boolean;
  ratio: 'free' | '1:1' | '2:3' | 'a4' | 'original-width';
}

export interface BlurSettings {
  mode: 'blur' | 'pixelate' | 'noise';
  gesture: 'brush' | 'area';
  applyTo: 'layer' | 'selection';
  brushSize: number;
  intensity: number;
  hardness: number;
}

export type RasterEffectMode = 'blur' | 'pixelate' | 'noise' | 'sharpen';

export interface RasterEffectParameters {
  radius: number;
  strength: number;
  cellSize: number;
  noiseAmount: number;
  noiseMonochrome: boolean;
  seed: number;
}

export interface TranslationMaskSettings {
  shape: TranslationMaskShape;
  fill: string;
  opacity: number;
  feather: number;
  padding: number;
}

export interface ExportSettings {
  format: 'png' | 'jpg';
  quality: number;
}

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface LayerVisibility {
  base: boolean;
  cleanup: boolean;
  watermarks: boolean;
  texts: boolean;
  shapes: boolean;
}

/**
 * Встроенный «анимешный» шрифт по умолчанию. Balsamiq Sans — комиксный
 * стиль с полной поддержкой кириллицы; файлы self-hosted в /public/fonts.
 * Используется для инструмента «Текст», «Вставить текст» после перевода
 * бабла и блоков автоперевода (если пользователь не выбрал свой шрифт).
 */
export const DEFAULT_ANIME_FONT = 'Balsamiq Sans';

/** Ключ localStorage для выбранного «Шрифта перевода по умолчанию». */
export const DEFAULT_TRANSLATION_FONT_STORAGE_KEY = 'manga-studio:default-translation-font';

export const MANGA_FONTS = [
  DEFAULT_ANIME_FONT,
  'Russo One',
  'Neucha',
  'Marck Script',
  'Caveat',
  'Amatic SC',
  'Bad Script',
  'Pangolin',
  'Yanone Kaffeesatz',
  'Rubik Mono One',
  'Press Start 2P',
  'Lobster',
  'Arial',
  'Times New Roman',
  'Georgia',
];

export const TEXT_PRESETS: Record<string, Partial<TextSettings>> = {
  'Манга-бабл': {
    fontFamily: 'Neucha',
    fill: '#000000',
    stroke: '',
    strokeWidth: 0,
    shadowBlur: 0,
    fontSize: 0.055,
    align: 'center',
  },
  'Крик': {
    fontFamily: 'Russo One',
    fill: '#ffffff',
    stroke: '#cc0000',
    strokeWidth: 4,
    shadowBlur: 0,
    fontSize: 0.09,
    align: 'center',
  },
  'Сабы': {
    fontFamily: 'Arial',
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 3,
    shadowBlur: 0,
    fontSize: 0.05,
    align: 'center',
  },
  'Неон': {
    fontFamily: 'Russo One',
    fill: '#00ffff',
    stroke: '',
    strokeWidth: 0,
    shadowColor: '#00ffff',
    shadowBlur: 18,
    fontSize: 0.065,
    align: 'center',
  },
};
