# Seamless Perspective Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace visible Canvas triangle seams with a shared WebGL homography renderer and a seam-safe adaptive Canvas fallback used consistently by preview, export, cleanup, and raster layers.

**Architecture:** Keep `utils/perspective.ts` as the public geometry and dispatch API, move backend rendering into focused `perspectiveWebgl.ts` and `perspectiveCanvas.ts` modules, and select quality through a shared profile rather than raw subdivision counts. WebGL performs one inverse-homography texture sample pass; the Canvas backend remains a tested fallback.

**Tech Stack:** TypeScript, Canvas 2D, WebGL 1, React Konva, Vitest, Next.js 16.

## Global Constraints

- Do not modify `app/api/*`, Vercel configuration, env names, RouterAI contracts, or Clipdrop contracts.
- Old documents without `perspective` or `perspectiveSourceBounds` must remain compatible.
- Base, AI, and drawing raster layers must use the same high-level renderer.
- Preview, export, cleanup source, and AI source must not use divergent rendering algorithms.
- A locked layer must never be auto-unlocked or mutated.
- One perspective corner drag creates exactly one history entry.
- No new runtime dependency is permitted for the perspective renderer.

---

### Task 1: Perspective quality profiles and stronger quad validation

**Files:**
- Modify: `utils/perspective.ts`
- Test: `tests/perspectiveGeometry.test.ts`

**Interfaces:**
- Produces: `PerspectiveQuality = 'drag' | 'preview' | 'export'`
- Produces: `getPerspectiveSubdivisionCount(quad, width, height, quality): number`
- Produces: `isValidPerspectiveQuad(quad, options?): boolean`, preserving the existing numeric `minArea` overload for compatibility.

- [ ] **Step 1: Write failing geometry and quality tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  getPerspectiveSubdivisionCount,
  isValidPerspectiveQuad,
  perspectiveHomography,
  projectHomography,
} from '@/utils/perspective';

const rectangle = {
  topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
};

