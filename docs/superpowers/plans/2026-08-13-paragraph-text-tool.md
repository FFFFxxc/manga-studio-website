# Photoshop-like Paragraph Text Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Text tool create a real draggable paragraph box, wrap text when its handles resize, avoid accidental layers, and return to Select after a successful commit.

**Architecture:** Add backward-compatible paragraph metadata to `TextObject`, keep new text as a local draft until it has meaningful content, and use a focused text-box geometry helper for drag thresholds and Transformer normalization. Reuse the existing DOM textarea, expanding it to explicit height and multiline commit semantics.

**Tech Stack:** TypeScript, React 19, React Konva, DOM textarea, Zustand, Vitest, Testing Library.

## Global Constraints

- Existing saved documents and translated text objects without new fields must still render and export.
- A blank click or cancelled draft must not create a layer or history entry.
- `Enter` inserts a newline; `Ctrl/Cmd+Enter` commits; `Esc` cancels.
- After successful creation, activate Select automatically.
- Resizing a paragraph box changes width/height and wrapping, not glyph scale.
- One create/edit/resize gesture creates one history entry.
- Do not modify API routes or translation contracts.

---

### Task 1: Backward-compatible text box model and geometry helpers

**Files:**
- Modify: `types/index.ts`
- Create: `utils/textBox.ts`
- Modify: `utils/coordinates.ts`
- Modify: `utils/textRenderer.ts`
- Test: `tests/textBox.test.ts`
- Test: `tests/textRenderer.test.ts`

**Interfaces:**
- Produces: `TextMode = 'point' | 'paragraph'`
- Produces: `TextObject.textMode?: TextMode`, `TextObject.height?: number`
- Produces: `createTextDraftRect(start, end, documentSize, thresholdPx): TextDraftRect`
- Produces: `normalizeParagraphTransform(text, nodeBox, documentSize): Partial<TextObject>`

- [ ] **Step 1: Write failing geometry tests**

```ts
import { describe, expect, it } from 'vitest';
import { createTextDraftRect, normalizeParagraphTransform } from '@/utils/textBox';

describe('paragraph text geometry', () => {
  it('treats a short gesture as point text', () => {
    expect(createTextDraftRect({ x: 100, y: 100 }, { x: 102, y: 101 }, { width: 1000, height: 800 }, 5).mode).toBe('point');
  });

  it('normalizes reverse drag into a paragraph rectangle', () => {
    expect(createTextDraftRect({ x: 500, y: 400 }, { x: 200, y: 100 }, { width: 1000, height: 800 }, 5)).toMatchObject({
      mode: 'paragraph', x: .2, y: .125, width: .3, height: .375,
    });
  });

  it('bakes horizontal transformer scale into width', () => {
    expect(normalizeParagraphTransform(
      { width: .2, height: .1 },
      { x: 100, y: 80, width: 200, height: 100, scaleX: 1.5, scaleY: 1 },
      { width: 1000, height: 800 },
    )).toMatchObject({ width: .3, height: .125, scaleX: 1, scaleY: 1 });
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run tests/textBox.test.ts tests/textRenderer.test.ts`

Expected: FAIL because `utils/textBox.ts` and the new fields do not exist.

- [ ] **Step 3: Implement model and pure helpers**

```ts
export type TextMode = 'point' | 'paragraph';

export interface TextDraftRect {
  mode: TextMode;
  x: number;
  y: number;
  width: number;
  height?: number;
}
```

Use a minimum normalized paragraph width/height equal to 24 document pixels. Point mode uses the current `textSettings.width` and leaves height undefined.

- [ ] **Step 4: Sanitize and render height without breaking legacy text**

`sanitizeText` accepts only finite positive `height`, defaults missing `textMode` to the existing behavior, and never discards a legacy object. `renderTextObjectToContext` clips only paragraph text with an explicit height; point/legacy text remains unclipped.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/textBox.test.ts tests/textRenderer.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the model**

```bash
git add types/index.ts utils/textBox.ts utils/coordinates.ts utils/textRenderer.ts tests/textBox.test.ts tests/textRenderer.test.ts
git commit -m "feat: add paragraph text box model"
```

### Task 2: Local text draft state and drag-to-create interaction

**Files:**
- Create: `components/editor/TextDraftOverlay.tsx`
- Modify: `components/editor/CanvasArea.tsx`
- Create: `tests/helpers/makeEditorDocument.ts`
- Test: `tests/textCreation.test.tsx`

**Interfaces:**
- Consumes: `createTextDraftRect`
- Produces: local `PendingTextDraft` with `{ id, object, original?: TextObject }`
- Produces: `commitTextDraft(value): void` and `cancelTextDraft(): void` inside CanvasArea.

- [ ] **Step 1: Write RED component tests for accidental clicks and drag creation**

