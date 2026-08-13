# Live Raster Effects and Brush Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make brush hardness visually truthful and show blur, pixelate, noise, and sharpen as actual pixels under the cursor with one undo entry per stroke.

**Architecture:** Split deterministic effect generation from stroke-session orchestration. A reusable stamp-mask renderer drives both live overlay and final commit; each stroke snapshots its raster source, tracks a dirty rectangle outside Zustand, previews at editor resolution once per frame, and commits one document-resolution patch on pointerup.

**Tech Stack:** TypeScript, Canvas 2D, OffscreenCanvas when available, React Konva overlay integration, Zustand, Vitest.

## Global Constraints

- Keep `getCoalescedEvents`, requestAnimationFrame buffering, real-event-target pointer capture, and window pointerup/pointercancel/blur safeguards.
- Pointermove must not update React document state or Zustand document state.
- Live preview and committed output must share stamp spacing, hardness, mask alpha, and effect parameters.
- Blur/Pixelate/Noise/Sharpen must display changed pixels rather than a blue mask line.
- A locked base, AI, or drawing layer must remain unchanged and produce no history entry.
- One stroke must produce exactly one history entry.
- Existing eraser `destination-out` behavior and `drawBrushStroke` public signature must remain compatible.
- Do not modify APIs or paid AI flows.

---

### Task 1: Shared brush tip geometry and truthful cursor

**Files:**
- Modify: `utils/brushRaster.ts`
- Create: `utils/brushTip.ts`
- Create: `components/editor/BrushCursor.tsx`
- Modify: `components/editor/CanvasArea.tsx`
- Test: `tests/brushTip.test.ts`
- Test: `tests/PaintEditor.test.tsx`

**Interfaces:**
- Produces: `getBrushTipRadii(diameterPx, hardness): { outer: number; hard: number }`
- Produces: `getBrushSpacingPx(diameterPx, hardness): number`
- Produces: `<BrushCursor diameterPx hardness color showCrosshair />`

- [ ] **Step 1: Write RED brush-tip tests**

```ts
import { describe, expect, it } from 'vitest';
import { getBrushSpacingPx, getBrushTipRadii } from '@/utils/brushTip';

describe('brush tip geometry', () => {
  it.each([[0, 0], [.5, 25], [1, 50]])('maps hardness %s to a visible hard core', (hardness, expected) => {
    expect(getBrushTipRadii(100, hardness).hard).toBe(expected);
  });

  it('keeps stamp spacing dense enough for a soft stroke', () => {
    expect(getBrushSpacingPx(100, 0)).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/brushTip.test.ts tests/PaintEditor.test.tsx`

Expected: FAIL because the helper and component do not exist.

- [ ] **Step 3: Extract stamp geometry from `drawBrushStroke`**

```ts
export function getBrushTipRadii(diameterPx: number, hardness: number) {
  const outer = Math.max(.5, diameterPx / 2);
  return { outer, hard: outer * Math.max(0, Math.min(1, hardness)) };
}

export function getBrushSpacingPx(diameterPx: number, hardness: number) {
  return Math.max(.5, diameterPx * (hardness >= .98 ? .14 : .08));
}
```

Use these values inside brush stamp generation/interpolation so cursor and raster cannot drift.

- [ ] **Step 4: Replace the imperative single-ring cursor**

`BrushCursor` renders an outer circle, a hard-core circle when hardness > 0, and a center crosshair. It is a DOM overlay positioned through `translate3d`; updates happen imperatively from pointermove and do not set React state.

- [ ] **Step 5: Remove the Konva shadow approximation for ordinary brush preview**

