export interface SmudgePoint { x: number; y: number }
export interface SmudgeDab { from: SmudgePoint; to: SmudgePoint; distance: number }

/** Distance-based sampling retains its remainder between pointer-event batches. */
export function createSmudgeDabSampler(spacing: number) {
  spacing = Math.max(0.5, spacing);
  let previous: SmudgePoint | null = null;
  let carried: SmudgePoint | null = null;
  let remainder = 0;
  return {
    append(points: number[]): SmudgeDab[] {
      const dabs: SmudgeDab[] = [];
      for (let index = 0; index + 1 < points.length; index += 2) {
        const to = { x: points[index], y: points[index + 1] };
        if (![to.x, to.y].every(Number.isFinite)) continue;
        if (!previous || !carried) { previous = to; carried = to; continue; }
        const from = previous;
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (distance <= 1e-8) continue;
        let travelled = spacing - remainder;
        while (travelled <= distance + 1e-8) {
          const ratio = Math.min(1, travelled / distance);
          const next = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
          dabs.push({ from: carried, to: next, distance: spacing });
          carried = next;
          travelled += spacing;
        }
        remainder = Math.max(0, distance - (travelled - spacing));
        previous = to;
      }
      return dabs;
    },
    finish(): SmudgeDab[] {
      if (!previous || !carried || remainder < 1e-8) return [];
      const dab = { from: carried, to: previous, distance: remainder };
      carried = previous;
      remainder = 0;
      return [dab];
    },
  };
}
