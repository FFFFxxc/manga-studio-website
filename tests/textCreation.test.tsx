import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextObject } from '@/types';

const stageCommitHook = vi.hoisted(() => ({
  callback: null as null | ((node: HTMLDivElement, cursor: string | undefined) => void),
}));

vi.mock('react-konva', () => {
  type Point = { x: number; y: number };
  type KonvaProps = {
    children?: React.ReactNode;
    onPointerDown?: (event: unknown) => void;
    onPointerMove?: (event: unknown) => void;
    onPointerUp?: (event: unknown) => void;
    onPointerCancel?: (event: unknown) => void;
    onClick?: (event: unknown) => void;
    onDblClick?: (event: unknown) => void;
    width?: number;
    height?: number;
    name?: string;
    style?: React.CSSProperties;
  };

  const primitiveNode = {
    nodes: vi.fn(),
    getLayer: () => ({ batchDraw: vi.fn() }),
    setAttrs: vi.fn(),
    points: vi.fn(),
    visible: vi.fn(),
    x: () => 0,
    y: () => 0,
    scaleX: () => 1,
    scaleY: () => 1,
    rotation: () => 0,
    getClassName: () => 'Group',
    name: () => '',
  };
  const textNode = { ...primitiveNode, getClassName: () => 'Text' };

  const Primitive = forwardRef<unknown, KonvaProps>(function Primitive({ children, onClick, onDblClick }, ref) {
    useImperativeHandle(ref, () => primitiveNode);
    return (
      <div
        data-konva-primitive="true"
        onClick={() => onClick?.({ target: primitiveNode })}
        onDoubleClick={() => onDblClick?.({ target: primitiveNode })}
      >
        {children}
      </div>
    );
  });

  const Text = forwardRef<unknown, KonvaProps>(function Text(props, ref) {
    useImperativeHandle(ref, () => textNode);
    return (
      <button
        type="button"
        data-testid="konva-text"
        onClick={() => props.onClick?.({ target: textNode })}
        onDoubleClick={() => props.onDblClick?.({ target: textNode })}
      />
    );
  });

  const Stage = forwardRef<unknown, KonvaProps>(function Stage(props, forwardedRef) {
    const elementRef = useRef<HTMLDivElement>(null);
    const pointer = useRef<Point>({ x: 0, y: 0 });
    const stageNode = useRef({
      getPointerPosition: () => pointer.current,
      container: () => elementRef.current,
      width: () => props.width ?? 800,
      height: () => props.height ?? 600,
      getClassName: () => 'Stage',
      name: () => '',
      toDataURL: () => 'data:image/png;base64,',
    });
    useImperativeHandle(forwardedRef, () => stageNode.current);

    const eventFor = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => ({
      evt: event.nativeEvent,
      target: (event.target as HTMLElement).closest('[data-testid="konva-text"]') ? textNode : stageNode.current,
    });
    const remember = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };

    return (
      <div
        ref={node => {
          elementRef.current = node;
          if (node) {
            Object.defineProperty(node, 'setPointerCapture', { configurable: true, value: vi.fn() });
            Object.defineProperty(node, 'releasePointerCapture', { configurable: true, value: vi.fn() });
            node.getBoundingClientRect = () => ({
              x: 0, y: 0, left: 0, top: 0,
              right: props.width ?? 800, bottom: props.height ?? 600,
              width: props.width ?? 800, height: props.height ?? 600,
              toJSON: () => ({}),
            });
            stageCommitHook.callback?.(node, props.style?.cursor);
          }
        }}
        data-testid="canvas-stage"
        style={props.style}
        onPointerDown={event => { remember(event); props.onPointerDown?.(eventFor(event)); }}
        onPointerMove={event => { remember(event); props.onPointerMove?.(eventFor(event)); }}
        onPointerUp={event => { remember(event); props.onPointerUp?.(eventFor(event)); }}
        onPointerCancel={event => { remember(event); props.onPointerCancel?.(eventFor(event)); }}
        onClick={event => { remember(event); props.onClick?.(eventFor(event)); }}
      >
        {props.children}
      </div>
    );
  });

  return {
    Stage,
    Text,
    Layer: Primitive,
    Image: Primitive,
    Line: Primitive,
    Transformer: Primitive,
    Group: Primitive,
    Rect: Primitive,
    Circle: Primitive,
    Ellipse: Primitive,
  };
});

