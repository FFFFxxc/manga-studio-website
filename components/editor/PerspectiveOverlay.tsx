'use client';

import { useEffect, useRef, useState } from 'react';
import { Circle, Layer, Line } from 'react-konva';
import type { ImageDocument, PerspectiveQuad, ViewportState } from '@/types';
import { useStore } from '@/store/useStore';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import { canTransformRasterLayer } from '@/utils/layerGuards';
import { clonePerspectiveQuad, isValidPerspectiveQuad } from '@/utils/perspective';

const PERSPECTIVE_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;

function PerspectiveHandles({ quad, width, height, onChange, dragLayerKey }: {
  quad: PerspectiveQuad;
  width: number;
  height: number;
  onChange: (quad: PerspectiveQuad) => void;
  dragLayerKey: string;
}) {
  const pushHistory = useStore(state => state.pushHistory);
  const setPerspectiveDragLayerKey = useEditorUiStore(state => state.setPerspectiveDragLayerKey);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<PerspectiveQuad | null>(null);
  const draggingRef = useRef(false);
  const [draftQuad, setDraftQuad] = useState(() => clonePerspectiveQuad(quad)!);
  const draftRef = useRef(draftQuad);
  const lastValidRef = useRef(clonePerspectiveQuad(quad)!);

  const setDraft = (next: PerspectiveQuad) => {
    draftRef.current = next;
    setDraftQuad(next);
  };

  useEffect(() => {
    if (draggingRef.current) return;
    const next = clonePerspectiveQuad(quad)!;
    draftRef.current = next;
    lastValidRef.current = next;
    setDraftQuad(next);
  }, [quad]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (useEditorUiStore.getState().perspectiveDragLayerKey === dragLayerKey) {
      useEditorUiStore.getState().setPerspectiveDragLayerKey(null);
    }
  }, [dragLayerKey]);

  const flush = () => {
    frameRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) onChange(pending);
  };
  const schedule = (next: PerspectiveQuad) => {
    pendingRef.current = next;
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(flush);
  };
  const linePoints = PERSPECTIVE_KEYS.flatMap(key => [draftQuad[key].x * width, draftQuad[key].y * height]);
  const interpolate = (a: { x: number; y: number }, b: { x: number; y: number }, value: number) => ({ x: a.x + (b.x - a.x) * value, y: a.y + (b.y - a.y) * value });

  return (
    <>
      <Line points={linePoints} closed stroke="#5e9fe8" strokeWidth={2} dash={[7, 4]} listening={false} />
      {[0.25, 0.5, 0.75].flatMap(value => {
        const left = interpolate(draftQuad.topLeft, draftQuad.bottomLeft, value);
        const right = interpolate(draftQuad.topRight, draftQuad.bottomRight, value);
        const top = interpolate(draftQuad.topLeft, draftQuad.topRight, value);
        const bottom = interpolate(draftQuad.bottomLeft, draftQuad.bottomRight, value);
        return [
          <Line key={`h-${value}`} points={[left.x * width, left.y * height, right.x * width, right.y * height]} stroke="rgba(94,159,232,.55)" strokeWidth={1} listening={false} />,
          <Line key={`v-${value}`} points={[top.x * width, top.y * height, bottom.x * width, bottom.y * height]} stroke="rgba(94,159,232,.55)" strokeWidth={1} listening={false} />,
        ];
      })}
      {PERSPECTIVE_KEYS.map(key => {
        const point = draftQuad[key];
        return (
          <Circle
            key={key}
            x={point.x * width}
            y={point.y * height}
            radius={7}
            fill="#ffffff"
            stroke="#5e9fe8"
            strokeWidth={2}
            draggable
            onDragStart={() => {
              draggingRef.current = true;
              setPerspectiveDragLayerKey(dragLayerKey);
              const start = clonePerspectiveQuad(quad)!;
              setDraft(start);
              lastValidRef.current = start;
              pushHistory();
            }}
            onDragMove={event => {
              const next = clonePerspectiveQuad(draftRef.current)!;
              next[key] = { x: event.target.x() / width, y: event.target.y() / height };
              setDraft(next);
              if (isValidPerspectiveQuad(next)) {
                lastValidRef.current = next;
                schedule(next);
              }
            }}
            onDragEnd={event => {
              const next = clonePerspectiveQuad(draftRef.current)!;
              next[key] = { x: event.target.x() / width, y: event.target.y() / height };
              if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
              frameRef.current = null;
              pendingRef.current = null;
              const committed = isValidPerspectiveQuad(next) ? next : clonePerspectiveQuad(lastValidRef.current)!;
              setDraft(committed);
              event.target.position({ x: committed[key].x * width, y: committed[key].y * height });
              draggingRef.current = false;
              setPerspectiveDragLayerKey(null);
              onChange(committed);
            }}
            onPointerCancel={() => {
              if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
              frameRef.current = null;
              pendingRef.current = null;
              draggingRef.current = false;
              setPerspectiveDragLayerKey(null);
            }}
          />
        );
      })}
    </>
  );
}

export function PerspectiveOverlay({ document, width, height, viewport }: {
  document: ImageDocument;
  width: number;
  height: number;
  viewport: ViewportState;
}) {
  const updateAiLayerPerspective = useStore(state => state.updateAiLayerPerspective);
  const updateBasePerspective = useStore(state => state.updateBasePerspective);
  const selectedLayer = document.selectedLayer;
  if (!canTransformRasterLayer(document, selectedLayer)) return null;
  const target = selectedLayer?.type === 'base'
    ? document.baseLayer
    : selectedLayer?.type === 'ai'
      ? document.aiLayers.find(layer => layer.id === selectedLayer.id)
      : null;
  if (!selectedLayer || !target?.perspective) return null;

  return (
    <Layer x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale}>
      <PerspectiveHandles
        quad={target.perspective}
        width={width}
        height={height}
        dragLayerKey={`${selectedLayer.type}:${selectedLayer.id}`}
        onChange={quad => {
          if (selectedLayer?.type === 'base') updateBasePerspective(quad, { history: false });
          else if (selectedLayer?.type === 'ai') updateAiLayerPerspective(selectedLayer.id, quad, { history: false });
        }}
      />
    </Layer>
  );
}