Create a small overlay canvas aligned with document preview and call `drawBrushStroke` into it from the existing rAF flush. Clear it on commit/cancel/tool switch. Mask brush may retain its orange compositing color, but its edge must come from the same stamp alpha.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/brushTip.test.ts tests/PaintEditor.test.tsx && npx tsc --noEmit`

```bash
git add utils/brushRaster.ts utils/brushTip.ts components/editor/BrushCursor.tsx components/editor/CanvasArea.tsx tests/brushTip.test.ts tests/PaintEditor.test.tsx
git commit -m "fix: align brush preview with raster output"
```

### Task 2: Deterministic raster effect primitives

**Files:**
- Create: `utils/rasterEffectPrimitives.ts`
- Modify: `types/index.ts`
- Test: `tests/rasterEffectPrimitives.test.ts`

**Interfaces:**
- Produces: `RasterEffectMode = 'blur' | 'pixelate' | 'noise' | 'sharpen'`
- Produces: `RasterEffectParameters` with `radius`, `strength`, `cellSize`, `noiseAmount`, `noiseMonochrome`, `seed`
- Produces: `renderRasterEffect(source, bounds, mode, parameters): HTMLCanvasElement`

- [ ] **Step 1: Write RED deterministic effect tests**

```ts
import { describe, expect, it } from 'vitest';
import { createSeededRandom, pixelateBounds, expandEffectBounds } from '@/utils/rasterEffectPrimitives';