describe('perspective geometry quality', () => {
  it('rejects a short edge even when the polygon area is large enough', () => {
    expect(isValidPerspectiveQuad({
      ...rectangle,
      topRight: { x: 0.001, y: 0 },
    }, { minArea: 0.0004, minEdge: 0.005 })).toBe(false);
  });

  it('uses more fallback segments for export and stronger distortion', () => {
    const skewed = { ...rectangle, topRight: { x: 0.64, y: 0.18 } };
    expect(getPerspectiveSubdivisionCount(skewed, 3000, 2000, 'export'))
      .toBeGreaterThan(getPerspectiveSubdivisionCount(rectangle, 800, 600, 'drag'));
  });

  it('maps every source corner to the requested quad corner', () => {
    const quad = { ...rectangle, topLeft: { x: 0.1, y: 0.15 }, bottomRight: { x: 0.9, y: 0.8 } };
    const matrix = perspectiveHomography(quad, 1000, 800)!;
    const topLeft = projectHomography(matrix, { x: 0, y: 0 });
    const bottomRight = projectHomography(matrix, { x: 1, y: 1 });
    expect(topLeft.x).toBeCloseTo(100); expect(topLeft.y).toBeCloseTo(120);
    expect(bottomRight.x).toBeCloseTo(900); expect(bottomRight.y).toBeCloseTo(640);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/perspectiveGeometry.test.ts`

Expected: FAIL because `getPerspectiveSubdivisionCount` and the object validation options do not exist.

- [ ] **Step 3: Implement quality selection and validation without changing normalized storage**

```ts
export type PerspectiveQuality = 'drag' | 'preview' | 'export';

export interface PerspectiveValidationOptions {
  minArea?: number;
  minEdge?: number;
}

export function getPerspectiveSubdivisionCount(
  quad: PerspectiveQuad,
  width: number,
  height: number,
  quality: PerspectiveQuality,
) {
  const diagonals = [
    Math.hypot(quad.topLeft.x - quad.bottomRight.x, quad.topLeft.y - quad.bottomRight.y),
    Math.hypot(quad.topRight.x - quad.bottomLeft.x, quad.topRight.y - quad.bottomLeft.y),
  ];
  const distortion = Math.min(1, Math.abs(diagonals[0] - diagonals[1]) + Math.abs(perspectiveQuadArea(quad) - 1));
  const side = Math.max(width, height);
  const base = quality === 'drag' ? 8 : quality === 'preview' ? 14 : 20;
  const resolutionBonus = quality === 'drag' ? 0 : Math.ceil(Math.max(0, side - 1200) / 600);
  return Math.max(6, Math.min(40, base + Math.ceil(distortion * 12) + resolutionBonus));
}
```

Keep the existing winding and self-intersection checks, add a four-edge minimum check, and support both `isValidPerspectiveQuad(quad, 0.001)` and object options.

- [ ] **Step 4: Run focused and existing tests**

Run: `npx vitest run tests/perspectiveGeometry.test.ts tests/newEditorFeatures.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the geometry contract**

```bash
git add utils/perspective.ts tests/perspectiveGeometry.test.ts
git commit -m "refactor: define perspective quality profiles"
```

### Task 2: Single-pass WebGL homography backend

**Files:**
- Create: `utils/perspectiveWebgl.ts`
- Modify: `utils/perspective.ts`
- Test: `tests/perspectiveWebgl.test.ts`

**Interfaces:**
- Consumes: `Homography`, `PerspectiveQuality`, `perspectiveHomography`, `invertHomography`
- Produces: `PerspectiveWebglResult = { canvas: HTMLCanvasElement; bounds: PixelRect }`
- Produces: `renderPerspectiveWebgl(source, quad, outputWidth, outputHeight, options): PerspectiveWebglResult | null`
- Produces: `resetPerspectiveWebglRenderer(): void` for context-loss recovery and tests.

- [ ] **Step 1: Export homography inversion and write RED tests for render bounds/backend fallback**

```ts
import { describe, expect, it, vi } from 'vitest';
import { calculatePerspectiveRenderBounds, renderPerspectiveWebgl } from '@/utils/perspectiveWebgl';

describe('perspective WebGL renderer', () => {
  it('limits its surface to the quad bounds', () => {
    expect(calculatePerspectiveRenderBounds({
      topLeft: { x: .2, y: .1 }, topRight: { x: .8, y: .2 },
      bottomRight: { x: .9, y: .7 }, bottomLeft: { x: .1, y: .8 },
    }, 1000, 500)).toEqual({ x: 100, y: 50, width: 800, height: 350 });
  });

  it('returns null instead of throwing when WebGL is unavailable', () => {
    const canvasFactory = () => ({ getContext: vi.fn(() => null) }) as unknown as HTMLCanvasElement;
    expect(renderPerspectiveWebgl({} as CanvasImageSource, {
      topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
      bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
    }, 100, 100, { canvasFactory })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/perspectiveWebgl.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement one reusable WebGL context and shader pair**

Use these exact shader responsibilities:

```ts
const vertexSource = `
attribute vec2 a_position;
varying vec2 v_destination;
void main() {
  v_destination = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D u_source;
uniform mat3 u_inverseHomography;
uniform vec2 u_outputSize;
uniform vec4 u_bounds;
varying vec2 v_destination;
void main() {
  vec2 documentPoint = u_bounds.xy + v_destination * u_bounds.zw;
  vec3 sourcePoint = u_inverseHomography * vec3(documentPoint, 1.0);
  vec2 uv = sourcePoint.xy / sourcePoint.z;
  if (sourcePoint.z <= 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  gl_FragColor = texture2D(u_source, vec2(uv.x, 1.0 - uv.y));
}`;
```

Define options as:

```ts
export interface PerspectiveWebglOptions {
  canvasFactory?: () => HTMLCanvasElement;
  onContextLost?: () => void;
}
```

The renderer must:

- compile once and cache program/buffers;
- use `UNPACK_PREMULTIPLY_ALPHA_WEBGL`;
- set `CLAMP_TO_EDGE` and `LINEAR`;
- resize its canvas only when the bounded output dimensions change;
- attach `webglcontextlost` and call `event.preventDefault()` plus clear the singleton;
- catch initialization/upload/draw errors and return `null`.

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run tests/perspectiveWebgl.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit WebGL backend**

```bash
git add utils/perspective.ts utils/perspectiveWebgl.ts tests/perspectiveWebgl.test.ts
git commit -m "feat: add single-pass perspective renderer"
```

### Task 3: Seam-safe Canvas fallback and public renderer dispatch

**Files:**
- Create: `utils/perspectiveCanvas.ts`
- Modify: `utils/perspective.ts`
- Test: `tests/perspectiveCanvas.test.ts`

**Interfaces:**
- Consumes: `getPerspectiveSubdivisionCount`, `PerspectiveQuality`
- Produces: `drawPerspectiveCanvas(ctx, source, quad, width, height, options): void`
- Updates: `drawPerspectiveImage(..., options: PerspectiveDrawOptions): void`

- [ ] **Step 1: Write RED tests using a recording Canvas context**

```ts
import { describe, expect, it, vi } from 'vitest';
import { drawPerspectiveCanvas } from '@/utils/perspectiveCanvas';

it('expands internal clip triangles to cover antialias seams', () => {
  const paths: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(), beginPath: () => { current = []; },
    moveTo: (x: number, y: number) => current.push([x, y]),
    lineTo: (x: number, y: number) => current.push([x, y]),
    closePath: vi.fn(), clip: () => paths.push(current),
    transform: vi.fn(), drawImage: vi.fn(), globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  drawPerspectiveCanvas(ctx, {} as CanvasImageSource, {
    topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
    bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
  }, 200, 100, { quality: 'drag', seamOverlapPx: 0.75 });
  expect(paths.length).toBeGreaterThan(2);
  expect(paths.some(path => path.some(([x]) => x < 0 || x > 200))).toBe(true);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/perspectiveCanvas.test.ts`

Expected: FAIL because `perspectiveCanvas.ts` does not exist.

- [ ] **Step 3: Move the current triangle renderer and expand clip vertices around each triangle centroid**

```ts
function expandTriangle(points: [Point, Point, Point], overlap: number) {
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 3, y: sum.y + point.y / 3 }), { x: 0, y: 0 });
  return points.map(point => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    return { x: point.x + dx / length * overlap, y: point.y + dy / length * overlap };
  }) as [Point, Point, Point];
}
```

Clamp only the external quad outline in a final outer clip; internal triangles overlap. Keep source coordinates unchanged so overlap does not distort texture mapping.

- [ ] **Step 4: Dispatch WebGL first and Canvas fallback second**

`drawPerspectiveImage` must call `renderPerspectiveWebgl`. If it returns `{ canvas, bounds }`, draw `canvas` once at `bounds.x`, `bounds.y`, `bounds.width`, `bounds.height`. Otherwise call `drawPerspectiveCanvas`. Retain legacy `{ subdivisions }` input temporarily by mapping it to fallback override, but convert all repository callers in Task 4.

- [ ] **Step 5: Run renderer tests**

Run: `npx vitest run tests/perspectiveGeometry.test.ts tests/perspectiveCanvas.test.ts tests/perspectiveWebgl.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit fallback and dispatch**

```bash
git add utils/perspective.ts utils/perspectiveCanvas.ts tests/perspectiveCanvas.test.ts
git commit -m "fix: remove perspective mesh seams"
```

### Task 4: Integrate one quality contract across editor, export, cleanup, and AI source

**Files:**
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `utils/cleanupRaster.ts`
- Test: `tests/perspectiveIntegration.test.ts`

**Interfaces:**
- Consumes: `drawPerspectiveImage(..., { quality, crop, sourceBounds, opacity })`
- Produces: identical renderer selection across all raster composition paths.

- [ ] **Step 1: Write a static integration test that rejects raw subdivisions at call sites**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('perspective renderer integration', () => {
  it('uses named quality profiles instead of caller-specific mesh sizes', () => {
    for (const file of ['components/editor/CanvasArea.tsx', 'utils/cleanupRaster.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/drawPerspectiveImage[\s\S]{0,240}subdivisions:/);
    }
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/perspectiveIntegration.test.ts`

Expected: FAIL because current callers pass `subdivisions`.

- [ ] **Step 3: Convert call sites**

Use `quality: perspectivePreviewActive ? 'drag' : 'preview'` in `PlacedRasterImage`, and `quality: 'export'` in document-resolution composition. Cleanup/AI source also uses `export` because it must match the submitted document pixels.

- [ ] **Step 4: Ensure preview cache invalidation includes quality and source revision**

Build the `PlacedRasterImage` cache key from source dimensions/src identity, quad values, source bounds, preview dimensions, and quality. Do not invalidate it from unrelated React state.

- [ ] **Step 5: Run focused tests and build**

Run: `npx vitest run tests/perspectiveIntegration.test.ts tests/perspectiveGeometry.test.ts tests/exportRendering.test.ts tests/newEditorFeatures.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit integration**

```bash
git add components/editor/CanvasArea.tsx utils/cleanupRaster.ts tests/perspectiveIntegration.test.ts
git commit -m "refactor: unify perspective output quality"
```

### Task 5: Perspective interaction lock/history regression coverage

**Files:**
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `components/editor/panels/TransformPanel.tsx`
- Modify: `store/useStore.ts`
- Create: `utils/layerGuards.ts`
- Test: `tests/perspectiveInteractions.test.tsx`
- Test: `tests/storeLayerLocking.test.ts`

**Interfaces:**
- Consumes: `isValidPerspectiveQuad` and existing `pushHistory`/perspective actions.
- Produces: `canTransformRasterLayer(document, selectedLayer): boolean` in `utils/layerGuards.ts` for store and UI reuse.

- [ ] **Step 1: Write RED store tests proving locked layers are immutable**

```ts
it('does not update perspective on a locked base layer', () => {
  useStore.setState({ documents: [{ ...makeDocument(), baseLayer: { ...createBaseLayerState('doc'), locked: true } }], activeDocIndex: 0 });
  useStore.getState().updateBasePerspective(validQuad);
  expect(useStore.getState().documents[0].baseLayer.perspective).toBeNull();
  expect(useStore.getState().documents[0].past).toHaveLength(0);
});
```

Add this equivalent AI-layer assertion in the same test:

```ts
useStore.setState({ documents: [makeDocumentWithLockedAiLayer('ai-locked')], activeDocIndex: 0 });
useStore.getState().updateAiLayerPerspective('ai-locked', validQuad);
expect(useStore.getState().documents[0].aiLayers[0].perspective).toBeNull();
expect(useStore.getState().documents[0].past).toHaveLength(0);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/storeLayerLocking.test.ts tests/perspectiveInteractions.test.tsx`

Expected: FAIL because direct perspective actions can currently bypass lock, or the interaction test is not yet present.

- [ ] **Step 3: Guard store actions and disable UI handles without unlocking**

`updateBasePerspective` and `updateAiLayerPerspective` return without changing history when the target is locked. TransformPanel shows the existing locked-layer message and leaves the lock state untouched.

- [ ] **Step 4: Keep one history snapshot per drag**

Call `pushHistory()` only on corner `onDragStart`. Use `{ history: false }` during rAF updates and on drag end. Invalid intermediate quads remain local and restore the last valid quad.

- [ ] **Step 5: Run the whole suite and browser smoke**

Run: `npm test && npx tsc --noEmit && git diff --check`

Manual smoke:

1. Load a checkerboard image.
2. Enter Perspective and drag each corner strongly.
3. Inspect at 100%, 200%, and 400% zoom.
4. Export PNG and compare the same high-contrast diagonal area.
5. Lock the layer and verify handles do not move it.
6. Unlock, perform one drag, press Ctrl/Cmd+Z once, and verify the entire drag reverts.

- [ ] **Step 6: Commit interaction safety**

```bash
git add components/editor/CanvasArea.tsx components/editor/panels/TransformPanel.tsx store/useStore.ts tests/perspectiveInteractions.test.tsx tests/storeLayerLocking.test.ts utils/layerGuards.ts
git commit -m "fix: harden perspective interaction semantics"
```
