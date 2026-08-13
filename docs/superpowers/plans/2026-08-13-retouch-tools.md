# Eyedropper, Clone Stamp, Smudge, and Sharpen Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add practical Photoshop-like eyedropper, clone stamp, smudge, and sharpen tools that respect layers, perspective, selection, locks, and one-stroke undo.

**Architecture:** Reuse the brush cursor, stamp mask, raster-session validation, and dirty-bounds composition from the live-effects plan. Keep sampling and clone/smudge pixel algorithms in pure utilities, while CanvasArea owns only pointer gestures and transient overlays.

**Tech Stack:** TypeScript, Canvas 2D, React Konva, Zustand, Vitest.

## Global Constraints

- Complete the live raster-effects plan before this plan.
- All tools operate only on the active unlocked raster layer, except composited eyedropper sampling.
- Selection clipping is optional but exact when enabled.
- Perspective layers map document points through inverse homography before source sampling.
- One clone/smudge/sharpen stroke creates exactly one undo entry.
- Sampling, pointermove, and live overlay do not mutate Zustand document state.
- No APIs, AI routes, or provider contracts are changed.

---

### Task 1: Tool types, rail entries, and shortcut routing

**Files:**
- Modify: `types/index.ts`
- Modify: `components/editor/ToolRail.tsx`
- Modify: `components/editor/ToolOptionsBar.tsx`
- Modify: `utils/editorShortcuts.ts`
- Modify: `components/editor/EditorShell.tsx`
- Test: `tests/editorShortcuts.test.ts`
- Test: `tests/retouchToolRail.test.tsx`

**Interfaces:**
- Produces ActiveTools: `'eyedropper' | 'cloneStamp' | 'smudge' | 'sharpen'`
- Produces shortcuts: `I`, `S`, `R` for the retouch group, with menu selection resolving smudge/sharpen.

- [ ] **Step 1: Write RED shortcut and rail tests**

```ts
it('routes I and S to eyedropper and clone stamp', () => {
  expect(resolveEditorShortcut({ code: 'KeyI', key: 'i' })).toEqual({ type: 'tool', tool: 'eyedropper' });
  expect(resolveEditorShortcut({ code: 'KeyS', key: 's' })).toEqual({ type: 'tool', tool: 'cloneStamp' });
});
```

Render ToolRail and assert accessible buttons named `Пипетка`, `Штамп`, `Палец`, and `Резкость`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/editorShortcuts.test.ts tests/retouchToolRail.test.tsx`

Expected: FAIL because the ActiveTool union and buttons do not exist.

- [ ] **Step 3: Add tool metadata and preserve text-input shortcut guards**

Use Lucide icons `Pipette`, `Stamp`, `Blend`, and `ScanLine`. Do not reassign undo/redo, crop, or text shortcuts. The `R` shortcut opens/activates the last selected retouch mode rather than cycling during a stroke.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/editorShortcuts.test.ts tests/retouchToolRail.test.tsx && npx tsc --noEmit`

```bash
git add types/index.ts components/editor/ToolRail.tsx components/editor/ToolOptionsBar.tsx utils/editorShortcuts.ts components/editor/EditorShell.tsx tests/editorShortcuts.test.ts tests/retouchToolRail.test.tsx
git commit -m "feat: expose retouch tools"
```

### Task 2: Composited eyedropper with temporary Alt/Option activation

**Files:**
- Create: `utils/colorSampler.ts`
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `store/useStore.ts`
- Modify: `types/index.ts`
- Test: `tests/colorSampler.test.ts`
- Test: `tests/eyedropperInteraction.test.tsx`

**Interfaces:**
- Produces: `sampleCanvasColor(canvas, point): { hex: string; rgba: [number, number, number, number] } | null`
- Produces: `foregroundColor: string` and `setForegroundColor(color)` in UI/store settings.

- [ ] **Step 1: Write RED sampling tests**

```ts
it('samples an opaque composited pixel as hex', () => {
  const context = { getImageData: () => ({ data: new Uint8ClampedArray([17, 34, 51, 255]) }) };
  expect(sampleCanvasColor({ getContext: () => context } as unknown as HTMLCanvasElement, { x: 4, y: 7 }))
    .toEqual({ hex: '#112233', rgba: [17, 34, 51, 255] });
});

it('returns null for a fully transparent pixel', () => {
  const context = { getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) }) };
  expect(sampleCanvasColor({ getContext: () => context } as unknown as HTMLCanvasElement, { x: 0, y: 0 })).toBeNull();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/colorSampler.test.ts tests/eyedropperInteraction.test.tsx`