import { CanvasArea } from '@/components/editor/CanvasArea';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let nextAnimationFrameId = 1;
let queuedAnimationFrames = new Map<number, FrameRequestCallback>();

function flushAnimationFrames() {
  const frames = [...queuedAnimationFrames.values()];
  queuedAnimationFrames.clear();
  frames.forEach(callback => callback(0));
}

function pointText(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: 'text-existing',
    text: 'Original',
    fontFamily: 'Arial',
    fontSize: 0.05,
    fill: '#000000',
    stroke: '',
    strokeWidth: 0,
    shadowColor: 'transparent',
    shadowBlur: 0,
    lineHeight: 1.2,
    align: 'left',
    width: 0.3,
    x: 0.2,
    y: 0.2,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    visible: true,
    ...overrides,
  };
}

function seedEditor(texts: TextObject[] = []) {
  seedDocuments([
    makeEditorDocument({ texts, layerOrder: texts.map(text => ({ type: 'text' as const, id: text.id })) }),
  ]);
}

function seedDocuments(documents: ReturnType<typeof makeEditorDocument>[]) {
  useStore.setState({
    documents,
    activeDocIndex: 0,
    activeTool: 'text',
    selectedObject: null,
    inlineEditingTextId: null,
    viewport: { x: 0, y: 0, scale: 1 },
  });
}

function clickCanvas(stage: HTMLElement, point: { x: number; y: number }) {
  fireEvent.pointerDown(stage, { button: 0, pointerId: 1, clientX: point.x, clientY: point.y });
  fireEvent.pointerUp(stage, { button: 0, pointerId: 1, clientX: point.x, clientY: point.y });
  fireEvent.click(stage, { button: 0, clientX: point.x, clientY: point.y });
}

function dragCanvas(stage: HTMLElement, start: { x: number; y: number }, end: { x: number; y: number }) {
  fireEvent.pointerDown(stage, { button: 0, pointerId: 2, clientX: start.x, clientY: start.y });
  fireEvent.pointerMove(stage, { button: 0, pointerId: 2, clientX: end.x, clientY: end.y });
  fireEvent.pointerUp(stage, { button: 0, pointerId: 2, clientX: end.x, clientY: end.y });
}

function dispatchUnflushedPointer(
  target: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointercancel',
  init: MouseEventInit & { pointerId: number },
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  target.dispatchEvent(event);
}

