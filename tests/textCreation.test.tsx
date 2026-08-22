import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextObject } from '@/types';

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
          }
        }}
        data-testid="canvas-stage"
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

describe('text creation drafts', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    seedEditor();
  });

  afterEach(() => {
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

  // Mutation caught: committing whitespace or cancelling by Escape must not
  // route through addText/delete and leave an undo snapshot behind.
  it('leaves no text or history after blank and cancelled drafts', async () => {
    const user = userEvent.setup();
    render(<CanvasArea />);
    const stage = screen.getByTestId('canvas-stage');

    clickCanvas(stage, { x: 220, y: 170 });
    await user.type(screen.getByRole('textbox'), '   {enter}');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);

    clickCanvas(stage, { x: 260, y: 200 });
    await user.keyboard('{Escape}');
    expect(useStore.getState().documents[0].texts).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  // Mutation caught: adding pushHistory before addText makes two snapshots;
  // forgetting the tool/selection updates leaves creation half-finished.
  it('commits meaningful content once, selects it and returns to Select', async () => {
    const user = userEvent.setup();
    render(<CanvasArea />);
    clickCanvas(screen.getByTestId('canvas-stage'), { x: 240, y: 180 });

    await user.type(screen.getByRole('textbox'), 'Новый текст{enter}');

    const state = useStore.getState();
    expect(state.documents[0].texts).toHaveLength(1);
    expect(state.documents[0].texts[0]).toMatchObject({ text: 'Новый текст', textMode: 'point' });
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
    await user.type(secondEditor, 'Updated{enter}');
    expect(useStore.getState().documents[0].texts[0].text).toBe('Updated');
    expect(useStore.getState().documents[0].past).toHaveLength(1);
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
});