Expected: FAIL because sampling utility and tool behavior do not exist.

- [ ] **Step 3: Sample the composed document, not Konva UI pixels**

Build/reuse the document composition canvas without selection overlay, transformers, cursor, or perspective handles. Convert pointer coordinates through `screenToImage`, then sample document-resolution coordinates. A current-layer option instead uses `buildBaseCanvas` or `buildRasterLayerCanvas`.

- [ ] **Step 4: Apply foreground color consistently**

`setForegroundColor` updates the brush color and the defaults for newly created text and bubbles, but does not recolor selected existing objects. Remember the last paint tool before selecting Eyedropper and return to it after a successful sample.

- [ ] **Step 5: Implement temporary Alt/Option behavior**

While Brush or Clone Stamp is active and no stroke is in progress, Alt/Option keydown temporarily changes pointer behavior to Eyedropper. Keyup restores the prior tool behavior without adding history or changing the selected tool button.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/colorSampler.test.ts tests/eyedropperInteraction.test.tsx && npx tsc --noEmit`

```bash
git add utils/colorSampler.ts components/editor/CanvasArea.tsx store/useStore.ts types/index.ts tests/colorSampler.test.ts tests/eyedropperInteraction.test.tsx
git commit -m "feat: add composited eyedropper"
```

### Task 3: Clone Stamp source mapping and aligned strokes

**Files:**
- Create: `utils/cloneStamp.ts`
- Modify: `types/index.ts`
- Modify: `store/useStore.ts`
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `components/editor/floating/ToolOptionsPopover.tsx`
- Test: `tests/cloneStamp.test.ts`
- Test: `tests/cloneStampInteraction.test.tsx`

**Interfaces:**
- Produces: `CloneStampSettings { size, hardness, opacity, aligned, sample: 'current' | 'all' }`
- Produces: `mapCloneSamplePoint(destination, sourceAnchor, strokeAnchor): Point`
- Produces: `renderCloneStampStroke(options): HTMLCanvasElement`

- [ ] **Step 1: Write RED mapping tests**

```ts
it('keeps a constant source offset through an aligned stroke', () => {
  expect(mapCloneSamplePoint(
    { x: 90, y: 80 },
    { x: 20, y: 30 },
    { x: 70, y: 60 },
  )).toEqual({ x: 40, y: 50 });
});

