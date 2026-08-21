# Seamless Perspective Renderer final fix report

Date: 2026-08-22
Reviewed base: `f96b2f8`
Scope: the seven findings in `final-fix-brief.md` only

## Outcome

All seven findings are implemented in one coherent fix wave. The renderer still stores normalized quads, uses the shared WebGL/Canvas dispatcher, and routes preview and document composition through the established high-level raster paths. No API route, deployment, environment, provider contract, or dependency was changed.

The combined rectangle contract is now explicit in production behavior: `crop` and `perspectiveSourceBounds` are normalized rectangles in original-source space; their intersection is sampled, and that intersection occupies its corresponding subregion of the source-bounds-mapped quad.

## Finding-by-finding changes

### 1. Reject concave quads at geometry and store boundaries

- `isValidPerspectiveQuad` now requires all four consecutive cross products to have the same non-zero sign, in addition to the existing finite-coordinate, minimum-area, minimum-edge, and intersection checks.
- `updateBasePerspective` and `updateAiLayerPerspective` validate a non-null quad before copying documents, creating history, or mutating a layer.
- Geometry coverage uses the exact non-self-intersecting concave case `(0,0) -> (1,0) -> (.2,.2) -> (0,1)`.
- Direct-store coverage verifies both base and AI actions leave the quad, history, and dirty state unchanged.

TDD evidence:

- RED: `npx vitest run tests/perspectiveGeometry.test.ts tests/storeLayerLocking.test.ts`
  - 2 regressions failed out of 11 tests.
  - Geometry returned `true` instead of `false`; the direct base store action accepted the concave quad.
- GREEN: the same command passed both files and all 11 tests.

### 2. Restore preview quality immediately after a corner drag

- The transient editor UI store now records `perspectiveDragLayerKey`, separate from the longer-lived perspective operation.
- The overlay sets the key only on an actual corner drag start and clears it on drag end, pointer cancel, overlay unmount, operation commit/cancel, and transient-UI cleanup.
- `PlacedRasterImage` selects `drag` quality only when its own layer key is active. It returns to `preview` immediately on end/cancel while the perspective operation remains active.
- Pointer cancellation also cancels and clears a queued animation frame so a stale in-flight corner update cannot publish after cancellation.
- History behavior is preserved: the overlay still calls `pushHistory()` once at drag start, while in-flight and final perspective writes use `history: false`.

TDD evidence:

- RED: `npx vitest run tests/perspectivePreviewLifecycle.test.tsx`
  - The initial selected-layer render received `drag` while no corner was moving; expected `preview`.
- GREEN: `npx vitest run tests/perspectivePreviewLifecycle.test.tsx tests/perspectiveInteractions.test.tsx`
  - Both files passed, 7 tests at that stage.
- Additional cancel RED: the new cancel regression reported that `cancelAnimationFrame(41)` was never called.
- Cancel GREEN: the same lifecycle/interaction command passed both files and all 8 tests at that stage.

### 3. Prevent stale perspective preview pixels after async source changes

- The preview cache retains a serialized value key, but its effect now also depends on the resolved `image`/canvas object identity.
- Each rendered preview is associated with both the source identity/revision key and the exact resolved source object.
- When a newer revision is rendered while the parent still exposes the old resolved object, the old perspective canvas is hidden instead of being relabeled as current.
- When the new image/canvas identity arrives for that revision, the production `PlacedRasterImage` path redraws immediately.
- Existing async builders retain their cancellation guards, so an older build cannot overwrite state after its effect has been superseded.

TDD evidence:

- RED: `npx vitest run tests/perspectivePreviewLifecycle.test.tsx`
  - Changing the erase revision while retaining the old resolved source left the old preview visible, and arrival of the new source identity did not trigger the required redraw.
- GREEN: the component regression now observes the old preview disappear, then verifies a second production draw uses the new source object and exposes the newly rendered preview canvas.