```tsx
it('does not write a text object until non-empty content is committed', async () => {
  render(<CanvasArea />);
  await selectTextToolAndClickCanvas(user, { x: 240, y: 180 });
  expect(useStore.getState().documents[0].texts).toHaveLength(0);
  expect(useStore.getState().documents[0].past).toHaveLength(0);
});

it('opens a paragraph draft after dragging a rectangle', async () => {
  render(<CanvasArea />);
  await dragOnCanvas(user, { x: 200, y: 160 }, { x: 500, y: 320 });
  expect(screen.getByRole('textbox')).toHaveAttribute('data-text-mode', 'paragraph');
  expect(useStore.getState().documents[0].texts).toHaveLength(0);
});
```

Create `tests/helpers/makeEditorDocument.ts` with an exported `makeEditorDocument(overrides?: Partial<ImageDocument>)` that returns the same complete document shape used by `tests/newEditorFeatures.test.ts`, including `createBaseLayerState(id)`, empty layer collections, and empty history. In the component test, mock `react-konva` with DOM elements that forward `onPointerDown`, `onPointerMove`, `onPointerUp`, and `onClick`, then seed `useStore` with this helper. Do not expose a production-only global.

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/textCreation.test.tsx`

Expected: FAIL because a click immediately calls `addText` and no drag draft exists.

- [ ] **Step 3: Add pointer lifecycle for text drafts**

On left-button pointer down while Text is active, store the normalized start point in a ref and capture the actual event target. On rAF pointer move update only local overlay state. On pointer up call `createTextDraftRect` and open `InlineTextEditor` against the draft object. Do not call `pushHistory`, `addText`, or Zustand during the gesture.

- [ ] **Step 4: Implement commit/cancel rules**

```ts
function commitTextDraft(value: string) {
  const meaningful = value.trim().length > 0;
  if (!pendingTextDraft) return;
  if (!meaningful) {
    cancelTextDraft();
    return;
  }
  pushHistory();
  addText({ ...pendingTextDraft.object, text: value });
  setSelectedObject({ type: 'text', id: pendingTextDraft.id });
  setActiveTool('select');
  clearDraftState();
}
```

Editing an existing object restores its original content on `Esc` and updates it once on commit.

- [ ] **Step 5: Preserve global pointerup/pointercancel/blur safeguards**

Pointerup outside the canvas finishes the drag and opens the editor. Pointercancel/window blur cancels an uncommitted geometry draft. Do not alter brush coalesced events or their pointer capture target.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/textCreation.test.tsx tests/editorShortcuts.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit draft interaction**

```bash
git add components/editor/CanvasArea.tsx components/editor/TextDraftOverlay.tsx tests/helpers/makeEditorDocument.ts tests/textCreation.test.tsx
git commit -m "fix: prevent accidental text layers"
```

### Task 3: Multiline inline editor and Photoshop-style commit semantics

**Files:**
- Modify: `components/editor/InlineTextEditor.tsx`
- Modify: `components/editor/CanvasArea.tsx`
- Test: `tests/InlineTextEditor.test.tsx`

**Interfaces:**
- Consumes: paragraph `height` and `textMode`
- Produces: `onCommit(text)` only for Ctrl/Cmd+Enter or blur; plain Enter remains input.
- Produces: `onCancel()` on Escape without a subsequent blur commit.

- [ ] **Step 1: Write RED keyboard tests**

```tsx
it('inserts a newline with Enter and commits with Meta+Enter', async () => {
  const onCommit = vi.fn();
  render(<InlineTextEditor {...props} onCommit={onCommit} />);
  const editor = screen.getByRole('textbox');
  await user.type(editor, 'Первая{enter}Вторая');
  expect(editor).toHaveValue('Первая\nВторая');
  expect(onCommit).not.toHaveBeenCalled();
  await user.keyboard('{Meta>}{Enter}{/Meta}');
  expect(onCommit).toHaveBeenCalledWith('Первая\nВторая');
});

