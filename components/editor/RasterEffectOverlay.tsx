'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Image as KonvaImage } from 'react-konva';
import Konva from 'konva';
import type { RasterEffectPreview } from '@/utils/rasterEffectSession';

export interface RasterEffectOverlayHandle {
  show(preview: RasterEffectPreview): void;
  clear(): void;
}

interface RasterEffectOverlayProps {
  width: number;
  height: number;
  preview: RasterEffectPreview;
}

/**
 * Imperative target-layer replacement used while a raster-effect gesture is
 * active. CanvasArea mounts it in the exact z-order slot of the hidden target,
 * so upper layers keep occluding the preview exactly as they do after commit.
 */
export const RasterEffectOverlay = forwardRef<RasterEffectOverlayHandle, RasterEffectOverlayProps>(
  function RasterEffectOverlay({ width, height, preview }, forwardedRef) {
    const imageRef = useRef<Konva.Image>(null);

    const show = (next: RasterEffectPreview) => {
      const node = imageRef.current;
      if (!node) return;
      node.image(next.canvas);
      node.opacity(next.opacity);
      node.visible(true);
      node.getLayer()?.batchDraw();
    };

    const clear = () => {
      const node = imageRef.current;
      if (!node) return;
      node.visible(false);
      node.image(undefined);
      node.getLayer()?.batchDraw();
    };

    useImperativeHandle(forwardedRef, () => ({ show, clear }));
    useEffect(() => { show(preview); }, [preview]);

    return (
      <KonvaImage
        ref={imageRef}
        name="raster-effect-overlay"
        data-testid="raster-effect-overlay"
        data-has-preview="true"
        image={preview.canvas}
        width={width}
        height={height}
        opacity={preview.opacity}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  },
);
