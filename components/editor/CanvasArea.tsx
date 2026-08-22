'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Text, Transformer, Group, Rect, Circle, Ellipse } from 'react-konva';
import Konva from 'konva';
import { useStore } from '@/store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { loadImagesFromFiles, uid, validateFile } from '@/utils/imageUtils';
import type { AiRasterLayer, BaseLayerAdjustments, ImageDocument, MaskElement, StrokeData, WatermarkObject, TextObject, ShapeObject, CropRect, BubbleObject, PerspectiveQuad, TranslationMaskObject } from '@/types';
import { resolveVisualLayerOrder } from '@/utils/layerOrder';
import { buildBaseCanvas, buildRasterLayerCanvas, createFloodMask, bakeStrokeIntoLayerSrc } from '@/utils/cleanupRaster';
import { DropZone } from './DropZone';
import { LayerContextMenu, type ContextMenuState } from './LayerContextMenu';
import { ToolOptionsBar } from './ToolOptionsBar';
import { screenToImage } from '@/utils/coordinates';
import { createLayerFromSelection, hasActiveSelection } from '@/utils/layerActions';
import { copySelectionFragment, pasteFragmentAsLayer, shouldPasteFragment } from '@/utils/fragmentClipboard';
import { BubbleNode } from './BubbleNode';
import { InlineTextEditor } from './InlineTextEditor';
import { drawBrushStroke } from '@/utils/brushRaster';
import { drawPerspectiveImage, isValidPerspectiveQuad } from '@/utils/perspective';
import {
  getCurvedArrowCurveFromHandle,
  getCurvedArrowHandlePosition,
  getShapeGeometry,
} from '@/utils/shapeGeometry';
import { createTextNodeConfig } from '@/utils/textRenderer';
import { isOpenShape } from '@/utils/shapePresets';
import { PaintedShape } from './PaintedShape';
import {
  extractClipboardImageFiles,
  pasteExternalImagesAsLayers,
  shouldKeepNativePaste,
} from '@/utils/pastedImageLayers';
import {
  loadImageImportPreference,
  resolveImageImportDestination,
  storeImageImportPreference,
  type ImageImportDestination,
} from '@/utils/pageImportPreference';
import { toKonvaAdjustmentValues } from '@/utils/konvaAdjustments';
import { toast } from '@/hooks/use-toast';
import { beginEditorOperation, useEditorUiStore } from '@/store/useEditorUiStore';
import { applyRasterEffectPreview } from '@/utils/rasterEffects';
import { PerspectiveOverlay } from './PerspectiveOverlay';
import { TextDraftOverlay } from './TextDraftOverlay';
import { createTextDraftRect, type TextDraftRect } from '@/utils/textBox';
import { getInlineTextEditorBox } from '@/utils/inlineTextEditorGeometry';

const MAX_PREVIEW_SIDE = 1800;
const NEUTRAL_RASTER_ADJUSTMENTS: BaseLayerAdjustments = { brightness: 1, contrast: 1, saturation: 1 };
const RASTER_FILTERS = [Konva.Filters.Brightness, Konva.Filters.Contrast, Konva.Filters.HSL];

interface PendingImageImport {
  files: File[];
  source: 'paste' | 'drop' | 'picker';
}

interface PendingTextDraft {
  documentId: string;
  id: string;
  object: TextObject;
  original?: TextObject;
}

interface TextPointerGesture {
  documentId: string;
  pointerId: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

function scaleToFit(w: number, h: number, maxSide: number): number {
  return Math.min(1, maxSide / Math.max(w, h));
}

function useImage(src: string | null | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => setImg(image);
    image.src = src;
    return () => { image.onload = null; };
  }, [src]);
  return img;
}

function makeCheckerPattern(): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 16;
  const ctx = tile.getContext('2d')!;
  ctx.fillStyle = '#3a3a42';
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#2a2a30';
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  return tile;
}

/**
 * Renders committed cleanup brush strokes to an offscreen canvas so that
 * erase-mode strokes (destination-out) only affect the strokes themselves
 * and never punch holes through the layers rendered below.
 */
function CleanupStrokesNode({ strokes, width, height, lineScale }: {
  strokes: StrokeData[];
  width: number;
  height: number;
  lineScale: number;
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!strokes.length) { setCanvas(null); return; }
    const next = document.createElement('canvas');
    next.width = Math.max(1, Math.round(width));
    next.height = Math.max(1, Math.round(height));
    const ctx = next.getContext('2d');
    if (!ctx) return;
    for (const stroke of strokes) {
      drawBrushStroke(ctx, { ...stroke, size: stroke.size * lineScale / height }, width, height);
    }
    setCanvas(next);
  }, [strokes, width, height, lineScale]);

  if (!canvas) return null;
  return <KonvaImage image={canvas} listening={false} />;
}

/** Shared placement/transform values for a raster layer node. */
interface RasterNodePlacement {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  crop?: CropRect | null;
  perspective?: PerspectiveQuad | null;
  perspectiveSourceBounds?: CropRect | null;
}

type RasterLayerRef = { id: string; type: 'base' | 'ai' };

/**
 * Wraps a raster image with its non-destructive transform + crop and, when
 * selected with the select tool and unlocked, makes it draggable/transformable.
 */
export function PlacedRasterImage({ nodeName, image, sourceIdentity, sourceRevision, width, height, opacity, placement, adjustments, interactive, isSelected, onSelect, onContextMenu, onBeforeChange, onChange, layerRef }: {
  nodeName: string;
  image: CanvasImageSource;
  /** Stable source URL/id and the content revision used for perspective preview caching. */
  sourceIdentity: string;
  sourceRevision: string;
  width: number;
  height: number;
  opacity: number;
  placement: RasterNodePlacement;
  adjustments?: BaseLayerAdjustments;
  interactive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: Konva.KonvaEventObject<PointerEvent>) => void;
  onBeforeChange: () => void;
  onChange: (updates: { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number; perspective?: PerspectiveQuad | null }) => void;
  layerRef: RasterLayerRef;
}) {
  const layerKey = `${layerRef.type}:${layerRef.id}`;
  const perspectiveDragActive = useEditorUiStore(state => state.perspectiveDragLayerKey === layerKey);
  const groupRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const imageRef = useRef<Konva.Image>(null);
  const [perspectiveCanvas, setPerspectiveCanvas] = useState<HTMLCanvasElement | null>(null);
  const renderedSourceRef = useRef<{ key: string; image: CanvasImageSource } | null>(null);
  const draggable = interactive && isSelected;

  useEffect(() => {
    if (draggable && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [draggable]);

  const crop = placement.crop ?? null;
  const perspective = placement.perspective && isValidPerspectiveQuad(placement.perspective) ? placement.perspective : null;
  const naturalW = (image as HTMLImageElement).naturalWidth || (image as HTMLCanvasElement).width || width;
  const naturalH = (image as HTMLImageElement).naturalHeight || (image as HTMLCanvasElement).height || height;
  const previewWidth = Math.max(1, Math.round(width));
  const previewHeight = Math.max(1, Math.round(height));
  const perspectiveQuality = perspectiveDragActive ? 'drag' : 'preview';
  const sourceKey = `${sourceIdentity}|${sourceRevision}`;
  // This key contains only pixels/geometry that affect the rendered preview.
  // In particular it deliberately excludes unrelated editor/UI state.
  const perspectivePreviewCacheKey = [
    sourceIdentity, sourceRevision, naturalW, naturalH,
    previewWidth, previewHeight, opacity,
    crop?.x, crop?.y, crop?.width, crop?.height,
    placement.perspectiveSourceBounds?.x, placement.perspectiveSourceBounds?.y,
    placement.perspectiveSourceBounds?.width, placement.perspectiveSourceBounds?.height,
    perspective?.topLeft.x, perspective?.topLeft.y,
    perspective?.topRight.x, perspective?.topRight.y,
    perspective?.bottomRight.x, perspective?.bottomRight.y,
    perspective?.bottomLeft.x, perspective?.bottomLeft.y,
    perspectiveQuality,
  ].join('|');
  const filterValues = toKonvaAdjustmentValues(adjustments);

  useEffect(() => {
    if (!perspective) {
      renderedSourceRef.current = null;
      setPerspectiveCanvas(null);
      return;
    }
    const renderedSource = renderedSourceRef.current;
    if (renderedSource && renderedSource.key !== sourceKey && renderedSource.image === image) {
      setPerspectiveCanvas(null);
      return;
    }
    const next = document.createElement('canvas');
    next.width = previewWidth;
    next.height = previewHeight;
    const ctx = next.getContext('2d');
    if (!ctx) return;
    drawPerspectiveImage(ctx, image, perspective, next.width, next.height, {
      crop,
      sourceBounds: placement.perspectiveSourceBounds,
      opacity,
      quality: perspectiveQuality,
    });
    renderedSourceRef.current = { key: sourceKey, image };
    setPerspectiveCanvas(next);
    // The serialized key covers value inputs; image identity is deliberately a
    // separate dependency because async image/canvas resolution changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspectivePreviewCacheKey, image]);

  useEffect(() => {
    const node = imageRef.current;
    if (!node) return;
    if (filterValues.enabled) node.cache({ pixelRatio: 1 });
    else if (node.isCached()) node.clearCache();
    node.getLayer()?.batchDraw();
    // Re-cache only when the source/crop changes or filters are toggled. Konva
    // invalidates its filtered cache itself for live brightness/contrast/HSL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, perspectiveCanvas, width, height, crop, filterValues.enabled]);

  const filterProps = filterValues.enabled ? {
    filters: RASTER_FILTERS,
    brightness: filterValues.brightness,
    contrast: filterValues.contrast,
    saturation: filterValues.saturation,
  } : { filters: [] };

  if (perspective) {
    const currentPerspectiveCanvas = renderedSourceRef.current?.key === sourceKey
      ? perspectiveCanvas
      : null;
    return (
      <>
        {currentPerspectiveCanvas && (
          <KonvaImage
            ref={imageRef}
            name={nodeName}
            image={currentPerspectiveCanvas}
            width={width}
            height={height}
            listening={interactive}
            onClick={onSelect}
            onTap={onSelect}
            onContextMenu={onContextMenu}
            {...filterProps}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={(placement.x ?? 0) * width}
        y={(placement.y ?? 0) * height}
        scaleX={placement.scaleX ?? 1}
        scaleY={placement.scaleY ?? 1}
        rotation={placement.rotation ?? 0}
        draggable={draggable}
        listening={interactive}
        onClick={onSelect}
        onTap={onSelect}
        onContextMenu={onContextMenu}
        onDragStart={onBeforeChange}
        onDragEnd={e => onChange({ x: e.target.x() / width, y: e.target.y() / height })}
        onTransformStart={onBeforeChange}
        onTransformEnd={() => {
          const node = groupRef.current;
          if (!node) return;
          onChange({
            x: node.x() / width,
            y: node.y() / height,
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
          });
        }}
      >
        {crop ? (
          <KonvaImage
            ref={imageRef}
            name={nodeName}
            image={image}
            x={crop.x * width}
            y={crop.y * height}
            width={crop.width * width}
            height={crop.height * height}
            crop={{ x: crop.x * naturalW, y: crop.y * naturalH, width: crop.width * naturalW, height: crop.height * naturalH }}
            opacity={opacity}
            {...filterProps}
          />
        ) : (
          <KonvaImage ref={imageRef} name={nodeName} image={image} width={width} height={height} opacity={opacity} {...filterProps} />
        )}
      </Group>
      {draggable && (
        <Transformer
          ref={trRef}
          rotateEnabled
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
        />
      )}
    </>
  );
}

function RasterLayerNode({ layer, width, height, interactive, isSelected, onSelect, onContextMenu }: {
  layer: AiRasterLayer;
  width: number;
  height: number;
  interactive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: Konva.KonvaEventObject<PointerEvent>) => void;
}) {
  const updateAiLayer = useStore(state => state.updateAiLayer);
  const pushHistory = useStore(state => state.pushHistory);
  const adjustments = layer.adjustments;
  const needsProcessing = (layer.eraseElements?.length ?? 0) > 0;
  const plainImage = useImage(needsProcessing ? null : layer.src);
  const [erased, setErased] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!needsProcessing) { setErased(null); return; }
    let cancelled = false;
    void buildRasterLayerCanvas({ ...layer, adjustments: NEUTRAL_RASTER_ADJUSTMENTS }, Math.max(1, Math.round(width)), Math.max(1, Math.round(height)))
      .then(canvas => { if (!cancelled) setErased(canvas); })
      .catch(() => { if (!cancelled) setErased(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer.src, layer.eraseElements, needsProcessing, width, height]);

  const image = needsProcessing ? erased : plainImage;
  if (!image) return null;
  return (
    <PlacedRasterImage
      nodeName={`ai-raster-layer ${layer.id}`}
      image={image}
      sourceIdentity={layer.src}
      sourceRevision={JSON.stringify(layer.eraseElements ?? [])}
      width={width}
      height={height}
      opacity={layer.opacity}
      placement={layer}
      adjustments={adjustments}
      interactive={interactive && layer.locked !== true}
      isSelected={isSelected}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
      onBeforeChange={pushHistory}
      onChange={updates => updateAiLayer(layer.id, updates, { history: false })}
      layerRef={{ id: layer.id, type: 'ai' }}
    />
  );
}

function BaseLayerNode({ doc, width, height, interactive, isSelected, onSelect, onContextMenu }: {
  doc: ImageDocument;
  width: number;
  height: number;
  interactive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: Konva.KonvaEventObject<PointerEvent>) => void;
}) {
  const updateBaseLayer = useStore(state => state.updateBaseLayer);
  const pushHistory = useStore(state => state.pushHistory);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const adjustments = doc.baseLayer?.adjustments;
  const eraseElements = doc.baseLayer?.eraseElements;
  const needsProcessing = (eraseElements?.length ?? 0) > 0;
  const plainImage = useImage(needsProcessing ? null : (doc.cleanup.committed ?? doc.originalSrc));

  useEffect(() => {
    if (!needsProcessing) { setCanvas(null); return; }
    let cancelled = false;
    void buildBaseCanvas({
      ...doc,
      baseLayer: doc.baseLayer ? { ...doc.baseLayer, adjustments: NEUTRAL_RASTER_ADJUSTMENTS } : doc.baseLayer,
    })
      .then(result => { if (!cancelled) setCanvas(result); })
      .catch(() => { if (!cancelled) setCanvas(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.originalSrc, doc.cleanup.committed, eraseElements, needsProcessing]);

  const image = needsProcessing ? canvas : plainImage;
  if (!image) return null;
  const state = doc.baseLayer;
  return (
    <PlacedRasterImage
      nodeName="base-image"
      image={image}
      sourceIdentity={doc.cleanup.committed ?? doc.originalSrc}
      sourceRevision={JSON.stringify(eraseElements ?? [])}
      width={width}
      height={height}
      opacity={state?.opacity ?? 1}
      placement={state ?? {}}
      adjustments={adjustments}
      interactive={interactive && state?.locked === false}
      isSelected={isSelected}
      onSelect={onSelect}
      onContextMenu={onContextMenu}
      onBeforeChange={pushHistory}
      onChange={updates => updateBaseLayer(updates, { history: false })}
      layerRef={{ id: state?.id ?? `base-${doc.id}`, type: 'base' }}
    />
  );
}

function MaskOverlayNode({ elements, strokes, width, height, opacity }: { elements?: MaskElement[]; strokes: StrokeData[]; width: number; height: number; opacity: number }) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(width)); next.height = Math.max(1, Math.round(height));
      const ctx = next.getContext('2d'); if (!ctx) return;
      const items = elements?.length ? elements : strokes.map(stroke => ({ type: 'brush', stroke }) as MaskElement);
      for (const element of items) {
        ctx.save(); ctx.fillStyle = ctx.strokeStyle = 'rgb(255, 128, 0)';
        if (element.type === 'brush') {
          drawBrushStroke(ctx, element.stroke, width, height, { color: 'rgb(255, 128, 0)' });
        } else if (element.type === 'polygon') {
          // 'erase' polygons must punch holes in the orange preview, matching buildCleanupMask.
          ctx.globalCompositeOperation = element.mode === 'erase' ? 'destination-out' : 'source-over';
          ctx.beginPath(); for (let index = 0; index < element.points.length; index += 2) { const x = element.points[index] * width, y = element.points[index + 1] * height; if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.fill();
        } else {
          const bitmap = new window.Image(); bitmap.crossOrigin = 'anonymous'; await new Promise<void>((resolve, reject) => { bitmap.onload = () => resolve(); bitmap.onerror = reject; bitmap.src = element.src; });
          const tinted = document.createElement('canvas'); tinted.width = next.width; tinted.height = next.height; const tintedCtx = tinted.getContext('2d')!;
          tintedCtx.drawImage(bitmap, 0, 0, next.width, next.height); tintedCtx.globalCompositeOperation = 'source-in'; tintedCtx.fillStyle = 'rgb(255, 128, 0)'; tintedCtx.fillRect(0, 0, next.width, next.height);
          // 'erase' bitmaps subtract from the preview instead of adding to it.
          ctx.globalCompositeOperation = element.mode === 'erase' ? 'destination-out' : 'source-over';
          ctx.drawImage(tinted, 0, 0);
        }
        ctx.restore();
      }
      if (!cancelled) setCanvas(next);
    })();
    return () => { cancelled = true; };
  }, [elements, strokes, width, height]);
  return canvas ? <KonvaImage image={canvas} width={width} height={height} opacity={opacity} listening={false} /> : null;
}

function WatermarkNode({
  wm,
  docWidth,
  docHeight,
  previewScale,
  isSelected,
  onSelect,
  onChange,
  onBeforeChange,
}: {
  wm: WatermarkObject;
  docWidth: number;
  docHeight: number;
  previewScale: number;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<WatermarkObject>) => void;
  onBeforeChange: () => void;
}) {
  const nodeRef = useRef<Konva.Text | Konva.Image | null>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const logoImg = useImage(wm.type === 'image' ? wm.imageSrc : null);

  useEffect(() => {
    if (isSelected && !wm.locked && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, wm.locked]);

  const pW = docWidth * previewScale;
  const pH = docHeight * previewScale;
  const x = wm.x * pW;
  const y = wm.y * pH;
  const opacity = wm.opacity;

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ x: e.target.x() / pW, y: e.target.y() / pH });
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const node = nodeRef.current;
    if (!node) return;
    onChange({
      x: node.x() / pW,
      y: node.y() / pH,
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: node.rotation(),
    });
  };

  if (!wm.visible) return null;

  const commonProps = {
    x,
    y,
    scaleX: wm.scaleX,
    scaleY: wm.scaleY,
    rotation: wm.rotation,
    opacity,
    draggable: !wm.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragStart: wm.locked ? undefined : onBeforeChange,
    onTransformStart: wm.locked ? undefined : onBeforeChange,
    onDragEnd: handleDragEnd,
    onTransformEnd: handleTransformEnd,
    offsetX: 0,
    offsetY: 0,
  };

  // Keep the logo's natural aspect ratio — width is a fraction of doc width,
  // height is derived from the image itself so it never stretches.
  const logoW = (wm.imageWidth ?? 0.25) * pW;
  const logoH = logoImg && logoImg.naturalWidth > 0
    ? logoW * (logoImg.naturalHeight / logoImg.naturalWidth)
    : (wm.imageHeight ?? 0.12) * pH;

  return (
    <>
      {wm.type === 'text' ? (
        <Text
          {...commonProps}
          ref={nodeRef as React.RefObject<Konva.Text>}
          text={wm.text ?? ''}
          fontFamily={wm.fontFamily ?? 'Arial'}
          fontSize={(wm.fontSize ?? 0.06) * docHeight * previewScale}
          fill={wm.fill ?? '#ffffff'}
        />
      ) : logoImg ? (
        <KonvaImage
          {...commonProps}
          ref={nodeRef as React.RefObject<Konva.Image>}
          image={logoImg}
          width={logoW}
          height={logoH}
        />
      ) : null}
      {isSelected && !wm.locked && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) return oldBox;
            return newBox;
          }}
          rotateEnabled
          keepRatio
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
        />
      )}
    </>
  );
}