it('cancels once on Escape and ignores the following blur', async () => {
  const onCancel = vi.fn();
  const onCommit = vi.fn();
  render(<InlineTextEditor {...props} onCancel={onCancel} onCommit={onCommit} />);
  await user.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onCommit).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/InlineTextEditor.test.tsx`

Expected: FAIL because plain Enter currently commits.

- [ ] **Step 3: Implement multiline keyboard behavior and explicit paragraph height**

Track a `finishedRef`; both commit and cancel set it before causing focus changes. For paragraph mode use fixed `height`, `overflow: hidden`, and `resize: none`. For point mode retain auto-grow.

- [ ] **Step 4: Add overflow measurement**

Set `data-overflowing={scrollHeight > clientHeight}` after every input, width/height change, and font load. CanvasArea uses this to show a small `+` overflow marker at the lower-right corner of a selected paragraph box.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/InlineTextEditor.test.tsx tests/textCreation.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit editor semantics**

```bash
git add components/editor/InlineTextEditor.tsx components/editor/CanvasArea.tsx tests/InlineTextEditor.test.tsx
git commit -m "feat: add multiline text editing"
```

### Task 4: Resize paragraph boxes without stretching glyphs

**Files:**
- Modify: `components/editor/CanvasArea.tsx`
- Modify: `utils/textRenderer.ts`
- Test: `tests/textTransform.test.ts`

**Interfaces:**
- Consumes: `normalizeParagraphTransform`
- Produces: side and corner anchors for paragraph boxes; point/legacy behavior remains compatible.

- [ ] **Step 1: Write RED transform normalization tests**

```ts
it('changes paragraph width and height while resetting both scales', () => {
  const update = normalizeParagraphTransform(
    { width: .25, height: .12 },
    { x: 100, y: 120, width: 250, height: 120, scaleX: 1.4, scaleY: .75 },
    { width: 1000, height: 1000 },
  );
  expect(update).toMatchObject({ width: .35, height: .09, scaleX: 1, scaleY: 1 });
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx vitest run tests/textTransform.test.ts`

Expected: FAIL until paragraph Transformer uses the helper.

- [ ] **Step 3: Configure the Transformer by mode**

Paragraph text enables all eight resize anchors plus rotation and `keepRatio={false}`. On `transform`, update the Konva node width/height immediately and reset scales so wrapping is visible during the gesture. On `transformEnd`, store normalized x/y/width/height with scales 1. Point/legacy text retains corner scaling until explicitly converted.

- [ ] **Step 4: Add explicit modifier scaling**

When Ctrl/Cmd is held during corner transform, preserve proportional `scaleX/scaleY` and font size behavior rather than paragraph reflow. The normal path always reflows.

- [ ] **Step 5: Verify one history entry**

History is pushed on `onTransformStart`, never during transform frames, and the final `updateText` uses `{ history: false }`.

- [ ] **Step 6: Run text and store tests**

Run: `npx vitest run tests/textBox.test.ts tests/textTransform.test.ts tests/storeLayerLocking.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 7: Commit paragraph resize**

```bash
git add components/editor/CanvasArea.tsx utils/textBox.ts utils/textRenderer.ts tests/textTransform.test.ts
git commit -m "feat: resize text boxes with reflow"
```

### Task 5: Text UX regression and export verification

**Files:**
- Modify: `components/editor/ToolOptionsBar.tsx`
- Modify: `components/editor/panels/TextPanel.tsx`
- Test: `tests/textWorkflow.test.tsx`
- Test: `tests/textRenderer.test.ts`

**Interfaces:**
- Consumes: paragraph model and draft lifecycle.
- Produces: visible Text tool hint describing drag, Enter, commit, and cancel.

- [ ] **Step 1: Add workflow tests**

```tsx
it('creates one paragraph layer, selects it, and switches to Select', async () => {
  await createParagraphText(user, 'Длинная строка для переноса');
  const state = useStore.getState();
  expect(state.documents[0].texts).toHaveLength(1);
  expect(state.documents[0].past).toHaveLength(1);
  expect(state.activeTool).toBe('select');
  expect(state.selectedObject).toEqual({ type: 'text', id: state.documents[0].texts[0].id });
});
```

Add these assertions to the workflow suite:

```tsx
await createBlankTextAndBlur(user);
expect(currentDocument().texts).toHaveLength(0);
await createTextAndPressEscape(user, 'Отмена');
expect(currentDocument().texts).toHaveLength(0);
await editExistingText(user, 'Старый', 'Новый');
expect(currentDocument().texts[0].text).toBe('Новый');
useStore.getState().undo();
expect(currentDocument().texts[0].text).toBe('Старый');
expect(() => renderLegacyTextWithoutMode()).not.toThrow();
```

- [ ] **Step 2: Add the concise UI hint**

Display: `Потяните рамку · Enter — новая строка · Ctrl/⌘+Enter — готово · Esc — отмена` while Text is active. Remove wording that implies every click immediately creates text.

- [ ] **Step 3: Run all tests and production build**

Run: `npm test && npx tsc --noEmit && npm run build && git diff --check`

Expected: PASS.

- [ ] **Step 4: Browser smoke**

1. Drag a narrow text box and enter several words; verify wrapping.
2. Resize left/right handles; verify glyph width stays unchanged.
3. Press Enter for a second paragraph and Ctrl/Cmd+Enter to commit.
4. Verify Select becomes active.
5. Activate Text, click repeatedly, press Esc/leave blank; verify no layers appear.
6. Export PNG and compare line wrapping to editor preview.

- [ ] **Step 5: Commit final text UX**

```bash
git add components/editor/ToolOptionsBar.tsx components/editor/panels/TextPanel.tsx tests/textWorkflow.test.tsx tests/textRenderer.test.ts
git commit -m "test: verify paragraph text workflow"
```