it('maps document coordinates back into a perspective layer before sampling', () => {
  expect(resolveCloneLayerPoint(documentPoint, perspectiveQuad, 1000, 800)).toEqual(
    mapDocumentPointToLayerPoint(documentPoint, perspectiveQuad, 1000, 800),
  );
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/cloneStamp.test.ts tests/cloneStampInteraction.test.tsx`

Expected: FAIL because Clone Stamp does not exist.

- [ ] **Step 3: Implement source selection and rendering**

Alt/Option+click records normalized `sourceAnchor` outside document history. A normal pointerdown records `strokeAnchor`. Every interpolated destination stamp samples an equally sized source rectangle at `sourceAnchor + destination - strokeAnchor`, clips out-of-bounds pixels to transparent, and applies the common hardness mask once per stroke.

- [ ] **Step 4: Reuse raster session safety and overlay**

Validate target identity/lock before source composition. Render preview through `RasterEffectOverlay`, commit on pointerup, multiply by selection mask when enabled, and verify document/layer IDs again before commit. One stroke creates one history entry.

- [ ] **Step 5: Add visible source feedback**

CanvasArea displays a crosshair at the source anchor and the common two-ring destination cursor. Before source selection, status reads `Alt/Option + клик — выбрать источник`; a normal click without source does not create history.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/cloneStamp.test.ts tests/cloneStampInteraction.test.tsx tests/storeLayerLocking.test.ts && npx tsc --noEmit`

```bash
git add utils/cloneStamp.ts types/index.ts store/useStore.ts components/editor/CanvasArea.tsx components/editor/floating/ToolOptionsPopover.tsx tests/cloneStamp.test.ts tests/cloneStampInteraction.test.tsx
git commit -m "feat: add perspective-aware clone stamp"
```

### Task 4: Smudge tool on bounded dirty rectangles

**Files:**
- Create: `utils/smudgeRaster.ts`
- Modify: `types/index.ts`
- Modify: `store/useStore.ts`
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `components/editor/floating/ToolOptionsPopover.tsx`
- Test: `tests/smudgeRaster.test.ts`

**Interfaces:**
- Produces: `SmudgeSettings { size, hardness, strength, sampleAllLayers }`
- Produces: `renderSmudgeSegment(source, from, to, settings, bounds): HTMLCanvasElement`

- [ ] **Step 1: Write RED pixel-direction tests**

```ts
it('moves sampled color in the pointer direction without changing pixels outside the mask', () => {
  const result = renderSmudgeFixture(redLeftBlueRight, { x: 3, y: 4 }, { x: 6, y: 4 }, { size: 4, hardness: 1, strength: 1 });
  expect(pixel(result, 6, 4)[0]).toBeGreaterThan(pixel(redLeftBlueRight, 6, 4)[0]);
  expect(pixel(result, 0, 0)).toEqual(pixel(redLeftBlueRight, 0, 0));
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/smudgeRaster.test.ts`

Expected: FAIL because `smudgeRaster.ts` does not exist.

- [ ] **Step 3: Implement incremental pickup and deposit**

For each interpolated segment, copy a source stamp at `from`, move it toward `to`, multiply alpha by the shared hardness stamp and `strength`, then composite it onto the session working canvas. Update pickup pixels from the newly composited working canvas so a continuous stroke drags color naturally.

- [ ] **Step 4: Integrate through the common raster session lifecycle**

Preview/commit, lock, selection, page identity, pointer capture, rAF, and one-history semantics match Clone Stamp. Smudge never draws a colored mask line.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/smudgeRaster.test.ts tests/rasterEffectInteraction.test.tsx && npx tsc --noEmit`

```bash
git add utils/smudgeRaster.ts types/index.ts store/useStore.ts components/editor/CanvasArea.tsx components/editor/floating/ToolOptionsPopover.tsx tests/smudgeRaster.test.ts
git commit -m "feat: add smudge brush"
```

### Task 5: Sharpen tool wiring and complete retouch verification

**Files:**
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `components/editor/floating/ToolOptionsPopover.tsx`
- Modify: `utils/rasterEffectSession.ts`
- Test: `tests/retouchWorkflow.test.tsx`

**Interfaces:**
- Consumes: `renderRasterEffect(..., 'sharpen', ...)` from the live-effects plan.
- Produces: dedicated Sharpen tool button using the common effect session.

- [ ] **Step 1: Write RED workflow tests**

```tsx
it.each(['cloneStamp', 'smudge', 'sharpen'] as const)('%s commits one undoable raster stroke', async tool => {
  await performRetouchStroke(tool);
  expect(useStore.getState().documents[0].past).toHaveLength(1);
  useStore.getState().undo();
  expect(activeRasterSrc()).toBe(originalRasterSrc);
});
```

Add these assertions for every write tool:

```tsx
for (const tool of ['cloneStamp', 'smudge', 'sharpen'] as const) {
  lockActiveRaster();
  await expect(performRetouchStroke(tool)).rejects.toThrow('Слой заблокирован');
  expect(currentDocument().past).toHaveLength(0);
  unlockActiveRaster();
  await performSelectedRetouchStroke(tool);
  expect(pixelOutsideSelection()).toEqual(originalPixelOutsideSelection);
  await startRetouchThenSwitchPage(tool);
  expect(secondDocumentRasterSrc()).toBe(secondDocumentOriginalSrc);
}
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/retouchWorkflow.test.tsx`

Expected: FAIL until Sharpen is routed through the common session and all guards are shared.

- [ ] **Step 3: Wire Sharpen and consolidate duplicated pointer code**

Use one CanvasArea `startRasterStroke`, `queueRasterPoint`, `finishRasterStroke`, and `cancelRasterStroke` path parameterized by active raster tool. Keep tool-specific source-selection behavior in Clone Stamp only.

- [ ] **Step 4: Run final automated verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git diff --check`

Expected: PASS.

- [ ] **Step 5: Browser smoke**

1. Eyedrop a composited color over normal and perspective layers.
2. Alt/Option-pick Clone source, paint across an edge, then undo once.
3. Clone near source bounds and confirm no stretched edge pixels.
4. Smudge two flat colors with 20% and 100% strength.
5. Sharpen a line-art edge and confirm surrounding untouched pixels remain identical.
6. Repeat all write operations with the layer locked and verify zero changes.

- [ ] **Step 6: Commit workflow coverage**

```bash
git add components/editor/CanvasArea.tsx components/editor/floating/ToolOptionsPopover.tsx utils/rasterEffectSession.ts tests/retouchWorkflow.test.tsx
git commit -m "test: verify retouch tool workflows"
```