function TextNode({
  txt,
  docWidth,
  docHeight,
  previewScale,
  isSelected,
  isEditing,
  onSelect,
  onChange,
  onBeforeChange,
  onEditRequest,
  onContextMenu,
}: {
  txt: TextObject;
  docWidth: number;
  docHeight: number;
  previewScale: number;
  isSelected: boolean;
  /** While the inline editor is open, the Konva node is hidden to avoid a "ghost" copy under the textarea. */
  isEditing: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<TextObject>) => void;
  onBeforeChange: () => void;
  onEditRequest: () => void;
  onContextMenu: (e: Konva.KonvaEventObject<PointerEvent>) => void;
}) {
  const nodeRef = useRef<Konva.Text>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && !isEditing && !txt.locked && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, isEditing, txt.locked]);

  const pW = docWidth * previewScale;
  const pH = docHeight * previewScale;
  const textNodeConfig = createTextNodeConfig(txt, docWidth, docHeight, previewScale);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ x: e.target.x() / pW, y: e.target.y() / pH });
  };

  const handleTransformEnd = () => {
    const node = nodeRef.current;
    if (!node) return;
    onChange({
      x: node.x() / pW,
      y: node.y() / pH,
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      rotation: node.rotation(),
    });
  };

  if (!txt.visible) return null;

  return (
    <>
      <Text
        {...textNodeConfig}
        ref={nodeRef}
        visible={!isEditing}
        listening={!isEditing}
        draggable={!txt.locked}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={onEditRequest}
        onDblTap={onEditRequest}
        onContextMenu={onContextMenu}
        onDragStart={txt.locked ? undefined : onBeforeChange}
        onTransformStart={txt.locked ? undefined : onBeforeChange}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
      {isSelected && !isEditing && !txt.locked && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) return oldBox;
            return newBox;
          }}
          rotateEnabled
          keepRatio
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
        />
      )}
    </>
  );
}

function TranslationMaskNode({ mask, docWidth, docHeight, previewScale, isSelected, onSelect, onBeforeChange, onChange, onContextMenu }: {
  mask: TranslationMaskObject;
  docWidth: number;
  docHeight: number;
  previewScale: number;
  isSelected: boolean;
  onSelect: () => void;
  onBeforeChange: () => void;
  onChange: (updates: Partial<TranslationMaskObject>, moveGroup?: boolean) => void;
  onContextMenu: (event: Konva.KonvaEventObject<PointerEvent>) => void;
}) {
  const nodeRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const width = mask.width * docWidth * previewScale;
  const height = mask.height * docHeight * previewScale;
  useEffect(() => {
    if (isSelected && !mask.locked && nodeRef.current && transformerRef.current) {
      transformerRef.current.nodes([nodeRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, mask.locked]);
  if (!mask.visible) return null;
  const common = {
    width,
    height,
    fill: mask.fill,
    opacity: mask.opacity,
    shadowColor: mask.fill,
    shadowBlur: mask.feather * previewScale,
    shadowOpacity: Math.min(1, mask.opacity * 0.75),
    shadowForStrokeEnabled: false,
    listening: false,
  };
  return (
    <>
      <Group
        ref={nodeRef}
        x={mask.x * docWidth * previewScale}
        y={mask.y * docHeight * previewScale}
        rotation={mask.rotation}
        scaleX={mask.scaleX}
        scaleY={mask.scaleY}
        draggable={!mask.locked}
        onClick={onSelect}
        onTap={onSelect}
        onContextMenu={onContextMenu}
        onDragStart={onBeforeChange}
        onTransformStart={onBeforeChange}
        onDragEnd={event => onChange({
          x: event.target.x() / (docWidth * previewScale),
          y: event.target.y() / (docHeight * previewScale),
        }, true)}
        onTransformEnd={() => {
          const node = nodeRef.current;
          if (!node) return;
          onChange({
            x: node.x() / (docWidth * previewScale),
            y: node.y() / (docHeight * previewScale),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            rotation: node.rotation(),
          });
        }}
      >
        {mask.shape === 'ellipse' ? <Ellipse {...common} x={width / 2} y={height / 2} radiusX={width / 2} radiusY={height / 2} />
          : mask.shape === 'polygon' ? <Line points={(mask.points?.length ? mask.points : [0, 0, 1, 0, 1, 1, 0, 1]).map((value, index) => value * (index % 2 === 0 ? width : height))} closed fill={mask.fill} opacity={mask.opacity} shadowColor={mask.fill} shadowBlur={mask.feather * previewScale} listening={false} />
            : <Rect {...common} cornerRadius={mask.shape === 'rounded-rect' ? Math.min(width, height) * 0.12 : 0} />}
      </Group>
      {isSelected && !mask.locked && <Transformer ref={transformerRef} rotateEnabled keepRatio={false} />}
    </>
  );
}

function ShapeNode({
  shape,
  docWidth,
  docHeight,
  previewScale,
  isSelected,
  onSelect,
  onChange,
  onBeforeChange,
}: {
  shape: ShapeObject;
  docWidth: number;
  docHeight: number;
  previewScale: number;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updates: Partial<ShapeObject>) => void;
  onBeforeChange: () => void;
}) {
  const nodeRef = useRef<Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && !shape.locked && trRef.current && nodeRef.current) {
      trRef.current.nodes([nodeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, shape.locked]);

  const pW = docWidth * previewScale;
  const pH = docHeight * previewScale;
  const w = shape.width * pW;
  const h = shape.height * pH;
  const cx = shape.x * pW;
  const cy = shape.y * pH;
  const strokeW = shape.strokeWidth * previewScale;

  if (!shape.visible) return null;

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange({ x: e.target.x() / pW, y: e.target.y() / pH });
  };

  const handleTransformEnd = () => {
    const node = nodeRef.current;
    if (!node) return;
    const nextWidth = Math.max(0.005, shape.width * Math.abs(node.scaleX()));
    const nextHeight = Math.max(0.005, shape.height * Math.abs(node.scaleY()));
    node.scaleX(1);
    node.scaleY(1);
    onChange({
      x: node.x() / pW,
      y: node.y() / pH,
      width: nextWidth,
      height: nextHeight,
      scaleX: 1,
      scaleY: 1,
      rotation: node.rotation(),
    });
  };

  const groupProps = {
    x: cx,
    y: cy,
    rotation: shape.rotation,
    scaleX: shape.scaleX,
    scaleY: shape.scaleY,
    opacity: shape.opacity,
    draggable: !shape.locked,
    onClick: onSelect,
    onTap: onSelect,
    onDragStart: shape.locked ? undefined : onBeforeChange,
    onTransformStart: shape.locked ? undefined : onBeforeChange,
    onDragEnd: handleDragEnd,
    onTransformEnd: handleTransformEnd,
  };

  const bounds = { x: -w / 2, y: -h / 2, width: w, height: h };
  const fillStyle = shape.fillStyle ?? { type: 'solid' as const, color: shape.fill || 'transparent' };
  const strokeFallback = shape.stroke === '' ? 'transparent' : shape.stroke || '#000000';
  const strokeStyle = shape.strokeStyle ?? { type: 'solid' as const, color: strokeFallback };
  const dash = shape.lineStyle === 'dashed'
    ? [12 * previewScale, 8 * previewScale]
    : shape.lineStyle === 'dotted'
      ? [2 * previewScale, 7 * previewScale]
      : undefined;
  const geometry = getShapeGeometry(
    shape.kind,
    w,
    h,
    shape.curve ?? 0.35,
    shape.cornerRadius * previewScale,
  );
  const open = isOpenShape(shape.kind);
  const node = (
    <>
      {geometry.strokePath && (
        <PaintedShape
          data={geometry.strokePath}
          bounds={bounds}
          strokeStyle={strokeStyle}
          fallbackStroke={strokeFallback}
          strokeWidth={strokeW}
          glow={shape.glow}
          glowScale={previewScale}
          dash={dash}
          dashEnabled={Boolean(dash)}
          hitStrokeWidth={open ? Math.max(16, strokeW) : undefined}
        />
      )}
      {geometry.fillPath && (
        <PaintedShape
          data={geometry.fillPath}
          bounds={bounds}
          fillStyle={open ? strokeStyle : fillStyle}
          strokeStyle={open ? undefined : strokeStyle}
          fallbackFill={open ? strokeFallback : shape.fill}
          fallbackStroke={open ? '' : strokeFallback}
          strokeWidth={open ? 0 : strokeW}
          glow={shape.glow}
          glowScale={previewScale}
        />
      )}
    </>
  );

  const curve = shape.curve ?? 0.35;
  const curveHandle = getCurvedArrowHandlePosition(
    cx,
    cy,
    h,
    curve,
    shape.rotation,
  );

  return (
    <>
      <Group ref={nodeRef} {...groupProps}>
        {node}
      </Group>
      {isSelected && !shape.locked && shape.kind === 'curved-arrow' && (
        <Circle
          x={curveHandle.x}
          y={curveHandle.y}
          radius={8}
          fill="#ff6b6b"
          stroke="#ffffff"
          strokeWidth={2}
          hitStrokeWidth={18}
          draggable
          onDragStart={event => {
            event.cancelBubble = true;
            onBeforeChange();
          }}
          onDragMove={event => {
            event.cancelBubble = true;
            onChange({
              curve: getCurvedArrowCurveFromHandle(
                cx,
                cy,
                h,
                shape.rotation,
                event.target.x(),
                event.target.y(),
              ),
            });
          }}
          onClick={event => { event.cancelBubble = true; }}
        />
      )}
      {isSelected && !shape.locked && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) return oldBox;
            return newBox;
          }}
          rotateEnabled
          keepRatio={false}
          enabledAnchors={[
            'top-left', 'top-center', 'top-right',
            'middle-left', 'middle-right',
            'bottom-left', 'bottom-center', 'bottom-right',
          ]}
        />
      )}
    </>
  );
}