### 4. Implement combined crop and perspective source-bounds behavior

- The Canvas renderer now intersects `crop` with `sourceBounds` in normalized original-source coordinates.
- An empty intersection draws nothing.
- The surviving source rectangle is mapped into its correct local UV subrectangle inside the source-bounds-mapped quad, rather than stretched across the whole quad.
- Mesh source coordinates, projected destination coordinates, clip path, and temporary surface bounds all use that effective mapping.
- The shared dispatcher still uses Canvas when source bounds are present, so editor preview and document-resolution composition receive the same implementation.
- The high-level compositor test verifies `crop`, `perspectiveSourceBounds`, opacity, and `export` quality are forwarded together to the shared renderer.

TDD evidence:

- RED: `npx vitest run tests/perspectiveCanvas.test.ts`
  - 1 of 8 tests failed because the old source-bounds branch clipped/drew the full quad instead of the expected local subregion.
- GREEN: `npx vitest run tests/perspectiveCanvas.test.ts tests/perspectivePreviewExportPixels.test.ts`
  - 2 files and all 9 tests passed.
- Native browser preview/export coverage additionally sampled an asymmetric four-color source with nontrivial source bounds, crop, and `0.5` opacity. Preview and export matched at every sample with `maxDelta: 0`; the area outside the intersection remained `[0,0,0,0]`.

### 5. Close the locked metadata bypass

- `perspectiveSourceBounds` is now a member of the central locked raster geometry-key set.
- Generic base and AI updates therefore remove that field before deciding whether to create history or mark a document dirty.
- Direct-store regressions verify both locked raster types preserve their original bounds, keep empty history, and remain unmodified.

TDD evidence:

- RED: `npx vitest run tests/storeLayerLocking.test.ts`
  - Together with finding 6, 2 of 9 tests failed; locked source-bounds metadata mutated and created state changes.
- GREEN: the same command passed all 9 tests at that stage.

### 6. Clone source bounds when duplicating the base layer

- `duplicateBaseLayer` now copies `perspectiveSourceBounds` alongside the cloned perspective quad.
- The copy is an independent rectangle object, preventing later mutation through shared identity.

TDD evidence:

- RED: `npx vitest run tests/storeLayerLocking.test.ts`
  - The duplicated AI layer had `undefined` source bounds.
- GREEN: the same command passed all 9 tests at that stage; the duplicate has equal but independently allocated metadata.

### 7. Strengthen high-level and native/browser evidence

- Added a production-component lifecycle suite around the actual exported `PlacedRasterImage` plus the real `PerspectiveOverlay`; only React-Konva primitives, the offscreen surface, and the low-level draw call are replaced at the test boundary.
- The suite covers actual corner gesture quality, source revision, resolved source identity, crop, source bounds, and opacity.
- Replaced the old source-text/regular-expression integration assertions with a behavior test of the actual `drawPlacedLayer` document compositor.
- Extended the real WebGL browser fixture with semitransparent red and blue edge strips. It validates raw premultiplied framebuffer values and the values after compositing over white.
- Retained the asymmetric high-contrast diagonal preview/export browser fixture and added the combined crop/source-bounds/opacity case without implementing a second renderer or mirroring the tessellation math.

Final native browser results from fresh fixture tabs:

- WebGL: PASS, no console errors.
  - Opaque corners: red `[255,0,0,255]`, green `[0,255,0,255]`, blue `[0,0,255,255]`, yellow `[255,255,0,255]`.
  - Semitransparent raw edges: red `[128,0,0,128]`, blue `[0,0,128,128]`.
  - Composite over white: red `[255,127,127,255]`, blue `[127,127,255,255]`.
- Canvas fallback: PASS, no console errors.
  - Four asymmetric samples retained the expected colors at alpha `64`; maximum alpha was exactly `64`, so seam overlap did not accumulate opacity.