describe('text creation drafts', () => {
  beforeEach(() => {
    stageCommitHook.callback = null;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    nextAnimationFrameId = 1;
    queuedAnimationFrames = new Map();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = nextAnimationFrameId++;
      queuedAnimationFrames.set(id, callback);
      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      queuedAnimationFrames.delete(id);
    });
    seedEditor();
  });

  afterEach(() => {
    stageCommitHook.callback = null;
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Mutation caught: restoring click-time addText/pushHistory recreates a
  // serialized text layer before the user has supplied meaningful content.
  it('does not write a text object until non-empty content is committed', () => {
    render(<CanvasArea />);
    clickCanvas(screen.getByTestId('canvas-stage'), { x: 240, y: 180 });

    expect(screen.getByRole('textbox').getAttribute('data-text-mode')).toBe('point');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  // Mutation caught: treating every pointer gesture as a point click loses the
  // rectangle dimensions and prevents paragraph text creation.
  it('opens a paragraph draft after dragging a rectangle', () => {
    render(<CanvasArea />);
    dragCanvas(screen.getByTestId('canvas-stage'), { x: 200, y: 160 }, { x: 500, y: 320 });

    expect(screen.getByRole('textbox').getAttribute('data-text-mode')).toBe('paragraph');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  // Mutation caught: scheduling one frame per move or capturing the first end
  // point makes fast drags render stale geometry instead of the latest point.
  it('coalesces draft frames and renders the latest queued geometry', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 3, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 3, clientX: 320, clientY: 240 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 3, clientX: 500, clientY: 320 });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(flushAnimationFrames);

    expect(Number.parseFloat(screen.getByTestId('text-draft-overlay').style.width)).toBeCloseTo(300, 5);
  });

  // Mutation caught: forgetting to cancel the queued frame lets a stale draft
  // overlay reappear after pointer cancellation.
  it('cancels an unflushed draft frame with the gesture', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 4, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 4, clientX: 500, clientY: 320 });
    expect(queuedAnimationFrames).toHaveLength(1);

    fireEvent.pointerCancel(stage, { pointerId: 4, clientX: 500, clientY: 320 });
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(queuedAnimationFrames).toHaveLength(0);
    act(flushAnimationFrames);

    expect(screen.queryByTestId('text-draft-overlay')).toBeNull();
  });

  // Mutation caught: leaving overflow state behind after closing an editor
  // inserts a stale '+' into the next paragraph before it can measure itself.
  it('does not flash an old paragraph overflow marker on the next draft', async () => {
    const user = userEvent.setup();
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');

    dragCanvas(stage, { x: 200, y: 160 }, { x: 500, y: 320 });
    const overflowingEditor = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperties(overflowingEditor, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 180 },
    });
    fireEvent.input(overflowingEditor);
    expect(screen.getByTestId('paragraph-text-overflow-marker')).toBeTruthy();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('paragraph-text-overflow-marker')).toBeNull();

    const markerAdds: Element[] = [];
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches('[data-testid="paragraph-text-overflow-marker"]')) markerAdds.push(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    dragCanvas(stage, { x: 220, y: 180 }, { x: 460, y: 300 });
    await Promise.resolve();
    observer.disconnect();

    expect(markerAdds).toHaveLength(0);
    expect(screen.queryByTestId('paragraph-text-overflow-marker')).toBeNull();

    const nonOverflowingEditor = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperties(nonOverflowingEditor, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 120 },
    });
    fireEvent.input(nonOverflowingEditor);
    expect(screen.queryByTestId('paragraph-text-overflow-marker')).toBeNull();
  });

  // Mutation caught: using the untransformed box corner places the marker far
  // from an editor that has its own CSS rotation and scale transform.
  it('anchors a transformed paragraph overflow marker at its visual lower-right corner', () => {
    seedEditor([pointText({
      textMode: 'paragraph',
      width: 0.2,
      height: 0.15,
      rotation: 90,
      scaleX: 2,
      scaleY: 0.5,
    })]);
    render(<CanvasArea />);

    fireEvent.doubleClick(screen.getByTestId('konva-text'));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 120 },
      scrollHeight: { configurable: true, value: 180 },
    });
    fireEvent.input(editor);

    const marker = screen.getByTestId('paragraph-text-overflow-marker');
    // At the fitted test viewport, local lower-right (140, 84) becomes
    // scale(2, .5) -> rotate(90deg) = (-42, 280), then adds origin (190, 132).
    expect(Number.parseFloat(marker.style.left)).toBeCloseTo(151, 5);
    expect(Number.parseFloat(marker.style.top)).toBeCloseTo(415, 5);
  });

  // Mutation caught: deriving marker geometry from an unclamped normalized
  // box loses the textarea's 80px/1px border-box minima at low zoom.
  it('uses the clamped paragraph editor dimensions for a transformed overflow marker', () => {
    seedEditor([pointText({
      textMode: 'paragraph',
      width: 0.01,
      height: 0.0001,
      rotation: 90,
      scaleX: 2,
      scaleY: 0.5,
    })]);
    render(<CanvasArea />);

    fireEvent.doubleClick(screen.getByTestId('konva-text'));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 1 },
      scrollHeight: { configurable: true, value: 180 },
    });
    fireEvent.input(editor);

    const marker = screen.getByTestId('paragraph-text-overflow-marker');
    const originX = Number.parseFloat(editor.style.left);
    const originY = Number.parseFloat(editor.style.top);
    const editorWidth = Number.parseFloat(editor.style.width);
    const editorHeight = Number.parseFloat(editor.style.height);
    const radians = Math.PI / 2;
    const expectedX = originX + editorWidth * 2 * Math.cos(radians) - editorHeight * 0.5 * Math.sin(radians) + 3;
    const expectedY = originY + editorWidth * 2 * Math.sin(radians) + editorHeight * 0.5 * Math.cos(radians) + 3;

    expect(editorWidth).toBe(80);
    expect(editorHeight).toBe(1);
    expect(Number.parseFloat(marker.style.left)).toBeCloseTo(expectedX, 5);
    expect(Number.parseFloat(marker.style.top)).toBeCloseTo(expectedY, 5);
  });

  // Mutation caught: committing whitespace or cancelling by Escape must not
  // route through addText/delete and leave an undo snapshot behind.
  it('leaves no text or history after blank and cancelled drafts', async () => {
    const user = userEvent.setup();
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');

    clickCanvas(stage, { x: 220, y: 170 });
    await user.type(screen.getByRole('textbox'), '   {Control>}{Enter}{/Control}');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);

    clickCanvas(stage, { x: 260, y: 200 });
    await user.keyboard('{Escape}');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  // Mutation caught: adding pushHistory before addText makes two snapshots;
  // forgetting the tool/selection updates leaves creation half-finished.
  it('commits one paragraph once, selects it and returns to Select', async () => {
    const user = userEvent.setup();
    render(<CanvasArea />);
    dragCanvas(screen.getByTestId('canvas-stage'), { x: 200, y: 160 }, { x: 500, y: 320 });

    await user.type(screen.getByRole('textbox'), 'Длинная строка для переноса{Control>}{Enter}{/Control}');

    const state = useStore.getState();
    expect(state.documents[0].texts).toHaveLength(1);
    expect(state.documents[0].texts[0]).toMatchObject({ text: 'Длинная строка для переноса', textMode: 'paragraph' });
    expect(state.documents[0].past).toHaveLength(1);
    expect(state.selectedObject).toEqual({ type: 'text', id: state.documents[0].texts[0].id });
    expect(state.activeTool).toBe('select');
  });

  // Mutation caught: global pointerup must finish the geometry even when the
  // release is delivered outside the mocked Konva stage.
  it('finishes a text rectangle on global pointerup outside the canvas', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 7, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 7, clientX: 500, clientY: 320 });
    fireEvent.pointerUp(window, { button: 0, pointerId: 7, clientX: 700, clientY: 500 });

    expect(screen.getByRole('textbox').getAttribute('data-text-mode')).toBe('paragraph');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
  });

  // Mutation caught: Escape must not publish an existing edit or erase the
  // original text, while a later meaningful edit takes one history snapshot.
  it('cancels an existing edit and commits a later edit once', async () => {
    const user = userEvent.setup();
    seedEditor([pointText()]);
    render(<CanvasArea />);

    await user.dblClick(screen.getByTestId('konva-text'));
    const firstEditor = screen.getByRole('textbox');
    await user.clear(firstEditor);
    await user.type(firstEditor, 'Discarded{Escape}');
    expect(useStore.getState().documents[0].texts[0].text).toBe('Original');
    expect(useStore.getState().documents[0].past).toHaveLength(0);

    await user.dblClick(screen.getByTestId('konva-text'));
    const secondEditor = screen.getByRole('textbox');
    await user.clear(secondEditor);
    await user.type(secondEditor, 'Updated{Control>}{Enter}{/Control}');
    expect(useStore.getState().documents[0].texts[0].text).toBe('Updated');
    expect(useStore.getState().documents[0].past).toHaveLength(1);
    act(() => useStore.getState().undo());
    expect(useStore.getState().documents[0].texts[0].text).toBe('Original');
  });

  // Mutation caught: keeping an original draft after another action deletes
  // the object lets its stale blur/commit add a second no-op history snapshot.
  it('cancels an existing editor when its text is deleted externally', async () => {
    const user = userEvent.setup();
    seedEditor([pointText()]);
    render(<CanvasArea />);

    await user.dblClick(screen.getByTestId('konva-text'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Stale update' } });
    act(() => useStore.getState().deleteText('text-existing'));

    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.blur(editor);
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(1);
    expect(useStore.getState().selectedObject).toBeNull();
  });

  it('does not create a draft when the Text tool clicks existing text', () => {
    seedEditor([pointText()]);
    render(<CanvasArea />);

    const text = screen.getByTestId('konva-text');
    fireEvent.pointerDown(text, { button: 0, pointerId: 10, clientX: 240, clientY: 180 });
    fireEvent.pointerUp(text, { button: 0, pointerId: 10, clientX: 240, clientY: 180 });
    fireEvent.click(text, { button: 0, clientX: 240, clientY: 180 });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(useStore.getState().documents[0].texts).toHaveLength(1);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('cancels an uncommitted geometry draft on pointercancel or blur', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');

    fireEvent.pointerDown(stage, { button: 0, pointerId: 8, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 8, clientX: 500, clientY: 320 });
    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();
    fireEvent.pointerCancel(window, { pointerId: 8 });
    expect(screen.queryByTestId('text-draft-overlay')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.pointerDown(stage, { button: 0, pointerId: 9, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 9, clientX: 500, clientY: 320 });
    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();
    act(() => window.dispatchEvent(new Event('blur')));
    expect(screen.queryByTestId('text-draft-overlay')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('cancels a new draft when the active document changes', () => {
    seedDocuments([
      makeEditorDocument({ id: 'doc-origin', name: 'origin.png' }),
      makeEditorDocument({ id: 'doc-other', name: 'other.png' }),
    ]);
    render(<CanvasArea />);
    clickCanvas(screen.getByTestId('canvas-stage'), { x: 240, y: 180 });
    expect(screen.getByRole('textbox')).toBeTruthy();

    act(() => useStore.getState().setActiveDoc(1));

    expect(screen.queryByRole('textbox')).toBeNull();
    const state = useStore.getState();
    expect(state.documents[0].texts).toHaveLength(0);
    expect(state.documents[1].texts).toHaveLength(0);
    expect(state.documents[0].past).toHaveLength(0);
    expect(state.documents[1].past).toHaveLength(0);
  });

  it('cancels in-progress text geometry when the active document changes', () => {
    seedDocuments([
      makeEditorDocument({ id: 'doc-origin', name: 'origin.png' }),
      makeEditorDocument({ id: 'doc-other', name: 'other.png' }),
    ]);
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 15, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 15, clientX: 500, clientY: 320 });
    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();

    act(() => useStore.getState().setActiveDoc(1));
    expect(screen.queryByTestId('text-draft-overlay')).toBeNull();
    fireEvent.pointerUp(window, { button: 0, pointerId: 15, clientX: 500, clientY: 320 });

    expect(screen.queryByRole('textbox')).toBeNull();
    const state = useStore.getState();
    expect(state.documents[0].texts).toHaveLength(0);
    expect(state.documents[1].texts).toHaveLength(0);
    expect(state.documents[0].past).toHaveLength(0);
    expect(state.documents[1].past).toHaveLength(0);
  });

  it('cancels an existing edit on document change without touching either page', () => {
    const original = pointText({ id: 'origin-text' });
    seedDocuments([
      makeEditorDocument({
        id: 'doc-origin',
        name: 'origin.png',
        texts: [original],
        layerOrder: [{ type: 'text', id: original.id }],
      }),
      makeEditorDocument({ id: 'doc-other', name: 'other.png' }),
    ]);
    render(<CanvasArea />);
    fireEvent.doubleClick(screen.getByTestId('konva-text'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: 'Must not move pages' } });

    act(() => useStore.getState().setActiveDoc(1));
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter' });

    expect(screen.queryByRole('textbox')).toBeNull();
    const state = useStore.getState();
    expect(state.documents[0].texts[0].text).toBe('Original');
    expect(state.documents[1].texts).toHaveLength(0);
    expect(state.documents[0].past).toHaveLength(0);
    expect(state.documents[1].past).toHaveLength(0);
  });

  it('does not let a second pointer replace or finish the active text gesture', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 21, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 21, clientX: 320, clientY: 240 });
    const initialWidth = screen.getByTestId('text-draft-overlay').style.width;

    fireEvent.pointerDown(stage, { button: 0, pointerId: 22, clientX: 600, clientY: 400 });
    expect(screen.getByTestId('text-draft-overlay').style.width).toBe(initialWidth);
    fireEvent.pointerUp(stage, { button: 0, pointerId: 22, clientX: 700, clientY: 500 });

    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.pointerUp(stage, { button: 0, pointerId: 21, clientX: 320, clientY: 240 });
    expect(screen.getByRole('textbox').getAttribute('data-text-mode')).toBe('paragraph');
  });

  it('ignores mismatched pointer move, cancel and up events', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 31, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 31, clientX: 320, clientY: 240 });
    const initialWidth = screen.getByTestId('text-draft-overlay').style.width;

    fireEvent.pointerMove(stage, { button: 0, pointerId: 32, clientX: 700, clientY: 500 });
    expect(screen.getByTestId('text-draft-overlay').style.width).toBe(initialWidth);
    fireEvent.pointerCancel(stage, { pointerId: 32, clientX: 700, clientY: 500 });
    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();
    fireEvent.pointerUp(stage, { button: 0, pointerId: 32, clientX: 700, clientY: 500 });
    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.pointerUp(stage, { button: 0, pointerId: 31, clientX: 320, clientY: 240 });
    expect(screen.getByRole('textbox').getAttribute('data-text-mode')).toBe('paragraph');
  });

  it('keeps a second middle-button pointer out of an active text gesture', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 41, clientX: 200, clientY: 160 });
    const viewportBeforeSecondPointer = { ...useStore.getState().viewport };

    fireEvent.pointerDown(stage, { button: 1, pointerId: 42, clientX: 350, clientY: 260 });
    fireEvent.pointerMove(stage, { button: 1, pointerId: 42, clientX: 450, clientY: 360 });
    fireEvent.pointerCancel(stage, { pointerId: 42, clientX: 450, clientY: 360 });

    expect(useStore.getState().viewport).toEqual(viewportBeforeSecondPointer);
    expect(screen.getByTestId('text-draft-overlay')).toBeTruthy();
    fireEvent.pointerMove(stage, { button: 0, pointerId: 41, clientX: 500, clientY: 320 });
    fireEvent.pointerUp(stage, { button: 0, pointerId: 41, clientX: 500, clientY: 320 });

    const editor = screen.getByRole('textbox');
    expect(editor.getAttribute('data-text-mode')).toBe('paragraph');
    expect(Number.parseFloat(editor.style.width)).toBeCloseTo(300, 5);
  });

  it('keeps transient text ownership after the active tool changes', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');
    fireEvent.pointerDown(stage, { button: 0, pointerId: 51, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(stage, { button: 0, pointerId: 51, clientX: 320, clientY: 240 });
    const viewportBeforeSecondPointer = { ...useStore.getState().viewport };
    const overlayWidthBeforeSecondPointer = screen.getByTestId('text-draft-overlay').style.width;

    let transientResult: { viewport: typeof viewportBeforeSecondPointer; overlayWidth: string } | null = null;
    stageCommitHook.callback = (node, cursor) => {
      if (cursor !== 'default') return;
      stageCommitHook.callback = null;
      dispatchUnflushedPointer(node, 'pointerdown', {
        button: 1, pointerId: 52, clientX: 350, clientY: 260,
      });
      dispatchUnflushedPointer(node, 'pointermove', {
        button: 1, pointerId: 52, clientX: 450, clientY: 360,
      });
      dispatchUnflushedPointer(node, 'pointercancel', {
        button: 1, pointerId: 52, clientX: 450, clientY: 360,
      });
      transientResult = {
        viewport: { ...useStore.getState().viewport },
        overlayWidth: screen.getByTestId('text-draft-overlay').style.width,
      };
    };

    act(() => useStore.getState().setActiveTool('select'));

    expect(transientResult).toEqual({
      viewport: viewportBeforeSecondPointer,
      overlayWidth: overlayWidthBeforeSecondPointer,
    });
    expect(screen.queryByTestId('text-draft-overlay')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });
});