/** Crop overlay: darkens everything outside the crop rect; rect is draggable/resizable */
function CropOverlay({
  cropRect,
  imgW,
  imgH,
  onChange,
  keepRatio,
}: {
  cropRect: CropRect;
  imgW: number;
  imgH: number;
  onChange: (rect: CropRect) => void;
  keepRatio: boolean;
}) {
  const rectRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (trRef.current && rectRef.current) {
      trRef.current.nodes([rectRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, []);

  const rx = cropRect.x * imgW;
  const ry = cropRect.y * imgH;
  const rw = cropRect.width * imgW;
  const rh = cropRect.height * imgH;

  const clamp = (x: number, y: number, w: number, h: number): CropRect => {
    const cw = Math.max(0.02, Math.min(1, w / imgW));
    const ch = Math.max(0.02, Math.min(1, h / imgH));
    const cx = Math.max(0, Math.min(1 - cw, x / imgW));
    const cy = Math.max(0, Math.min(1 - ch, y / imgH));
    return { x: cx, y: cy, width: cw, height: ch };
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    onChange(clamp(e.target.x(), e.target.y(), rw, rh));
  };

  const handleTransformEnd = () => {
    const node = rectRef.current;
    if (!node) return;
    const newW = node.width() * node.scaleX();
    const newH = node.height() * node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    onChange(clamp(node.x(), node.y(), newW, newH));
  };

  return (
    <>
      {/* Dark veil outside the crop area (4 rects) */}
      <Rect x={0} y={0} width={imgW} height={ry} fill="rgba(0,0,0,0.6)" listening={false} />
      <Rect x={0} y={ry + rh} width={imgW} height={Math.max(0, imgH - ry - rh)} fill="rgba(0,0,0,0.6)" listening={false} />
      <Rect x={0} y={ry} width={rx} height={rh} fill="rgba(0,0,0,0.6)" listening={false} />
      <Rect x={rx + rw} y={ry} width={Math.max(0, imgW - rx - rw)} height={rh} fill="rgba(0,0,0,0.6)" listening={false} />
      {/* Crop rect */}
      <Rect
        ref={rectRef}
        x={rx}
        y={ry}
        width={rw}
        height={rh}
        stroke="#5e9fe8"
        strokeWidth={2}
        dash={[8, 4]}
        fill="rgba(94,159,232,0.05)"
        draggable
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        keepRatio={keepRatio}
        boundBoxFunc={(oldBox, newBox) => {
          if (newBox.width < 20 || newBox.height < 20) return oldBox;
          return newBox;
        }}
      />
    </>
  );
}

export function CanvasArea() {
  const {
    documents, activeDocIndex, setActiveDoc,
    activeTool, setActiveTool, cleanupSettings, blurSettings,
        addStroke, addMaskStroke, addMaskElement, addEraseElement, updateWatermark, updateText, updateTranslationMask, updateShape, updateBubble,
    selectLayer, updateCleanupSettings,
    selectedObject, setSelectedObject,
    inlineEditingTextId, setInlineEditingTextId,
    textSettings, addText,
    layerVisibility,
    viewport, setViewport,
    addDocuments,
    pushHistory, setLeftTab,
    fontsVersion, cropRect, cropSettings, setCropRect, updateDocumentThumbnail,
    layerCropTarget, applyLayerCrop, cancelLayerCrop,
  } = useStore(useShallow(state => ({
    documents: state.documents,
    activeDocIndex: state.activeDocIndex,
    setActiveDoc: state.setActiveDoc,
    activeTool: state.activeTool,
    setActiveTool: state.setActiveTool,
    cleanupSettings: state.cleanupSettings,
    blurSettings: state.blurSettings,
    addStroke: state.addStroke,
    addMaskStroke: state.addMaskStroke,
    addMaskElement: state.addMaskElement,
    addEraseElement: state.addEraseElement,
    updateWatermark: state.updateWatermark,
    updateText: state.updateText,
    updateTranslationMask: state.updateTranslationMask,
    updateShape: state.updateShape,
    updateBubble: state.updateBubble,
    selectLayer: state.selectLayer,
    updateCleanupSettings: state.updateCleanupSettings,
    selectedObject: state.selectedObject,
    setSelectedObject: state.setSelectedObject,
    inlineEditingTextId: state.inlineEditingTextId,
    setInlineEditingTextId: state.setInlineEditingTextId,
    textSettings: state.textSettings,
    addText: state.addText,
    layerVisibility: state.layerVisibility,
    viewport: state.viewport,
    setViewport: state.setViewport,
    addDocuments: state.addDocuments,
    pushHistory: state.pushHistory,
    setLeftTab: state.setLeftTab,
    fontsVersion: state.fontsVersion,
    cropRect: state.cropRect,
    cropSettings: state.cropSettings,
    setCropRect: state.setCropRect,
    updateDocumentThumbnail: state.updateDocumentThumbnail,
    layerCropTarget: state.layerCropTarget,
    applyLayerCrop: state.applyLayerCrop,
    cancelLayerCrop: state.cancelLayerCrop,
  })));
  const activeOperation = useEditorUiStore(state => state.activeOperation);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const isPainting = useRef(false);
  const currentStroke = useRef<number[]>([]);
  const strokeId = useRef<string>('');
  // Live stroke rendered imperatively (no React re-renders while drawing)
  const liveLineRef = useRef<Konva.Line>(null);
  const livePoints = useRef<number[]>([]);
  const pendingBrushPoints = useRef<number[]>([]);
  const brushFrameRef = useRef<number | null>(null);
  const lastBrushPointRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerTargetRef = useRef<HTMLElement | null>(null);
  const textPointerGestureRef = useRef<TextPointerGesture | null>(null);
  const textPointerTargetRef = useRef<HTMLElement | null>(null);
  const textDraftFrameRef = useRef<number | null>(null);
  const isEffectPainting = useRef(false);
  const effectPointsRef = useRef<number[]>([]);
  const effectBusyRef = useRef(false);
  const finishPointerRef = useRef<(() => void) | null>(null);
  const finishTextPointerRef = useRef<((event?: PointerEvent) => void) | null>(null);
  const cancelTextPointerRef = useRef<(() => void) | null>(null);
  const thumbnailTimerRef = useRef<number | null>(null);
  const thumbnailIdleRef = useRef<number | null>(null);
  const isLassoing = useRef(false);
  const lassoPoints = useRef<number[]>([]);
  // Polygonal lasso: vertices are placed by clicks, closed by Enter/double
  // click/clicking the first vertex. Points are normalized to the document.
  const isPolyLassoing = useRef(false);
  const polyLassoPoints = useRef<number[]>([]);
  // Latest preview-pixel size for handlers registered once (keyboard).
  const imgSizeRef = useRef({ w: 1, h: 1 });
  const liveLassoRef = useRef<Konva.Line>(null);
  // Rectangular selection (rectSelect)
  const isRectSelecting = useRef(false);
  const rectStart = useRef({ x: 0, y: 0 });
  const rectCurrent = useRef({ x: 0, y: 0 });
  const liveRectRef = useRef<Konva.Rect>(null);
  // Tracks whether the currently-open inline text editor was just created (click-to-place)
  const isNewTextRef = useRef(false);
  // Brush cursor updated imperatively via DOM
  const cursorRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [wandPending, setWandPending] = useState<{ documentId: string; maskId: string; elementId: string; coverage: number } | null>(null);
  const [wandInfo, setWandInfo] = useState<string | null>(null);
  const [clipboardInfo, setClipboardInfo] = useState<string | null>(null);
  const [pendingImageImport, setPendingImageImport] = useState<PendingImageImport | null>(null);
  const [rememberImportChoice, setRememberImportChoice] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [textDraftRect, setTextDraftRect] = useState<TextDraftRect | null>(null);
  const [pendingTextDraft, setPendingTextDraft] = useState<PendingTextDraft | null>(null);
  const [textEditorOverflowing, setTextEditorOverflowing] = useState(false);
  const shiftPressedRef = useRef(false);
  const checkerPattern = useRef<HTMLCanvasElement | null>(null);
  if (typeof document !== 'undefined' && !checkerPattern.current) checkerPattern.current = makeCheckerPattern();

  // Auto-hide the coverage info chip
  useEffect(() => {
    if (!wandInfo) return;
    const timer = window.setTimeout(() => setWandInfo(null), 2500);
    return () => window.clearTimeout(timer);
  }, [wandInfo]);

  // Auto-hide the copy/paste info chip
  useEffect(() => {
    if (!clipboardInfo) return;
    const timer = window.setTimeout(() => setClipboardInfo(null), 2600);
    return () => window.clearTimeout(timer);
  }, [clipboardInfo]);

  const cancelScheduledThumbnail = useCallback(() => {
    if (thumbnailTimerRef.current !== null) {
      window.clearTimeout(thumbnailTimerRef.current);
      thumbnailTimerRef.current = null;
    }
    const cancelIdle = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (thumbnailIdleRef.current !== null && cancelIdle) cancelIdle(thumbnailIdleRef.current);
    thumbnailIdleRef.current = null;
  }, []);

  const scheduleThumbnailUpdate = useCallback((documentId: string) => {
    const idleWindow = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    cancelScheduledThumbnail();
    thumbnailTimerRef.current = window.setTimeout(() => {
      thumbnailTimerRef.current = null;
      const update = () => {
        thumbnailIdleRef.current = null;
        const latest = useStore.getState();
        if (latest.documents[latest.activeDocIndex]?.id !== documentId) return;
        const stage = stageRef.current;
        if (!stage) return;
        const scale = Math.min(1, 160 / Math.max(stage.width(), stage.height()));
        updateDocumentThumbnail(documentId, stage.toDataURL({ pixelRatio: scale }));
      };
      if (idleWindow.requestIdleCallback) {
        thumbnailIdleRef.current = idleWindow.requestIdleCallback(update, { timeout: 1200 });
      } else {
        window.setTimeout(update, 0);
      }
    }, 450);
  }, [cancelScheduledThumbnail, updateDocumentThumbnail]);

  useEffect(() => cancelScheduledThumbnail, [cancelScheduledThumbnail]);
  useEffect(() => {
    cancelScheduledThumbnail();
  }, [activeDocIndex, cancelScheduledThumbnail]);

  const activeDoc = activeDocIndex >= 0 ? documents[activeDocIndex] : null;
  const baseReplaced = activeDoc?.aiLayers.some(layer => layer.visible && layer.replacesBase) ?? false;

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Compute preview scale and stage offset
  const previewScale = activeDoc
    ? scaleToFit(activeDoc.width, activeDoc.height, MAX_PREVIEW_SIDE)
    : 1;
  const imgW = activeDoc ? activeDoc.width * previewScale : 0;
  const imgH = activeDoc ? activeDoc.height * previewScale : 0;

  useEffect(() => {
    imgSizeRef.current = { w: Math.max(1, imgW), h: Math.max(1, imgH) };
  }, [imgW, imgH]);

  // Polygonal lasso helpers. Stable identities (used by once-registered
  // keyboard handlers); store access goes through getState().
  const cancelPolyLasso = useCallback(() => {
    if (!isPolyLassoing.current && polyLassoPoints.current.length === 0) return;
    isPolyLassoing.current = false;
    polyLassoPoints.current = [];
    const line = liveLassoRef.current;
    if (line) { line.points([]); line.visible(false); line.getLayer()?.batchDraw(); }
  }, []);

  const finishPolyLasso = useCallback((mode: 'replace' | 'add' | 'subtract') => {
    const points = [...polyLassoPoints.current];
    cancelPolyLasso();
    if (points.length >= 6) {
      useStore.getState().addMaskElement(
        { type: 'polygon', points, mode: mode === 'subtract' ? 'erase' : 'add' },
        { replace: mode === 'replace' }
      );
    }
  }, [cancelPolyLasso]);

  // Leaving the tool or switching pages mid-polygon cancels the contour.
  useEffect(() => {
    if (activeTool !== 'polyLasso') cancelPolyLasso();
  }, [activeTool, cancelPolyLasso]);

  // Every tool switch must remove imperative preview graphics. These nodes
  // live only in the editor overlay and are never serialized into layer pixels.
  useEffect(() => {
    isPainting.current = false;
    isEffectPainting.current = false;
    effectPointsRef.current = [];
    currentStroke.current = [];
    pendingBrushPoints.current = [];
    livePoints.current = [];
    isLassoing.current = false;
    lassoPoints.current = [];
    isRectSelecting.current = false;
    liveLineRef.current?.setAttrs({ points: [], visible: false });
    liveLassoRef.current?.setAttrs({ points: [], visible: false });
    liveRectRef.current?.setAttrs({ visible: false });
    liveLineRef.current?.getLayer()?.batchDraw();
    liveLassoRef.current?.getLayer()?.batchDraw();
  }, [activeTool]);

  useEffect(() => {
    const cancelTransient = () => {
      cancelPolyLasso();
      isPainting.current = false;
      isEffectPainting.current = false;
      effectPointsRef.current = [];
      currentStroke.current = [];
      pendingBrushPoints.current = [];
      livePoints.current = [];
      isLassoing.current = false;
      lassoPoints.current = [];
      isRectSelecting.current = false;
      liveLineRef.current?.setAttrs({ points: [], visible: false });
      liveLassoRef.current?.setAttrs({ points: [], visible: false });
      liveRectRef.current?.setAttrs({ visible: false });
      liveLineRef.current?.getLayer()?.batchDraw();
      liveLassoRef.current?.getLayer()?.batchDraw();
    };
    window.addEventListener('manga-editor-cancel-transient', cancelTransient);
    return () => window.removeEventListener('manga-editor-cancel-transient', cancelTransient);
  }, [cancelPolyLasso]);
  useEffect(() => {
    cancelPolyLasso();
  }, [activeDocIndex, cancelPolyLasso]);

  // Fit to screen
  const fitToScreen = useCallback(() => {
    if (!activeDoc || containerSize.w === 0 || containerSize.h === 0) return;
    const scale = Math.min(
      (containerSize.w - 40) / imgW,
      (containerSize.h - 40) / imgH,
      1
    );
    const x = (containerSize.w - imgW * scale) / 2;
    const y = (containerSize.h - imgH * scale) / 2;
    setViewport({ x, y, scale });
  }, [activeDoc, containerSize, imgW, imgH, setViewport]);

  // Auto-fit on document change
  useEffect(() => { fitToScreen(); }, [activeDocIndex]);

  useEffect(() => () => {
    if (brushFrameRef.current !== null) window.cancelAnimationFrame(brushFrameRef.current);
    if (textDraftFrameRef.current !== null) window.cancelAnimationFrame(textDraftFrameRef.current);
  }, []);

  // ── Native pointermove for zero-lag brush cursor circle ──────────────────
  // Runs at the native pointer rate, never through React state or Konva.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: PointerEvent) => {
      const cursor = cursorRef.current;
      if (!cursor) return;
      const store = useStore.getState();
      const tool = store.activeTool;
      if (tool !== 'brush' && tool !== 'maskBrush' && tool !== 'eraser' && tool !== 'blur') {
        if (cursor.style.display !== 'none') cursor.style.display = 'none';
        return;
      }
      const rect = container.getBoundingClientRect();
      const posX = e.clientX - rect.left;
      const posY = e.clientY - rect.top;
      const doc = store.documents[store.activeDocIndex];
      const vp = store.viewport;
      const docH = doc?.height ?? 1000;
      const ps = doc ? Math.min(1, 1800 / Math.max(doc.width, doc.height)) : 1;
      const size = tool === 'blur' ? store.blurSettings.brushSize : store.cleanupSettings.brushSize;
      const rad = (size * docH * ps * vp.scale) / 2;
      const d = rad * 2;
      cursor.style.display = 'block';
      cursor.style.width = `${d}px`;
      cursor.style.height = `${d}px`;
      cursor.style.transform = `translate3d(${posX - rad}px, ${posY - rad}px, 0)`;
    };
    const leave = () => { if (cursorRef.current) cursorRef.current.style.display = 'none'; };
    container.addEventListener('pointermove', handler, { passive: true });
    container.addEventListener('pointerleave', leave, { passive: true });
    return () => {
      container.removeEventListener('pointermove', handler);
      container.removeEventListener('pointerleave', leave);
    };
  }, []);

  // Wheel zoom
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = viewport.scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleFactor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.05, Math.min(8, oldScale * scaleFactor));
    const mousePointTo = {
      x: (pointer.x - viewport.x) / oldScale,
      y: (pointer.y - viewport.y) / oldScale,
    };
    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  // Pan with space+drag
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panVpStart = useRef({ x: 0, y: 0 });

  const flushBrushPreview = () => {
    brushFrameRef.current = null;
    const pending = pendingBrushPoints.current;
    if (!pending.length) return;
    for (let index = 0; index < pending.length; index += 2) {
      const x = pending[index];
      const y = pending[index + 1];
      currentStroke.current.push(x, y);
      livePoints.current.push(x * imgW, y * imgH);
    }
    pendingBrushPoints.current = [];
    const line = liveLineRef.current;
    if (line) {
      line.points(livePoints.current);
      line.getLayer()?.batchDraw();
    }
  };

  const queueBrushPoint = (point: { x: number; y: number }) => {
    const last = lastBrushPointRef.current;
    if (last) {
      const distancePx = Math.hypot(
        (point.x - last.x) * imgW * viewport.scale,
        (point.y - last.y) * imgH * viewport.scale,
      );
      if (distancePx < 1.25) return;
    }
    lastBrushPointRef.current = point;
    pendingBrushPoints.current.push(point.x, point.y);
    if (brushFrameRef.current === null) {
      brushFrameRef.current = window.requestAnimationFrame(flushBrushPreview);
    }
  };

  const applyEffectPreview = (points?: number[]) => {
    if (effectBusyRef.current) return;
    effectBusyRef.current = true;
    void applyRasterEffectPreview(points).then(() => {
      beginEditorOperation('blur', blurSettings.mode === 'pixelate' ? 'Пикселизация' : blurSettings.mode === 'noise' ? 'Шум' : 'Размытие', {
        commit: () => setClipboardInfo('Эффект применён'),
        cancel: () => useStore.getState().rollbackPendingHistory(),
      });
      setClipboardInfo('Превью эффекта · Enter применить, Esc отменить');
    }).catch(error => setClipboardInfo(error instanceof Error ? error.message : 'Не удалось применить эффект'))
      .finally(() => { effectBusyRef.current = false; });
  };

  const clearTextGeometryDraft = () => {
    if (textDraftFrameRef.current !== null) {
      window.cancelAnimationFrame(textDraftFrameRef.current);
      textDraftFrameRef.current = null;
    }
    const gesture = textPointerGestureRef.current;
    if (gesture) {
      try { textPointerTargetRef.current?.releasePointerCapture(gesture.pointerId); } catch { /* already released */ }
    }
    textPointerGestureRef.current = null;
    textPointerTargetRef.current = null;
    setTextDraftRect(null);
  };

  const clearTextDraftState = () => {
    setTextEditorOverflowing(false);
    clearTextGeometryDraft();
    setPendingTextDraft(null);
    setInlineEditingTextId(null);
    isNewTextRef.current = false;
  };

  const cancelTextDraft = () => {
    if (!pendingTextDraft && !textPointerGestureRef.current) return;
    clearTextDraftState();
  };

  const commitTextDraft = (value: string) => {
    if (!pendingTextDraft) return;
    const store = useStore.getState();
    const currentDocument = store.documents[store.activeDocIndex];
    if (currentDocument?.id !== pendingTextDraft.documentId) {
      cancelTextDraft();
      return;
    }
    if (value.trim().length === 0) {
      cancelTextDraft();
      return;
    }

    if (pendingTextDraft.original) {
      pushHistory();
      updateText(pendingTextDraft.id, { text: value }, { history: false });
    } else {
      // addText owns the creation snapshot, so adding another pushHistory here
      // would make a single text creation require two undo operations.
      addText({ ...pendingTextDraft.object, text: value });
    }
    setSelectedObject({ type: 'text', id: pendingTextDraft.id });
    setActiveTool('select');
    clearTextDraftState();
  };

  const nativeTextPoint = (event: PointerEvent) => {
    const stage = stageRef.current;
    if (!stage || !activeDoc) return null;
    const bounds = stage.container().getBoundingClientRect();
    const screenPoint = {
      x: (event.clientX - bounds.left) * stage.width() / Math.max(1, bounds.width),
      y: (event.clientY - bounds.top) * stage.height() / Math.max(1, bounds.height),
    };
    const imagePoint = screenToImage(screenPoint, { viewport, imageWidth: imgW, imageHeight: imgH });
    if (!imagePoint) return null;
    return { x: imagePoint.x * activeDoc.width, y: imagePoint.y * activeDoc.height };
  };

  const queueTextGeometry = (end: { x: number; y: number }) => {
    const gesture = textPointerGestureRef.current;
    if (!gesture || !activeDoc) return;
    if (gesture.documentId !== activeDoc.id) {
      clearTextGeometryDraft();
      return;
    }
    gesture.end = end;
    if (textDraftFrameRef.current !== null) return;
    textDraftFrameRef.current = window.requestAnimationFrame(() => {
      textDraftFrameRef.current = null;
      const latest = textPointerGestureRef.current;
      if (!latest) return;
      setTextDraftRect(createTextDraftRect(latest.start, latest.end, activeDoc, 5));
    });
  };

  const finishTextGeometryDraft = (event?: PointerEvent) => {
    const gesture = textPointerGestureRef.current;
    if (!gesture || !activeDoc) return false;
    if (gesture.documentId !== activeDoc.id) {
      clearTextGeometryDraft();
      return false;
    }
    const end = event ? nativeTextPoint(event) ?? gesture.end : gesture.end;
    const rect = createTextDraftRect(gesture.start, end, activeDoc, 5);
    clearTextGeometryDraft();

    const id = uid();
    const object: TextObject = {
      id,
      text: textSettings.draftText,
      fontFamily: textSettings.fontFamily,
      fontSize: textSettings.fontSize,
      fill: textSettings.fill,
      stroke: textSettings.stroke,
      strokeWidth: textSettings.strokeWidth,
      shadowColor: textSettings.shadowColor,
      shadowBlur: textSettings.shadowBlur,
      shadowOffsetX: textSettings.shadowOffsetX,
      shadowOffsetY: textSettings.shadowOffsetY,
      lineHeight: textSettings.lineHeight,
      align: textSettings.align,
      bold: textSettings.bold,
      italic: textSettings.italic,
      vertical: textSettings.vertical,
      textMode: rect.mode,
      width: rect.mode === 'point' ? textSettings.width : rect.width,
      height: rect.height,
      x: rect.x,
      y: rect.y,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      visible: true,
    };
    setTextEditorOverflowing(false);
    setPendingTextDraft({ documentId: gesture.documentId, id, object });
    isNewTextRef.current = true;
    setInlineEditingTextId(id);
    return true;
  };
  finishTextPointerRef.current = finishTextGeometryDraft;
  cancelTextPointerRef.current = clearTextGeometryDraft;

  useEffect(() => {
    if (activeTool !== 'text' && textPointerGestureRef.current) clearTextGeometryDraft();
  }, [activeTool]);

  useEffect(() => {
    if (pendingTextDraft && !inlineEditingTextId) {
      setTextEditorOverflowing(false);
      setPendingTextDraft(null);
    }
  }, [inlineEditingTextId, pendingTextDraft]);

  useEffect(() => {
    const activeDocumentId = activeDoc?.id;
    const gestureDocumentId = textPointerGestureRef.current?.documentId;
    const editorDocumentId = pendingTextDraft?.documentId;
    if ((gestureDocumentId && gestureDocumentId !== activeDocumentId)
      || (editorDocumentId && editorDocumentId !== activeDocumentId)) {
      clearTextDraftState();
    }
  }, [activeDoc?.id, pendingTextDraft?.documentId]);

  const handleMouseDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (textPointerGestureRef.current) return;
    if (activeTool === 'pan' || e.evt.button === 1) {
      isPanning.current = true;
      panStart.current = { x: e.evt.clientX, y: e.evt.clientY };
      panVpStart.current = { x: viewport.x, y: viewport.y };
      return;
    }
    if (activeTool === 'text' && activeDoc && e.evt.button === 0 && e.target.getClassName() !== 'Text') {
      const stage = stageRef.current;
      const position = stage?.getPointerPosition();
      const imagePoint = position && screenToImage(position, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (!imagePoint?.inside) return;
      if (pendingTextDraft) clearTextDraftState();

      const start = { x: imagePoint.x * activeDoc.width, y: imagePoint.y * activeDoc.height };
      textPointerGestureRef.current = { documentId: activeDoc.id, pointerId: e.evt.pointerId, start, end: start };
      setTextDraftRect(createTextDraftRect(start, start, activeDoc, 5));
      try {
        const target = e.evt.target as HTMLElement;
        target.setPointerCapture(e.evt.pointerId);
        textPointerTargetRef.current = target;
      } catch { /* capture is best-effort */ }
      return;
    }
    if (activeTool === 'blur' && activeDoc && e.evt.button === 0) {
      if (useEditorUiStore.getState().activeOperation?.kind === 'blur') {
        useEditorUiStore.getState().commitActiveOperation();
      }
      const position = stageRef.current?.getPointerPosition();
      const point = position && screenToImage(position, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (!point?.inside || effectBusyRef.current) return;
      if (blurSettings.gesture === 'area' || blurSettings.applyTo === 'selection') {
        applyEffectPreview();
      } else {
        isEffectPainting.current = true;
        effectPointsRef.current = [point.x, point.y];
        const line = liveLineRef.current;
        if (line) {
          line.setAttrs({
            points: [point.x * imgW, point.y * imgH],
            stroke: 'rgba(94,159,232,.65)',
            opacity: 1,
            strokeWidth: blurSettings.brushSize * activeDoc.height * previewScale,
            shadowBlur: (1 - blurSettings.hardness) * blurSettings.brushSize * activeDoc.height * previewScale * 0.5,
            shadowColor: '#5e9fe8',
            visible: true,
          });
          line.getLayer()?.batchDraw();
        }
      }
      return;
    }
    if ((activeTool === 'lasso' || activeTool === 'wand' || activeTool === 'rectSelect' || activeTool === 'polyLasso') && activeDoc) {
      const stage = stageRef.current; const pos = stage?.getPointerPosition();
      if (!pos) return;
      const imagePoint = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (!imagePoint?.inside) return;
      // Shift = add to selection, Alt = subtract (overrides the panel toggle)
      const mode: 'replace' | 'add' | 'subtract' = e.evt.altKey ? 'subtract' : e.evt.shiftKey ? 'add' : cleanupSettings.selectionMode;
      if (activeTool === 'polyLasso') {
        // Photoshop-style polygonal lasso: every click places a vertex; the
        // contour closes on double click or on a click near the first vertex
        // (Enter also closes — handled in the keyboard shortcuts).
        if (!isPolyLassoing.current) {
          isPolyLassoing.current = true;
          polyLassoPoints.current = [imagePoint.x, imagePoint.y];
        } else {
          const pts = polyLassoPoints.current;
          const closeDistPx = Math.hypot((imagePoint.x - pts[0]) * imgW, (imagePoint.y - pts[1]) * imgH) * viewport.scale;
          if (pts.length >= 6 && (closeDistPx < 12 || e.evt.detail >= 2)) {
            finishPolyLasso(mode);
            return;
          }
          pts.push(imagePoint.x, imagePoint.y);
        }
        const line = liveLassoRef.current;
        if (line) {
          line.points(polyLassoPoints.current.flatMap((value, index) => index % 2 === 0 ? value * imgW : value * imgH));
          line.visible(true);
          line.getLayer()?.batchDraw();
        }
        return;
      }
      if (activeTool === 'wand') {
        const originDocumentId = activeDoc.id;
        const originMaskId = activeDoc.activeMaskId;
        const originSelectedLayer = activeDoc.selectedLayer;
        void createFloodMask(activeDoc, imagePoint.x, imagePoint.y, cleanupSettings.magicThreshold, cleanupSettings.wandContiguous).then(({ src, coverage }) => {
          const elementId = `wand-${uid()}`;
          const beforeInsert = useStore.getState();
          const originDocument = beforeInsert.documents.find(document => document.id === originDocumentId);
          const selectionChanged = originDocument?.activeMaskId !== originMaskId
            || originDocument?.selectedLayer?.id !== originSelectedLayer?.id
            || originDocument?.selectedLayer?.type !== originSelectedLayer?.type;
          addMaskElement(
            { id: elementId, type: 'bitmap', src, mode: mode === 'subtract' ? 'erase' : 'add' },
            {
              replace: mode === 'replace',
              documentId: originDocumentId,
              maskId: originMaskId,
              preserveSelection: selectionChanged,
            }
          );
          const latest = useStore.getState();
          const latestDoc = latest.documents.find(document => document.id === originDocumentId);
          const maskId = latestDoc?.masks.find(mask => mask.elements.some(element => element.id === elementId))?.id;
          if (!maskId) {
            setWandInfo('Выделение не добавлено: маска была изменена или заблокирована');
            return;
          }
          setWandInfo(`Выделено ~${Math.round(coverage * 100)}% изображения`);
          if (coverage > 0.7) setWandPending({ documentId: originDocumentId, maskId, elementId, coverage });
        }).catch(() => window.alert('Не удалось прочитать пиксели композиции.'));
        return;
      }
      if (activeTool === 'rectSelect') {
        isRectSelecting.current = true;
        rectStart.current = { x: imagePoint.x, y: imagePoint.y };
        rectCurrent.current = { x: imagePoint.x, y: imagePoint.y };
        const rect = liveRectRef.current;
        if (rect) { rect.setAttrs({ x: imagePoint.x * imgW, y: imagePoint.y * imgH, width: 0, height: 0 }); rect.visible(true); rect.getLayer()?.batchDraw(); }
        return;
      }
      isLassoing.current = true; lassoPoints.current = [imagePoint.x, imagePoint.y];
      const line = liveLassoRef.current; if (line) { line.points([imagePoint.x * imgW, imagePoint.y * imgH]); line.visible(true); line.getLayer()?.batchDraw(); }
      return;
    }
    if ((activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser') && activeDoc) {
      // A captured pointer can occasionally miss Konva's synthetic pointerup
      // (for example when the browser window loses focus). Never start a
      // second stroke while the previous one is still marked active.
      if (isPainting.current) return;
      const selectedLayer = activeDoc.selectedLayer;
      const selectedAiLayer = selectedLayer?.type === 'ai'
        ? activeDoc.aiLayers.find(layer => layer.id === selectedLayer.id)
        : null;
      const selectedMask = selectedLayer?.type === 'mask'
        ? activeDoc.masks.find(mask => mask.id === selectedLayer.id)
        : null;
      const lockedTarget = activeTool === 'maskBrush'
        ? selectedMask?.locked
        : activeTool === 'eraser'
          ? (selectedMask?.locked || (selectedLayer?.type === 'ai' ? selectedAiLayer?.locked : activeDoc.baseLayer?.locked))
          : selectedAiLayer?.operation === 'drawing'
            ? selectedAiLayer.locked
            : activeDoc.cleanup.locked;
      if (lockedTarget) {
        setClipboardInfo('Слой заблокирован — сначала снимите замок');
        return;
      }
      const stage = stageRef.current;
      if (!stage) return;
      const pos = stage.getPointerPosition();
      if (!pos) return;
      const imagePoint = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (!imagePoint?.inside) return;
      const imgX = imagePoint.x * imgW;
      const imgY = imagePoint.y * imgH;
      isPainting.current = true;
      activePointerIdRef.current = e.evt.pointerId;
      try {
        const pointerTarget = e.evt.target as HTMLElement;
        pointerTarget.setPointerCapture(e.evt.pointerId);
        activePointerTargetRef.current = pointerTarget;
      } catch { /* capture is best-effort */ }
      strokeId.current = uid();
      currentStroke.current = [imagePoint.x, imagePoint.y];
      pendingBrushPoints.current = [];
      lastBrushPointRef.current = { x: imagePoint.x, y: imagePoint.y };
      // Start the live preview line
      livePoints.current = [imgX, imgY];
      const line = liveLineRef.current;
      if (line) {
        line.points(livePoints.current);
        // Eraser preview is a translucent marker — destination-out would visually
        // punch through the whole composite while drawing.
        line.stroke(activeTool === 'eraser' ? 'rgba(140,140,150,0.55)' : activeTool === 'maskBrush' ? 'rgba(255,128,0,0.6)' : cleanupSettings.brushColor);
        line.opacity(cleanupSettings.brushOpacity);
        line.globalCompositeOperation('source-over');
        const previewDiameter = cleanupSettings.brushSize * activeDoc.height * previewScale;
        line.strokeWidth(activeTool === 'brush' ? previewDiameter * (0.3 + cleanupSettings.brushHardness * 0.7) : previewDiameter);
        line.shadowColor(activeTool === 'brush' ? cleanupSettings.brushColor : 'transparent');
        line.shadowBlur(activeTool === 'brush' ? (1 - cleanupSettings.brushHardness) * previewDiameter * 0.55 : 0);
        line.shadowOpacity(activeTool === 'brush' ? 0.75 : 0);
        line.visible(true);
        line.getLayer()?.batchDraw();
      }
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();

    const textGesture = textPointerGestureRef.current;
    if (textGesture) {
      if (textGesture.pointerId === e.evt.pointerId) {
        const point = nativeTextPoint(e.evt);
        if (point) queueTextGeometry(point);
      }
      return;
    }

    if (isPanning.current) {
      const dx = e.evt.clientX - panStart.current.x;
      const dy = e.evt.clientY - panStart.current.y;
      setViewport({ x: panVpStart.current.x + dx, y: panVpStart.current.y + dy });
      return;
    }

    if (activeTool === 'rectSelect' && isRectSelecting.current && pos) {
      const imagePoint = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (imagePoint) {
        rectCurrent.current = { x: Math.min(1, Math.max(0, imagePoint.x)), y: Math.min(1, Math.max(0, imagePoint.y)) };
        const x = Math.min(rectStart.current.x, rectCurrent.current.x) * imgW;
        const y = Math.min(rectStart.current.y, rectCurrent.current.y) * imgH;
        const w = Math.abs(rectCurrent.current.x - rectStart.current.x) * imgW;
        const h = Math.abs(rectCurrent.current.y - rectStart.current.y) * imgH;
        const rect = liveRectRef.current;
        if (rect) { rect.setAttrs({ x, y, width: w, height: h }); rect.getLayer()?.batchDraw(); }
      }
      return;
    }
    if (activeTool === 'lasso' && isLassoing.current && pos) {
      const imagePoint = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (imagePoint?.inside) {
        const points = lassoPoints.current; const lastX = points.at(-2) ?? imagePoint.x, lastY = points.at(-1) ?? imagePoint.y;
        if (Math.hypot(imagePoint.x - lastX, imagePoint.y - lastY) > 0.002) points.push(imagePoint.x, imagePoint.y);
        const line = liveLassoRef.current; if (line) { line.points(points.flatMap((value, index) => index % 2 === 0 ? value * imgW : value * imgH)); line.getLayer()?.batchDraw(); }
      }
      return;
    }
    if (activeTool === 'polyLasso' && isPolyLassoing.current && pos) {
      // Rubber band: contour so far + a straight segment to the cursor.
      const imagePoint = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (imagePoint) {
        const cursorX = Math.max(0, Math.min(1, imagePoint.x)) * imgW;
        const cursorY = Math.max(0, Math.min(1, imagePoint.y)) * imgH;
        const line = liveLassoRef.current;
        if (line) {
          const base = polyLassoPoints.current.flatMap((value, index) => index % 2 === 0 ? value * imgW : value * imgH);
          line.points([...base, cursorX, cursorY]);
          line.getLayer()?.batchDraw();
        }
      }
      return;
    }
    if (activeTool === 'blur' && isEffectPainting.current && pos) {
      const point = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (point?.inside) {
        const points = effectPointsRef.current;
        const lastX = points.at(-2) ?? point.x;
        const lastY = points.at(-1) ?? point.y;
        if (Math.hypot((point.x - lastX) * imgW, (point.y - lastY) * imgH) * viewport.scale > 1.25) {
          points.push(point.x, point.y);
          liveLineRef.current?.points(points.flatMap((value, index) => index % 2 === 0 ? value * imgW : value * imgH));
          liveLineRef.current?.getLayer()?.batchDraw();
        }
      }
      return;
    }
    if ((activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser') && pos) {
      const imagePoint = screenToImage(pos, { viewport, imageWidth: imgW, imageHeight: imgH });
      if (!imagePoint?.inside) {
        if (cursorRef.current) cursorRef.current.style.display = 'none';
        return;
      }

      if (isPainting.current) {
        const coalescedEvents = typeof e.evt.getCoalescedEvents === 'function' ? e.evt.getCoalescedEvents() : [];
        const nativeEvents = coalescedEvents.length ? coalescedEvents : [e.evt];
        const bounds = stage.container().getBoundingClientRect();
        for (const nativeEvent of nativeEvents) {
          const nativePoint = {
            x: (nativeEvent.clientX - bounds.left) * stage.width() / Math.max(1, bounds.width),
            y: (nativeEvent.clientY - bounds.top) * stage.height() / Math.max(1, bounds.height),
          };
          const coalescedPoint = screenToImage(nativePoint, { viewport, imageWidth: imgW, imageHeight: imgH });
          if (coalescedPoint?.inside) queueBrushPoint(coalescedPoint);
        }
      }
    } else if (cursorRef.current) {
      cursorRef.current.style.display = 'none';
    }
  };

  // Double click reliably closes the polygonal lasso: Konva synthesizes
  // dblclick/dbltap itself, while pointerdown's `detail` click counter is
  // not dependable across browsers.
  const handleStageDblClick = (e: Konva.KonvaEventObject<Event>) => {
    if (activeTool !== 'polyLasso' || !isPolyLassoing.current) return;
    const pts = polyLassoPoints.current;
    // The two clicks of a double click each placed a vertex at the same
    // spot — drop the duplicate before closing.
    if (pts.length >= 8) {
      const dx = (pts[pts.length - 2] - pts[pts.length - 4]) * imgW;
      const dy = (pts[pts.length - 1] - pts[pts.length - 3]) * imgH;
      if (Math.hypot(dx, dy) * viewport.scale < 8) pts.splice(pts.length - 2, 2);
    }
    if (pts.length >= 6) {
      const evt = e.evt as Partial<MouseEvent>;
      finishPolyLasso(evt.altKey ? 'subtract' : evt.shiftKey ? 'add' : cleanupSettings.selectionMode);
    }
  };

  const handleMouseUp = (e?: Konva.KonvaEventObject<PointerEvent>) => {
    const textGesture = textPointerGestureRef.current;
    if (textGesture) {
      if (e && textGesture.pointerId === e.evt.pointerId) finishTextGeometryDraft(e.evt);
      return;
    }
    isPanning.current = false;
    if (isEffectPainting.current) {
      isEffectPainting.current = false;
      const points = [...effectPointsRef.current];
      effectPointsRef.current = [];
      liveLineRef.current?.setAttrs({ points: [], visible: false, shadowBlur: 0 });
      liveLineRef.current?.getLayer()?.batchDraw();
      if (points.length >= 2) applyEffectPreview(points);
      return;
    }
    if (brushFrameRef.current !== null) {
      window.cancelAnimationFrame(brushFrameRef.current);
      flushBrushPreview();
    }
    if (activePointerIdRef.current !== null) {
      try { activePointerTargetRef.current?.releasePointerCapture(activePointerIdRef.current); } catch { /* already released */ }
      activePointerIdRef.current = null;
      activePointerTargetRef.current = null;
    }
    const selMode: 'replace' | 'add' | 'subtract' = e?.evt?.altKey ? 'subtract' : e?.evt?.shiftKey ? 'add' : cleanupSettings.selectionMode;
    if (isRectSelecting.current) {
      isRectSelecting.current = false;
      const x1 = Math.min(rectStart.current.x, rectCurrent.current.x);
      const y1 = Math.min(rectStart.current.y, rectCurrent.current.y);
      const x2 = Math.max(rectStart.current.x, rectCurrent.current.x);
      const y2 = Math.max(rectStart.current.y, rectCurrent.current.y);
      if ((x2 - x1) > 0.004 && (y2 - y1) > 0.004) {
        addMaskElement(
          { type: 'polygon', points: [x1, y1, x2, y1, x2, y2, x1, y2], mode: selMode === 'subtract' ? 'erase' : 'add' },
          { replace: selMode === 'replace' }
        );
      }
      const rect = liveRectRef.current; if (rect) { rect.visible(false); rect.getLayer()?.batchDraw(); }
    }
    if (isLassoing.current) {
      const points = [...lassoPoints.current];
      if (points.length >= 6) {
        addMaskElement(
          { type: 'polygon', points, mode: selMode === 'subtract' ? 'erase' : 'add' },
          { replace: selMode === 'replace' }
        );
      }
      isLassoing.current = false; lassoPoints.current = [];
      const line = liveLassoRef.current; if (line) { line.points([]); line.visible(false); line.getLayer()?.batchDraw(); }
    }
    if (isPainting.current && activeDoc) {
      const pts = [...currentStroke.current];
      if (pts.length >= 2) {
        const stroke: StrokeData = {
          id: strokeId.current,
          points: pts,
          size: cleanupSettings.brushSize,
          color: cleanupSettings.brushColor,
          opacity: cleanupSettings.brushOpacity,
          hardness: cleanupSettings.brushHardness,
          mode: activeTool === 'eraser' ? 'erase' : 'paint',
          purpose: activeTool === 'maskBrush' ? 'mask' : 'paint',
        };
        const editsMask = activeTool === 'maskBrush' || (activeTool === 'eraser' && activeDoc.selectedLayer?.type === 'mask');
        if (editsMask) {
          addMaskStroke(stroke);
        } else if (activeTool === 'eraser') {
          // The eraser is per-layer: it punches pixels out of the selected raster
          // layer (base by default) instead of drawing a global destination-out
          // stroke that would visually erase the whole composite.
          const selected = activeDoc.selectedLayer;
          const target = selected?.type === 'ai'
            ? { id: selected.id, type: 'ai' as const }
            : { type: 'base' as const };
          // Inside the erase mask the stroke must ADD coverage (paint mode);
          // applyEraseElements then punches the covered area out of the layer.
          addEraseElement(target, { type: 'brush', stroke: { ...stroke, mode: 'paint' } });
        } else {
          // If a drawing layer is selected, bake the stroke into its bitmap so
          // the drawing lives on that layer (moves/hides/reorders with it).
          const selected = activeDoc.selectedLayer;
          const drawingLayer = selected?.type === 'ai'
            ? activeDoc.aiLayers.find(layer => layer.id === selected.id && layer.operation === 'drawing')
            : undefined;
          if (drawingLayer) {
            const docId = activeDoc.id;
            const layerId = drawingLayer.id;
            void bakeStrokeIntoLayerSrc(drawingLayer, activeDoc.width, activeDoc.height, stroke)
              .then(src => {
                const state = useStore.getState();
                const latestDocument = state.documents[state.activeDocIndex];
                const latestLayer = latestDocument?.aiLayers.find(layer => layer.id === layerId);
                if (latestDocument?.id === docId && latestLayer && !latestLayer.locked) {
                  state.updateAiLayer(layerId, { src });
                }
              })
              .catch(() => { /* keep previous bitmap on failure */ });
          } else {
            addStroke(stroke);
          }
        }
        scheduleThumbnailUpdate(activeDoc.id);
      }
      isPainting.current = false;
      currentStroke.current = [];
      pendingBrushPoints.current = [];
      lastBrushPointRef.current = null;
      // Hide the live preview line (the committed stroke takes over)
      livePoints.current = [];
      const line = liveLineRef.current;
      if (line) {
        line.points([]);
        line.visible(false);
        line.getLayer()?.batchDraw();
      }
    }
  };

  const handlePointerCancel = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const textGesture = textPointerGestureRef.current;
    if (textGesture) {
      if (textGesture.pointerId === event.evt.pointerId) clearTextGeometryDraft();
      return;
    }
    handleMouseUp(event);
  };

  // Keep a native safety net in addition to Konva's pointerup/cancel events.
  // Pointer capture is useful for long strokes, but some browsers deliver the
  // release only to the captured canvas and skip the React-Konva callback.
  finishPointerRef.current = () => handleMouseUp();
  useEffect(() => {
    const finish = (event: PointerEvent) => {
      if (textPointerGestureRef.current?.pointerId === event.pointerId) {
        finishTextPointerRef.current?.(event);
        return;
      }
      if (activePointerIdRef.current === event.pointerId) finishPointerRef.current?.();
    };
    const cancel = (event: PointerEvent) => {
      if (textPointerGestureRef.current?.pointerId === event.pointerId) {
        cancelTextPointerRef.current?.();
        return;
      }
      if (activePointerIdRef.current === event.pointerId) finishPointerRef.current?.();
    };
    const finishOnBlur = () => {
      if (textPointerGestureRef.current) cancelTextPointerRef.current?.();
      if (isPainting.current) finishPointerRef.current?.();
    };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', finishOnBlur);
    return () => {
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', finishOnBlur);
    };
  }, []);

  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const target = e.target as Konva.Node;
    const operation = useEditorUiStore.getState().activeOperation;
    if ((operation?.kind === 'perspective' || operation?.kind === 'transform') && target.getClassName() !== 'Circle') {
      useEditorUiStore.getState().commitActiveOperation();
      return;
    }
    const onStageOrBase = target === (stageRef.current as unknown as Konva.Node) || target.name() === 'base-image';

    // Text insertion is owned by the pointer lifecycle. The click that follows
    // pointerup must never publish a second object or touch history.
    if (activeTool === 'text' && target.getClassName() !== 'Text') {
      return;
    }

    // Deselect when clicking the empty stage OR the base image itself
    if (onStageOrBase) {
      setSelectedObject(null);
    }
  };

  const handleStageContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (e.target !== stageRef.current) return;
    setContextMenu(null);
    useEditorUiStore.getState().openToolOptions({
      x: e.evt.clientX,
      y: e.evt.clientY,
      target: { type: 'tool', tool: activeTool },
    });
  };

  const importImagesAsPages = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setLoadingFiles(true);
    setLoadErrors([]);
    try {
      const { docs, errors } = await loadImagesFromFiles(files);
      if (docs.length > 0) {
        addDocuments(docs);
        setClipboardInfo(docs.length > 1 ? `Добавлено страниц: ${docs.length}` : 'Добавлена новая страница');
      }
      setLoadErrors(errors);
      if (errors.length > 0) toast({ title: 'Не удалось добавить файл', description: errors.join(' ') });
    } finally {
      setLoadingFiles(false);
    }
  }, [addDocuments]);

  const importImagesAsLayers = useCallback(async (files: File[]) => {
    const state = useStore.getState();
    const doc = state.documents[state.activeDocIndex];
    if (!doc || files.length === 0) {
      await importImagesAsPages(files);
      return;
    }
    const errors: string[] = [];
    const validFiles = files.filter(file => {
      const error = validateFile(file);
      if (error) errors.push(error);
      return !error;
    });
    setLoadErrors(errors);
    if (errors.length > 0) toast({ title: 'Не удалось добавить файл', description: errors.join(' ') });
    if (validFiles.length === 0) return;
    setLoadingFiles(true);
    try {
      const ids = await pasteExternalImagesAsLayers(validFiles, doc.id);
      setClipboardInfo(ids.length > 1 ? `Вставлено слоёв: ${ids.length}` : 'Изображение вставлено новым слоем');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось вставить изображение.';
      setLoadErrors(previous => [...previous, message]);
      console.warn('[v0] pasteExternalImagesAsLayers:', error);
    } finally {
      setLoadingFiles(false);
    }
  }, [importImagesAsPages]);

  const applyImageImportChoice = useCallback(async (
    destination: ImageImportDestination,
    pending: PendingImageImport,
  ) => {
    if (destination === 'page') await importImagesAsPages(pending.files);
    else await importImagesAsLayers(pending.files);
  }, [importImagesAsLayers, importImagesAsPages]);

  const requestImageImport = useCallback((
    files: File[],
    source: PendingImageImport['source'],
    options?: { forcePage?: boolean },
  ) => {
    if (files.length === 0) return;
    const state = useStore.getState();
    const hasDocument = state.activeDocIndex >= 0 && Boolean(state.documents[state.activeDocIndex]);
    const destination = resolveImageImportDestination({
      hasDocument,
      forcePage: options?.forcePage,
      remembered: loadImageImportPreference(),
    });
    const pending = { files, source } satisfies PendingImageImport;
    if (destination) void applyImageImportChoice(destination, pending);
    else {
      setRememberImportChoice(false);
      setPendingImageImport(pending);
    }
  }, [applyImageImportChoice]);

  // Track Shift independently: ClipboardEvent does not expose modifier keys
  // consistently, but Ctrl/Cmd+Shift+V must always force a new page.
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Shift') shiftPressedRef.current = true; };
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Shift') shiftPressedRef.current = false; };
    const blur = () => { shiftPressedRef.current = false; };
    window.addEventListener('keydown', keyDown, true);
    window.addEventListener('keyup', keyUp, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown, true);
      window.removeEventListener('keyup', keyUp, true);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Paste handling.
  // 1) A fragment copied with Ctrl+C from a selection is inserted as a NEW
  //    LAYER of the active document (not as a new page).
  // 2) Image files copied from the desktop, Finder/Explorer or another image
  //    editor become NEW LAYERS when a page is open. With no page they create
  //    a new document. Text inputs keep native paste behaviour.
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      // Keep native paste behaviour in text fields (including the inline text
      // editor); image paste is intended for the canvas/workspace itself.
      if (shouldKeepNativePaste(event.target)) return;

      // Our own copied selection fragment → paste as a new layer in place.
      const store = useStore.getState();
      const hasDoc = store.activeDocIndex >= 0 && Boolean(store.documents[store.activeDocIndex]);
      if (hasDoc && shouldPasteFragment(data)) {
        event.preventDefault();
        void pasteFragmentAsLayer().then(err => {
          setClipboardInfo(err ?? 'Фрагмент вставлен новым слоем');
          if (err) console.warn('[v0] pasteFragmentAsLayer:', err);
        });
        return;
      }

      const files = extractClipboardImageFiles(data);
      if (files.length === 0) return;
      event.preventDefault();
      requestImageImport(files, 'paste', { forcePage: shiftPressedRef.current });
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [requestImageImport]);

  // Keyboard shortcuts: [ ] brush size, Ctrl+C (copy selection fragment),
  // Ctrl+V (paste fragment as layer — see the paste handler above),
  // Ctrl+J (layer from selection), Ctrl+D (deselect)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || target.isContentEditable;
      if (isEditable) return;

      const { cleanupSettings: cs, updateCleanupSettings: ucs } = useStore.getState();
      // e.code = физическая клавиша: хоткеи работают и на русской раскладке,
      // где e.key даёт кириллицу ('с', 'в', 'о', 'х', 'ъ').
      if (e.key === '[' || e.code === 'BracketLeft') ucs({ brushSize: Math.max(0.003, cs.brushSize * 0.85) });
      if (e.key === ']' || e.code === 'BracketRight') ucs({ brushSize: Math.min(0.2, cs.brushSize * 1.18) });

      const isKeyC = e.code === 'KeyC' || e.key.toLowerCase() === 'c';
      const isKeyJ = e.code === 'KeyJ' || e.key.toLowerCase() === 'j';
      const isKeyD = e.code === 'KeyD' || e.key.toLowerCase() === 'd';

      // ── Прямолинейное лассо: Enter — замкнуть, Backspace — убрать точку ─
      if (isPolyLassoing.current) {
        if (e.key === 'Enter') {
          e.preventDefault();
          finishPolyLasso(e.altKey ? 'subtract' : e.shiftKey ? 'add' : cs.selectionMode);
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          const pts = polyLassoPoints.current;
          if (pts.length > 2) {
            pts.splice(pts.length - 2, 2);
            const { w, h } = imgSizeRef.current;
            const line = liveLassoRef.current;
            if (line) { line.points(pts.flatMap((value, index) => index % 2 === 0 ? value * w : value * h)); line.getLayer()?.batchDraw(); }
          } else {
            cancelPolyLasso();
          }
          return;
        }
        if (e.key === 'Escape') { cancelPolyLasso(); return; }
        // Ctrl+C / Ctrl+J с незамкнутым контуром — сначала замыкаем его,
        // дальше сработает обычный обработчик копирования/слоя ниже.
        if ((e.ctrlKey || e.metaKey) && (isKeyC || isKeyJ)) {
          finishPolyLasso(e.altKey ? 'subtract' : e.shiftKey ? 'add' : cs.selectionMode);
        }
      }

      // ── Ctrl+D — снять выделение ────────────────────────────────────────
      if ((e.ctrlKey || e.metaKey) && isKeyD) {
        e.preventDefault();
        const store = useStore.getState();
        const doc = store.documents[store.activeDocIndex];
        if (doc) {
          store.clearActiveMask();
          // Cancel any in-progress selection tools
          if (isLassoing.current) {
            isLassoing.current = false; lassoPoints.current = [];
            const line = liveLassoRef.current;
            if (line) { line.points([]); line.visible(false); line.getLayer()?.batchDraw(); }
          }
          if (isRectSelecting.current) {
            isRectSelecting.current = false;
            const rect = liveRectRef.current;
            if (rect) { rect.visible(false); rect.getLayer()?.batchDraw(); }
          }
          cancelPolyLasso();
          setWandPending(null);
        }
        return;
      }

      // ── Ctrl+C — копировать фрагмент выделения (вставка по Ctrl+V) ─────
      // ── Ctrl+J — сразу создать слой из выделения ────────────────────────
      if ((e.ctrlKey || e.metaKey) && (isKeyC || isKeyJ)) {
        const store = useStore.getState();
        const doc = store.documents[store.activeDocIndex];
        if (!doc || !hasActiveSelection(doc)) {
          // No active selection — let browser handle Ctrl+C normally (text copy)
          if (isKeyJ) e.preventDefault();
          return;
        }
        e.preventDefault();
        if (isKeyJ) {
          void createLayerFromSelection().then(err => {
            if (err) console.warn('[v0] createLayerFromSelection:', err);
          });
        } else {
          void copySelectionFragment().then(err => {
            setClipboardInfo(err ?? 'Фрагмент скопирован — Ctrl+V вставит его новым слоем');
            if (err) console.warn('[v0] copySelectionFragment:', err);
          });
        }
        return;
      }

    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [finishPolyLasso, cancelPolyLasso]);

  if (documents.length === 0) {
    return (
      <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <DropZone onFiles={files => requestImageImport(files, 'drop')} loading={loadingFiles} errors={loadErrors} />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onDragOver={event => {
        if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
      }}
      onDrop={event => {
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) return;
        event.preventDefault();
        requestImageImport(files, 'drop');
      }}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        minWidth: 0,
        isolation: 'isolate',
        zIndex: 0,
        background: 'var(--bg-base)',
        // Cursor is set on the Stage itself (not here) so HUD panels and
        // buttons over the canvas keep the normal system cursor.
        cursor: 'default',
      }}
    >
      <ToolOptionsBar />

      {/* Navigation arrows */}
      {documents.length > 1 && (
        <>
          <button
            onClick={() => setActiveDoc(Math.max(0, activeDocIndex - 1))}
            disabled={activeDocIndex === 0}
            style={{
              position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
              zIndex: 20, width: 32, height: 48, borderRadius: 6,
              background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-default)',
              color: activeDocIndex === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: activeDocIndex === 0 ? 'not-allowed' : 'pointer',
              fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >‹</button>
          <button
            onClick={() => setActiveDoc(Math.min(documents.length - 1, activeDocIndex + 1))}
            disabled={activeDocIndex === documents.length - 1}
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              zIndex: 20, width: 32, height: 48, borderRadius: 6,
              background: 'rgba(0,0,0,0.5)', border: '1px solid var(--border-default)',
              color: activeDocIndex === documents.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
              cursor: activeDocIndex === documents.length - 1 ? 'not-allowed' : 'pointer',
              fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >›</button>
          {/* Counter */}
          <div style={{
            position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
            zIndex: 20, background: 'rgba(0,0,0,0.55)', borderRadius: 12,
            padding: '3px 10px', fontSize: 12, color: 'var(--text-secondary)',
            backdropFilter: 'blur(4px)',
          }}>
            {activeDocIndex + 1} / {documents.length}
          </div>
        </>
      )}

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 20, display: 'flex', gap: 4, background: 'rgba(0,0,0,0.55)',
        borderRadius: 8, padding: '4px 8px', backdropFilter: 'blur(4px)',
        alignItems: 'center',
      }}>
        {[
          { label: '−', onClick: () => setViewport({ scale: Math.max(0.05, viewport.scale / 1.2) }) },
          { label: `${Math.round(viewport.scale * 100)}%`, onClick: fitToScreen },
          { label: '+', onClick: () => setViewport({ scale: Math.min(8, viewport.scale * 1.2) }) },
          { label: '⊡', onClick: fitToScreen, title: 'Вписать в экран' },
          { label: '1:1', onClick: () => setViewport({ scale: 1 }) },
        ].map((btn, i) => (
          <button
            key={i}
            onClick={btn.onClick}
            title={btn.title}
            style={{
              padding: '2px 8px', fontSize: 12, borderRadius: 4,
              border: 'none', background: 'transparent',
              color: 'var(--text-secondary)', cursor: 'pointer',
              minWidth: 32,
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Load more button */}
      <div style={{ position: 'absolute', bottom: 12, right: 12, zIndex: 20 }}>
        <label style={{
          padding: '5px 10px', fontSize: 12, borderRadius: 6,
          border: '1px solid var(--border-default)',
          background: 'rgba(0,0,0,0.55)', color: 'var(--text-secondary)',
          cursor: 'pointer', backdropFilter: 'blur(4px)',
        }}>
          + Добавить
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={async e => {
              if (e.target.files) requestImageImport(Array.from(e.target.files), 'picker');
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {/* Errors */}
      {loadErrors.length > 0 && (
        <div style={{
          position: 'absolute', top: 10, right: 10, zIndex: 30,
          background: 'rgba(232,94,94,0.15)', border: '1px solid rgba(232,94,94,0.4)',
          borderRadius: 8, padding: '8px 12px', maxWidth: 260, fontSize: 11,
          color: 'var(--danger)',
        }}>
          {loadErrors.map((err, i) => <div key={i}>{err}</div>)}
          <button
            onClick={() => setLoadErrors([])}
            style={{ marginTop: 4, fontSize: 10, cursor: 'pointer', background: 'none', border: 'none', color: 'var(--text-muted)' }}
          >
            Закрыть
          </button>
        </div>
      )}

      {pendingImageImport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Как добавить изображение"
          style={{
            position: 'absolute', inset: 0, zIndex: 80,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.56)', padding: 20,
          }}
          onPointerDown={event => event.stopPropagation()}
        >
          <div style={{ width: 'min(430px, 100%)', borderRadius: 12, padding: 18, background: 'var(--bg-panel)', border: '1px solid var(--border-default)', boxShadow: '0 18px 60px rgba(0,0,0,.4)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 7 }}>Как добавить изображение?</div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', marginBottom: 14 }}>
              Новая страница сохраняет изображение отдельно. Слой помещает его поверх текущей страницы.
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {([
                ['page', 'Добавить как новую страницу'],
                ['layer', 'Добавить как слой на текущую страницу'],
              ] as const).map(([destination, label]) => (
                <button
                  key={destination}
                  type="button"
                  onClick={() => {
                    const pending = pendingImageImport;
                    setPendingImageImport(null);
                    if (rememberImportChoice) storeImageImportPreference(destination);
                    void applyImageImportChoice(destination, pending);
                  }}
                  style={{ border: destination === 'page' ? '1px solid var(--accent)' : '1px solid var(--border-default)', background: destination === 'page' ? 'var(--accent-dim)' : 'var(--bg-panel-raised)', color: 'var(--text-primary)', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontSize: 13 }}
                >
                  {label}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberImportChoice} onChange={event => setRememberImportChoice(event.target.checked)} />
              Запомнить выбор
            </label>
            <button type="button" onClick={() => setPendingImageImport(null)} style={{ marginTop: 14, border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}>Отмена</button>
          </div>
        </div>
      )}

      {/* Konva Stage */}
      {activeDoc && containerSize.w > 0 && (
        <Stage
          ref={stageRef}
          width={containerSize.w}
          height={containerSize.h}
          onWheel={handleWheel}
          onPointerDown={handleMouseDown}
          onPointerMove={handleMouseMove}
          onPointerUp={handleMouseUp}
          onPointerCancel={handlePointerCancel}
          onClick={handleStageClick}
          onDblClick={handleStageDblClick}
          onDblTap={handleStageDblClick}
          onContextMenu={handleStageContextMenu}
          onPointerLeave={() => { if (!isPainting.current && cursorRef.current) cursorRef.current.style.display = 'none'; }}
          style={{
            display: 'block',
            touchAction: 'none',
            cursor: activeTool === 'pan' ? 'grab' : (activeTool === 'lasso' || activeTool === 'polyLasso' || activeTool === 'wand' || activeTool === 'rectSelect' || activeTool === 'crop' || activeTool === 'blur') ? 'crosshair' : activeTool === 'text' ? 'text' : (activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser') ? 'none' : 'default',
          }}
        >
          {/* Base image layer — key includes fontsVersion so the canvas
              repaints once web fonts finish loading */}
          <Layer
            key={`layer-${fontsVersion}`}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
          >
            {/* Transparency checkerboard under everything */}
            {checkerPattern.current && (
              <Rect
                name="checker-bg"
                width={imgW}
                height={imgH}
                fillPatternImage={checkerPattern.current as unknown as HTMLImageElement}
                fillPatternRepeat="repeat"
                listening={false}
              />
            )}

            <Group clipX={0} clipY={0} clipWidth={imgW} clipHeight={imgH}>
            {/* One bottom → top sequence for rasters, brush strokes and vector
                objects. This is the same order used by export. */}
            {resolveVisualLayerOrder(activeDoc).map(ref => {
              if (ref.type === 'base') {
                if (!layerVisibility.base || baseReplaced || activeDoc.baseLayer?.visible === false) return null;
                return (
                  <BaseLayerNode
                    key="base-node"
                    doc={activeDoc}
                    width={imgW}
                    height={imgH}
                    interactive={activeTool === 'select'}
                    isSelected={activeDoc.selectedLayer?.type === 'base'}
                    onSelect={() => { selectLayer({ id: activeDoc.baseLayer?.id ?? `base-${activeDoc.id}`, type: 'base' }); }}
                    onContextMenu={e => {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      const layer = { id: activeDoc.baseLayer?.id ?? `base-${activeDoc.id}`, type: 'base' as const };
                      if (activeTool === 'select') setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, target: layer });
                      else useEditorUiStore.getState().openToolOptions({ x: e.evt.clientX, y: e.evt.clientY, target: { type: 'layer', layer, tool: activeTool } });
                    }}
                  />
                );
              }
              if (ref.type === 'ai') {
                const layer = (activeDoc.aiLayers ?? []).find(item => item.id === ref.id);
                if (!layer || !layerVisibility.cleanup || !layer.visible) return null;
                return (
                  <RasterLayerNode
                    key={layer.id}
                    layer={layer}
                    width={imgW}
                    height={imgH}
                    interactive={activeTool === 'select'}
                    isSelected={activeDoc.selectedLayer?.type === 'ai' && activeDoc.selectedLayer.id === layer.id}
                    onSelect={() => selectLayer({ id: layer.id, type: 'ai' })}
                    onContextMenu={e => {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      const layerRef = { id: layer.id, type: 'ai' as const };
                      if (activeTool === 'select') setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, target: layerRef });
                      else useEditorUiStore.getState().openToolOptions({ x: e.evt.clientX, y: e.evt.clientY, target: { type: 'layer', layer: layerRef, tool: activeTool } });
                    }}
                  />
                );
              }
              if (ref.type === 'strokes') {
                if (!layerVisibility.cleanup) return null;
                return (
                  <CleanupStrokesNode
                    key={ref.id}
                    strokes={activeDoc.cleanup.strokes.filter(stroke => stroke.purpose !== 'mask')}
                    width={imgW}
                    height={imgH}
                    lineScale={activeDoc.height * previewScale}
                  />
                );
              }
              if (ref.type === 'watermark') {
                const wm = activeDoc.watermarks.find(item => item.id === ref.id);
                if (!wm || !layerVisibility.watermarks) return null;
                return (
                  <WatermarkNode
                    key={wm.id}
                    wm={wm}
                    docWidth={activeDoc.width}
                    docHeight={activeDoc.height}
                    previewScale={previewScale}
                    isSelected={selectedObject?.id === wm.id}
                    onSelect={() => setSelectedObject({ id: wm.id, type: 'watermark' })}
                    onChange={updates => updateWatermark(wm.id, updates)}
                    onBeforeChange={pushHistory}
                  />
                );
              }
              if (ref.type === 'text') {
                const txt = activeDoc.texts.find(item => item.id === ref.id);
                if (!txt || !layerVisibility.texts) return null;
                return (
                  <TextNode
                    key={txt.id}
                    txt={txt}
                    docWidth={activeDoc.width}
                    docHeight={activeDoc.height}
                    previewScale={previewScale}
                    isSelected={selectedObject?.id === txt.id}
                    isEditing={inlineEditingTextId === txt.id}
                    onSelect={() => setSelectedObject({ id: txt.id, type: 'text' })}
                    onChange={updates => updateText(txt.id, updates, { moveGroup: Boolean(txt.groupId) })}
                    onBeforeChange={pushHistory}
                    onContextMenu={e => {
                      e.evt.preventDefault();
                      e.cancelBubble = true;
                      setSelectedObject({ id: txt.id, type: 'text' });
                      setContextMenu(null);
                      useEditorUiStore.getState().openToolOptions({
                        x: e.evt.clientX,
                        y: e.evt.clientY,
                        target: { type: 'object', object: { id: txt.id, type: 'text' }, tool: 'text' },
                      });
                    }}
                    onEditRequest={() => {
                      if (activeTool === 'lasso' || activeTool === 'polyLasso' || activeTool === 'rectSelect' || activeTool === 'wand') return;
                      setSelectedObject({ id: txt.id, type: 'text' });
                      setTextEditorOverflowing(false);
                      setPendingTextDraft({ documentId: activeDoc.id, id: txt.id, object: { ...txt }, original: { ...txt } });
                      isNewTextRef.current = false;
                      setInlineEditingTextId(txt.id);
                    }}
                  />
                );
              }
              if (ref.type === 'translationMask') {
                const mask = (activeDoc.translationMasks ?? []).find(item => item.id === ref.id);
                if (!mask || !layerVisibility.texts) return null;
                return (
                  <TranslationMaskNode
                    key={mask.id}
                    mask={mask}
                    docWidth={activeDoc.width}
                    docHeight={activeDoc.height}
                    previewScale={previewScale}
                    isSelected={selectedObject?.type === 'translationMask' && selectedObject.id === mask.id}
                    onSelect={() => setSelectedObject({ id: mask.id, type: 'translationMask' })}
                    onBeforeChange={pushHistory}
                    onChange={(updates, moveGroup) => updateTranslationMask(mask.id, updates, { history: false, moveGroup })}
                    onContextMenu={event => {
                      event.evt.preventDefault();
                      event.cancelBubble = true;
                      setSelectedObject({ id: mask.id, type: 'translationMask' });
                      setContextMenu(null);
                      useEditorUiStore.getState().openToolOptions({
                        x: event.evt.clientX,
                        y: event.evt.clientY,
                        target: { type: 'object', object: { id: mask.id, type: 'translationMask' }, tool: 'select' },
                      });
                    }}
                  />
                );
              }
              if (ref.type === 'shape') {
                const shape = (activeDoc.shapes ?? []).find(item => item.id === ref.id);
                if (!shape || !layerVisibility.shapes) return null;
                return (
                  <ShapeNode
                    key={shape.id}
                    shape={shape}
                    docWidth={activeDoc.width}
                    docHeight={activeDoc.height}
                    previewScale={previewScale}
                    isSelected={selectedObject?.id === shape.id}
                    onSelect={() => setSelectedObject({ id: shape.id, type: 'shape' })}
                    onChange={updates => updateShape(shape.id, updates)}
                    onBeforeChange={pushHistory}
                  />
                );
              }
              if (ref.type === 'bubble') {
                const bubble = (activeDoc.bubbles ?? []).find(item => item.id === ref.id);
                if (!bubble || !layerVisibility.shapes) return null;
                return (
                  <BubbleNode
                    key={bubble.id}
                    bubble={bubble}
                    docWidth={activeDoc.width}
                    docHeight={activeDoc.height}
                    previewScale={previewScale}
                    isSelected={selectedObject?.id === bubble.id}
                    onSelect={() => setSelectedObject({ id: bubble.id, type: 'bubble' })}
                    onChange={updates => updateBubble(bubble.id, updates, { history: false })}
                    onBeforeChange={pushHistory}
                    onEditRequest={() => {
                      setSelectedObject({ id: bubble.id, type: 'bubble' });
                      setLeftTab('bubble');
                    }}
                  />
                );
              }
              return null;
            })}

            {/* Persistent editor-only mask overlays */}
            {(activeDoc.masks ?? []).filter(mask => mask.visible).map(mask => (
              <MaskOverlayNode key={mask.id} elements={mask.elements} strokes={mask.strokes} width={imgW} height={imgH} opacity={mask.opacity} />
            ))}

            {/* Live lasso contour */}
            <Line ref={liveLassoRef} points={[]} stroke="rgb(255, 128, 0)" strokeWidth={2 / viewport.scale} dash={[7, 5]} closed fill="rgba(255,128,0,0.22)" listening={false} visible={false} />

            {/* Live rectangular selection */}
            <Rect ref={liveRectRef} stroke="rgb(255, 128, 0)" strokeWidth={2 / viewport.scale} dash={[7, 5]} fill="rgba(255,128,0,0.22)" listening={false} visible={false} />

            {/* Live stroke while drawing (updated imperatively) */}
            <Line
              ref={liveLineRef}
              points={livePoints.current}
              stroke={cleanupSettings.brushColor}
              strokeWidth={activeDoc ? cleanupSettings.brushSize * activeDoc.height * previewScale : 10}
              lineCap="round"
              lineJoin="round"
              tension={0.3}
              perfectDrawEnabled={false}
              listening={false}
              visible={false}
            />

            {/* Crop overlay */}
            {activeTool === 'crop' && cropRect && (
              <CropOverlay
                cropRect={cropRect}
                imgW={imgW}
                imgH={imgH}
                onChange={setCropRect}
                keepRatio={cropSettings.lockAspect || cropSettings.ratio !== 'free'}
              />
            )}
            </Group>
          </Layer>
          {activeOperation?.kind === 'perspective' && (
            <PerspectiveOverlay document={activeDoc} width={imgW} height={imgH} viewport={viewport} />
          )}
        </Stage>
      )}

      {textDraftRect && activeDoc && textPointerGestureRef.current && (
        <TextDraftOverlay
          rect={textDraftRect}
          docWidth={activeDoc.width * previewScale}
          docHeight={activeDoc.height * previewScale}
          viewport={viewport}
        />
      )}

      {/* Layer crop confirmation bar */}
      {layerCropTarget && activeTool === 'crop' && (
        <div style={{
          position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
          zIndex: 40, display: 'flex', alignItems: 'center', gap: 8,
          background: 'var(--bg-panel-raised)', border: '1px solid var(--border-default)',
          borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}>
          <span>Обрезка слоя — выделите область рамкой</span>
          <button
            type="button"
            onClick={() => useEditorUiStore.getState().commitActiveOperation() || applyLayerCrop()}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 5, border: 'none', background: 'var(--accent)', color: 'var(--bg-base)', cursor: 'pointer' }}
          >
            Применить
          </button>
          <button
            type="button"
            onClick={() => useEditorUiStore.getState().cancelActiveOperation() || cancelLayerCrop()}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Отмена
          </button>
        </div>
      )}

      {/* Wand coverage chip */}
      {wandInfo && !wandPending && (
        <div style={{
          position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
          zIndex: 30, background: 'rgba(0,0,0,0.65)', borderRadius: 12,
          padding: '4px 12px', fontSize: 12, color: 'var(--text-secondary)',
          backdropFilter: 'blur(4px)',
        }}>
          {wandInfo}
        </div>
      )}

      {/* Copy/paste fragment chip */}
      {clipboardInfo && (
        <div style={{
          position: 'absolute', top: wandInfo && !wandPending ? 76 : 48, left: '50%', transform: 'translateX(-50%)',
          zIndex: 31, background: 'rgba(0,0,0,0.65)', borderRadius: 12,
          padding: '4px 12px', fontSize: 12, color: 'var(--text-secondary)',
          backdropFilter: 'blur(4px)',
        }}>
          {clipboardInfo}
        </div>
      )}

      {/* Wand: selection covers >70% — confirm keeping it */}
      {wandPending && (
        <div role="alertdialog" aria-label="Слишком большое выделение" style={{
          position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
          zIndex: 40, background: 'var(--bg-panel-raised)', border: '1px solid var(--border-default)',
          borderRadius: 8, padding: '10px 14px', maxWidth: 340, fontSize: 12,
          color: 'var(--text-primary)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}>
          <div style={{ marginBottom: 8 }}>
            {`Выделено ~${Math.round(wandPending.coverage * 100)}% изображения. Оставить выделение или отменить и уменьшить порог?`}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => {
                useStore.getState().removeMaskElement(wandPending.documentId, wandPending.maskId, wandPending.elementId);
                setWandPending(null);
              }}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 5, border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Отменить
            </button>
            <button
              type="button"
              onClick={() => setWandPending(null)}
              style={{ padding: '4px 10px', fontSize: 12, borderRadius: 5, border: 'none', background: 'var(--accent)', color: 'var(--bg-base)', cursor: 'pointer' }}
            >
              Оставить
            </button>
          </div>
        </div>
      )}

      {/* Layer context menu */}
      {contextMenu && <LayerContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}

      {/* Inline text editor overlay */}
      {inlineEditingTextId && activeDoc && (() => {
        const editingTxt = pendingTextDraft?.id === inlineEditingTextId
          ? pendingTextDraft.object
          : activeDoc.texts.find(t => t.id === inlineEditingTextId);
        if (!editingTxt) return null;
        const paragraphWidth = editingTxt.width * activeDoc.width * previewScale * viewport.scale;
        const paragraphHeight = (editingTxt.height ?? 0) * activeDoc.height * previewScale * viewport.scale;
        const paragraphX = editingTxt.x * activeDoc.width * previewScale * viewport.scale + viewport.x;
        const paragraphY = editingTxt.y * activeDoc.height * previewScale * viewport.scale + viewport.y;
        const editorBox = getInlineTextEditorBox(paragraphWidth, paragraphHeight, editingTxt.textMode === 'paragraph');
        const markerScaleX = Number.isFinite(editingTxt.scaleX) ? editingTxt.scaleX : 1;
        const markerScaleY = Number.isFinite(editingTxt.scaleY) ? editingTxt.scaleY : 1;
        const markerRadians = (Number.isFinite(editingTxt.rotation) ? editingTxt.rotation : 0) * Math.PI / 180;
        const markerX = paragraphX
          + editorBox.width * markerScaleX * Math.cos(markerRadians)
          - (editorBox.height ?? 0) * markerScaleY * Math.sin(markerRadians);
        const markerY = paragraphY
          + editorBox.width * markerScaleX * Math.sin(markerRadians)
          + (editorBox.height ?? 0) * markerScaleY * Math.cos(markerRadians);
        return (
          <>
            <InlineTextEditor
              key={inlineEditingTextId}
              textObj={editingTxt}
              docWidth={activeDoc.width * previewScale}
              docHeight={activeDoc.height * previewScale}
              viewport={viewport}
              isNew={isNewTextRef.current}
              onCommit={commitTextDraft}
              onCancel={cancelTextDraft}
              onOverflowChange={setTextEditorOverflowing}
            />
            {editingTxt.textMode === 'paragraph' && textEditorOverflowing && (
              <span
                aria-label="Текст выходит за границы"
                data-testid="paragraph-text-overflow-marker"
                style={{
                  position: 'absolute',
                  left: markerX + 3,
                  top: markerY + 3,
                  zIndex: 51,
                  pointerEvents: 'none',
                  color: 'var(--accent)',
                  fontSize: 14,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                +
              </span>
            )}
          </>
        );
      })()}

      {/* Brush cursor (positioned imperatively, no re-renders) */}
      {(activeTool === 'brush' || activeTool === 'maskBrush' || activeTool === 'eraser' || activeTool === 'blur') && (
        <div
          ref={cursorRef}
          style={{
            position: 'absolute',
            top: 0, left: 0,
            display: 'none',
            borderRadius: '50%',
            border: '1.5px solid rgba(255,255,255,0.85)',
            outline: '1px solid rgba(0,0,0,0.4)',
            pointerEvents: 'none',
            willChange: 'transform',
            contain: 'layout paint',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}