describe('raster effect primitives', () => {
  it('produces stable noise for the same seed', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('anchors pixel cells to layer coordinates', () => {
    expect(pixelateBounds({ x: 13, y: 17, width: 20, height: 20 }, 8))
      .toEqual({ x: 8, y: 16, width: 32, height: 24 });
  });

  it('expands blur dirty bounds by its sampling radius', () => {
    expect(expandEffectBounds({ x: 20, y: 30, width: 10, height: 12 }, 6, 100, 100))
      .toEqual({ x: 14, y: 24, width: 22, height: 24 });
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/rasterEffectPrimitives.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement blur, pixelate, seeded noise, and sharpen as bounded operations**

Blur uses Canvas `filter = blur(px)` on an expanded source rectangle. Pixelate downsamples and upsamples with `imageSmoothingEnabled = false`, aligning bounds to the layer origin. Noise uses a small integer PRNG rather than `Math.random`. Sharpen applies a bounded 3×3 convolution and mixes it with the source by `strength`.

```ts
export function createSeededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}
```

- [ ] **Step 4: Test actual pixels with `pngjs` fixtures**

Build an 8×8 synthetic checker/edge canvas through the existing test canvas mock. Assert:

- blur reduces edge contrast;
- pixelate outputs one RGBA value per cell;
- same noise seed yields byte-identical output;
- sharpen increases edge contrast without changing alpha.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/rasterEffectPrimitives.test.ts && npx tsc --noEmit`

```bash
git add utils/rasterEffectPrimitives.ts types/index.ts tests/rasterEffectPrimitives.test.ts
git commit -m "feat: add deterministic raster effects"
```

### Task 3: Stroke session engine outside Zustand

**Files:**
- Create: `utils/rasterEffectSession.ts`
- Replace internals: `utils/rasterEffects.ts`
- Test: `tests/rasterEffectSession.test.ts`

**Interfaces:**
- Consumes: `drawBrushStroke`, `renderRasterEffect`, `buildBaseCanvas`, `buildRasterLayerCanvas`, `buildCleanupMask`
- Produces: `createRasterEffectSession(options): Promise<RasterEffectSession>`
- Produces: `append(points)`, `renderPreview()`, `commit()`, `cancel()`

```ts
export interface RasterEffectSessionOptions {
  documentId: string;
  layer: { type: 'base' } | { type: 'ai'; id: string };
  settings: BlurSettings;
  previewScale: number;
  createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
}

export interface RasterEffectSession {
  append(points: number[]): void;
  renderPreview(): Promise<{ canvas: CanvasImageSource; bounds: PixelRect } | null>;
  commit(): Promise<string>;
  cancel(): void;
}
```

- [ ] **Step 1: Write RED lifecycle tests**

```ts
it('does not mutate the store while appending or previewing points', async () => {
  const before = useStore.getState().documents[0];
  const session = await createRasterEffectSession(makeOptions());
  session.append([.1, .1, .2, .2]);
  await session.renderPreview();
  expect(useStore.getState().documents[0]).toBe(before);
});

it('commits one history entry for one stroke', async () => {
  const session = await createRasterEffectSession(makeOptions());
  session.append([.1, .1, .8, .8]);
  await session.commit();
  expect(useStore.getState().documents[0].past).toHaveLength(1);
});

it('rejects a locked layer before building effect pixels', async () => {
  lockSelectedLayer();
  await expect(createRasterEffectSession(makeOptions())).rejects.toThrow('Слой заблокирован');
  expect(buildRasterSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/rasterEffectSession.test.ts`

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Implement immutable session state**

The constructor captures `documentId`, `layerId/type`, source revision/src, settings, selection mask, preview scale, and a stable per-stroke seed. It validates document/layer identity and lock before source rasterization. `append` only updates numeric arrays, mask canvas, and dirty bounds owned by the session. The default canvas factory selects `OffscreenCanvas` when available and otherwise creates an `HTMLCanvasElement`; the public return type remains `CanvasImageSource` so both paths compose identically.

- [ ] **Step 4: Implement preview and commit from one composition function**

```ts
function compositeEffect(source: CanvasImageSource, effected: CanvasImageSource, mask: CanvasImageSource, bounds: PixelRect) {
  const patch = createCanvas(bounds.width, bounds.height);
  const ctx = patch.getContext('2d')!;
  ctx.drawImage(effected, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  ctx.globalCompositeOperation = 'source-over';
  return patch;
}
```

Preview uses scaled bounds; commit recomputes document-resolution bounds and checks that current document/layer IDs and source revision still match. A mismatch cancels with a readable error rather than writing to a new page.

- [ ] **Step 5: Keep compatibility wrapper**

`applyRasterEffectPreview(points?)` remains exported during integration but internally creates a session and immediately commits. Remove it only after every caller moves to the session API.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/rasterEffectSession.test.ts tests/storeLayerLocking.test.ts && npx tsc --noEmit`

```bash
git add utils/rasterEffectSession.ts utils/rasterEffects.ts tests/rasterEffectSession.test.ts
git commit -m "refactor: isolate raster effect strokes"
```

### Task 4: Real live-effect overlay in CanvasArea

**Files:**
- Create: `components/editor/RasterEffectOverlay.tsx`
- Modify: `components/editor/CanvasArea.tsx`
- Test: `tests/rasterEffectInteraction.test.tsx`

**Interfaces:**
- Consumes: `RasterEffectSession`
- Produces: transient `<canvas>` overlay aligned with document preview.

- [ ] **Step 1: Write RED interaction tests**

```tsx
it('renders effect pixels during pointer movement and commits on pointerup', async () => {
  render(<CanvasArea />);
  await startEffectStroke(user, { x: 100, y: 100 });
  await moveEffectStroke(user, { x: 300, y: 200 });
  expect(screen.getByTestId('raster-effect-overlay')).toHaveAttribute('data-has-preview', 'true');
  expect(useStore.getState().documents[0].past).toHaveLength(0);
  await endEffectStroke(user);
  await waitFor(() => expect(useStore.getState().documents[0].past).toHaveLength(1));
});
```

Add the following cancellation assertions:

```tsx
for (const cancel of ['pointercancel', 'window-blur', 'tool-switch', 'document-switch'] as const) {
  await beginStrokeAndCancel(cancel);
  expect(useStore.getState().documents[0].past).toHaveLength(0);
  expect(screen.queryByTestId('raster-effect-overlay')).not.toHaveAttribute('data-has-preview', 'true');
}
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/rasterEffectInteraction.test.tsx`

Expected: FAIL because CanvasArea still draws a blue Konva line.

- [ ] **Step 3: Replace `isEffectPainting/effectPointsRef` blue-line flow**

On pointerdown, asynchronously create a session and store it in a ref. Coalesced points go into a pending array. One rAF flush appends points, calls `renderPreview`, and copies the returned preview canvas/bounds into `RasterEffectOverlay`. Never call store setters from the rAF flush.

- [ ] **Step 4: Commit on pointerup and cancel transient pixels everywhere else**

Pointerup awaits `session.commit()`, clears overlay, and shows success/error. Window blur and pointercancel call `session.cancel()`. Tool/page switch cancels only if the session has not started commit.

- [ ] **Step 5: Remove Enter/Esc operation gating for individual strokes**

Each pointerup is the Photoshop-like commit boundary and produces one undo entry. Esc cancels only an in-progress stroke; it does not roll back already committed prior strokes.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/rasterEffectInteraction.test.tsx tests/PaintEditor.test.tsx && npx tsc --noEmit`

```bash
git add components/editor/RasterEffectOverlay.tsx components/editor/CanvasArea.tsx tests/rasterEffectInteraction.test.tsx
git commit -m "feat: preview raster effects under the brush"
```

### Task 5: Mode-specific controls, shortcuts, and full verification

**Files:**
- Modify: `types/index.ts`
- Modify: `store/useStore.ts`
- Modify: `components/editor/floating/ToolOptionsPopover.tsx`
- Modify: `components/editor/ToolOptionsBar.tsx`
- Modify: `components/editor/EditorShell.tsx`
- Modify: `utils/editorShortcuts.ts`
- Test: `tests/rasterEffectSettings.test.ts`
- Test: `tests/editorShortcuts.test.ts`

**Interfaces:**
- Consumes: `RasterEffectMode`, `RasterEffectParameters`
- Produces: separate labels/controls for radius, strength, cell size, noise amount, monochrome, and sharpen amount.
- Updates: `resolveEditorShortcut(event, activeTool?)` so bracket keys can be scoped to paint/effect tools.

- [ ] **Step 1: Write RED settings migration tests**

```ts
it('keeps independent blur radius and pixel cell size', () => {
  useStore.getState().updateBlurSettings({ mode: 'blur', radius: 14 });
  useStore.getState().updateBlurSettings({ mode: 'pixelate', cellSize: 24 });
  expect(useStore.getState().blurSettings).toMatchObject({ radius: 14, cellSize: 24 });
});
```

Add these keyboard assertions:

```ts
expect(resolveEditorShortcut({ code: 'BracketRight', key: ']' }, 'brush'))
  .toEqual({ type: 'brush-adjust', property: 'size', delta: 1 });
expect(resolveEditorShortcut({ code: 'BracketRight', key: ']', shiftKey: true }, 'brush'))
  .toEqual({ type: 'brush-adjust', property: 'hardness', delta: 1 });
expect(resolveEditableTargetShortcut({ code: 'BracketRight', key: ']' }))
  .toBeNull();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/rasterEffectSettings.test.ts tests/editorShortcuts.test.ts`

Expected: FAIL because settings are currently overloaded.

- [ ] **Step 3: Update settings and UI copy**

Blur shows Size, Hardness, Radius, Strength. Pixelate shows Brush Size, Hardness, Cell Size, Mix. Noise shows Brush Size, Hardness, Amount, Monochrome. Sharpen shows Brush Size, Hardness, Radius, Amount. Remove the `Превью эффекта · Enter применить` instruction.

- [ ] **Step 4: Add shortcut actions without changing undo/redo mappings**

Extend `resolveEditorShortcut` with brush adjustment actions, then apply bounded increments in EditorShell. Inputs, textarea, select, and contenteditable targets ignore these shortcuts.

- [ ] **Step 5: Run complete verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git diff --check`

Manual smoke:

1. Compare cursor and a single click at hardness 0%, 50%, and 100%.
2. Draw long mouse/pen/touch strokes and release outside canvas.
3. Blur once at 15% strength, then pass again and confirm gradual increase.
4. Pixelate two overlapping strokes and confirm cell grid alignment.
5. Undo once after each stroke and confirm only the last stroke is reverted.
6. Lock base and AI layers and confirm no effect starts.

- [ ] **Step 6: Commit settings and verification coverage**

```bash
git add types/index.ts store/useStore.ts components/editor/floating/ToolOptionsPopover.tsx components/editor/ToolOptionsBar.tsx components/editor/EditorShell.tsx utils/editorShortcuts.ts tests/rasterEffectSettings.test.ts tests/editorShortcuts.test.ts
git commit -m "feat: clarify raster effect controls"
```
