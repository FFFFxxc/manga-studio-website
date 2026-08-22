import { forwardRef } from 'react';
import { getBrushTipRadii } from '@/utils/brushTip';

export interface BrushCursorProps {
  diameterPx: number;
  hardness: number;
  color: string;
  showCrosshair?: boolean;
}

export const BrushCursor = forwardRef<HTMLDivElement, BrushCursorProps>(function BrushCursor({
  diameterPx,
  hardness,
  color,
  showCrosshair = false,
}, ref) {
  const { outer, hard } = getBrushTipRadii(diameterPx, hardness);
  const diameter = outer * 2;
  const hardDiameter = hard * 2;

  return (
    <div
      ref={ref}
      data-testid="brush-cursor"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        display: 'none',
        width: diameter,
        height: diameter,
        pointerEvents: 'none',
        willChange: 'transform',
        contain: 'layout paint',
        zIndex: 10,
      }}
    >
      <span
        data-testid="brush-cursor-outer"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `1.5px solid ${color}`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
        }}
      />
      {hard > 0 && (
        <span
          data-testid="brush-cursor-hard-core"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: hardDiameter,
            height: hardDiameter,
            borderRadius: '50%',
            border: `1px solid ${color}`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}
      {showCrosshair && (
        <span
          data-testid="brush-cursor-crosshair"
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 9,
            height: 9,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <span style={{ position: 'absolute', left: 4, top: 0, width: 1, height: 9, background: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }} />
          <span style={{ position: 'absolute', left: 0, top: 4, width: 9, height: 1, background: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.35)' }} />
        </span>
      )}
    </div>
  );
});