- Preview/export: PASS, no console errors.
  - Existing high-contrast samples matched.
  - Combined partial source bounds + crop + `0.5` opacity produced the expected red/green/yellow/blue samples at alpha `128`, a transparent outside sample, and `maxDelta: 0` between preview and export.

The local Vite fixture server was stopped and the temporary fixture tabs were closed after capture.

## Files changed

Production:

- `components/editor/CanvasArea.tsx`
- `components/editor/PerspectiveOverlay.tsx`
- `store/useEditorUiStore.ts`
- `store/useStore.ts`
- `utils/lockedUpdates.ts`
- `utils/perspective.ts`
- `utils/perspectiveCanvas.ts`

Tests and browser fixtures:

- `tests/perspectiveGeometry.test.ts`
- `tests/storeLayerLocking.test.ts`
- `tests/perspectiveCanvas.test.ts`
- `tests/perspectiveIntegration.test.ts`
- `tests/perspectivePreviewLifecycle.test.tsx`
- `tests/fixtures/perspectiveWebglBrowserSmoke.ts`
- `tests/fixtures/perspectivePreviewExportBrowserSmoke.ts`
- `tests/fixtures/perspectivePreviewExportBrowserSmoke.html`

Documentation:

- `.superpowers/sdd/2026-08-13-perspective-renderer/final-fix-report.md`

## Final verification

Focused final run:

```text
npx vitest run tests/perspectiveGeometry.test.ts tests/perspectiveIntegration.test.ts tests/perspectiveInteractions.test.tsx tests/perspectivePreviewLifecycle.test.tsx tests/storeLayerLocking.test.ts tests/perspectiveCanvas.test.ts tests/perspectiveWebgl.test.ts tests/perspectivePreviewExportPixels.test.ts tests/exportRendering.test.ts tests/newEditorFeatures.test.ts
Test Files  10 passed (10)
Tests       47 passed (47)
```

Required exact full sequence was invoked once:

```text
npm test && npx tsc --noEmit && git diff --check
Test Files  38 passed (38)
Tests       146 passed (146)
```

That invocation then exposed a fixture-only TypeScript mismatch before reaching `git diff --check`: the WebGL color assertion accepted `Uint8Array`, while Canvas readback supplies `Uint8ClampedArray`. The helper was narrowed to the common `ArrayLike<number>` contract. Post-correction verification:

```text
npx tsc --noEmit && git diff --check
exit 0

npm test
Test Files  38 passed (38)
Tests       146 passed (146)
```

The test runner emits the pre-existing warning that `vitest.config.ts` uses ESM syntax while Vite currently loads it as CommonJS. It does not fail or skip tests.

## Self-review

- All invalid-quad and locked-update checks occur before history creation and mutation.
- A perspective drag still produces one history entry at gesture start; scheduled and final changes remain history-free.
- Locking never auto-unlocks a raster layer, and legacy AI layers whose optional lock field is absent remain transformable as before.
- Optional perspective fields remain optional; old documents without them continue down the established affine/non-perspective paths.
- Normalized quad storage, shared WebGL/Canvas dispatch, base/AI high-level rendering, drawing/cleanup composition, crop/source bounds, and opacity remain in their existing architecture.
- Preview quality state is scoped to the selected raster actually being dragged and is cleared across end, cancel, operation teardown, and component teardown.
- Preview revision handling checks both semantic revision and resolved object identity; the component does not display a previously rendered source under a newer revision key.
- Preview and document composition call the same production renderer for the combined rectangle behavior.
- No static source-grep or mirrored renderer/math assertion remains in the perspective integration coverage.
- `git diff --check` is clean.
- No API route, Vercel/deployment file, environment name, RouterAI/Clipdrop contract, dependency manifest, or lockfile was touched.

## Concerns

No unresolved functional concern was found in this fix wave. The only remaining output is the pre-existing Vite config-loader warning described above; changing module/dependency configuration is outside this task's permitted scope.
