export interface BrushTipRadii {
  outer: number;
  hard: number;
}

export function getBrushTipRadii(diameterPx: number, hardness: number): BrushTipRadii {
  const outer = Math.max(0.5, Number.isFinite(diameterPx) ? diameterPx / 2 : 0.5);
  const normalizedHardness = Number.isFinite(hardness) ? Math.max(0, Math.min(1, hardness)) : 0;
  return { outer, hard: outer * normalizedHardness };
}

export function getBrushSpacingPx(diameterPx: number, hardness: number): number {
  const diameter = Number.isFinite(diameterPx) ? Math.max(0, diameterPx) : 0;
  const normalizedHardness = Number.isFinite(hardness) ? Math.max(0, Math.min(1, hardness)) : 0;
  return Math.max(0.5, diameter * (normalizedHardness >= 0.98 ? 0.14 : 0.08));
}
