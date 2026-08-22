import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextObject } from '@/types';

const konvaHarness = vi.hoisted(() => ({
  textProps: null as Record<string, unknown> | null,
  transformerProps: null as Record<string, unknown> | null,
  textNode: null as Record<string, unknown> | null,
  activeAnchor: 'bottom-right' as string | null,
  transformerKeepRatio: false,
}));

vi.mock('react-konva', () => {
  interface KonvaProps {
    children?: React.ReactNode;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
  }

  function valueAccessor(state: Record<string, number>, key: string) {
    return (value?: number) => {
      if (value !== undefined) state[key] = value;
      return state[key];
    };
  }

  const layer = { batchDraw: vi.fn() };
  const primitiveNode = {
    nodes: vi.fn(),
    getLayer: () => layer,
    setAttrs: vi.fn(),
    points: vi.fn(),
    visible: vi.fn(),
    getClassName: () => 'Group',
    name: () => '',
  };
  const transformerNode = {
    ...primitiveNode,
    getActiveAnchor: () => konvaHarness.activeAnchor,
    keepRatio: (value?: boolean) => {
      if (value !== undefined) konvaHarness.transformerKeepRatio = value;
      return konvaHarness.transformerKeepRatio;
    },
  };

  const Primitive = forwardRef<unknown, KonvaProps>(function Primitive({ children }, ref) {
    useImperativeHandle(ref, () => primitiveNode);
    return React.createElement('div', null, children);
  });

  const Text = forwardRef<unknown, KonvaProps>(function Text(props, ref) {
    const state = useRef<Record<string, number>>({
      x: Number(props.x ?? 0),
      y: Number(props.y ?? 0),
      width: Number(props.width ?? 0),
      height: Number(props.height ?? 0),
      scaleX: Number(props.scaleX ?? 1),
      scaleY: Number(props.scaleY ?? 1),
      rotation: Number(props.rotation ?? 0),
    });
    const node = useRef({
      x: valueAccessor(state.current, 'x'),
      y: valueAccessor(state.current, 'y'),
      width: valueAccessor(state.current, 'width'),
      height: valueAccessor(state.current, 'height'),
      scaleX: valueAccessor(state.current, 'scaleX'),
      scaleY: valueAccessor(state.current, 'scaleY'),
      rotation: valueAccessor(state.current, 'rotation'),
      getClassName: () => 'Text',
      name: () => '',
    });
    konvaHarness.textProps = props as Record<string, unknown>;
    konvaHarness.textNode = node.current;
    useImperativeHandle(ref, () => node.current);
    return React.createElement('button', { type: 'button', 'data-testid': 'konva-text' });
  });

  const Transformer = forwardRef<unknown, KonvaProps>(function Transformer(props, ref) {
    konvaHarness.transformerProps = props as Record<string, unknown>;
    konvaHarness.transformerKeepRatio = Boolean((props as { keepRatio?: boolean }).keepRatio);
    useImperativeHandle(ref, () => transformerNode);
    return React.createElement('div', { 'data-testid': 'konva-transformer' });
  });

  const Stage = forwardRef<unknown, KonvaProps>(function Stage(props, ref) {
    const elementRef = useRef<HTMLDivElement>(null);
    const node = useRef({
      getPointerPosition: () => ({ x: 0, y: 0 }),
      container: () => elementRef.current,
      width: () => Number(props.width ?? 800),
      height: () => Number(props.height ?? 600),
      getClassName: () => 'Stage',
      name: () => '',
      toDataURL: () => 'data:image/png;base64,',
    });
    useImperativeHandle(ref, () => node.current);
    return React.createElement('div', { ref: elementRef }, props.children);
  });

  return {
    Stage,
    Text,
    Transformer,
    Layer: Primitive,
    Image: Primitive,
    Line: Primitive,
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

function makeText(overrides: Partial<TextObject> = {}): TextObject {
  return {
    id: 'text-transform',
    text: 'A paragraph long enough to wrap onto another line',
    fontFamily: 'Arial',
    fontSize: 0.05,
    fill: '#000000',
    stroke: '',
    strokeWidth: 0,
    shadowColor: 'transparent',
    shadowBlur: 0,
    lineHeight: 1.2,
    align: 'left',
    textMode: 'paragraph',
    width: 0.25,
    height: 0.12,
    x: 0.1,
    y: 0.12,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    visible: true,
    ...overrides,
  };
}

function seedText(text: TextObject) {
  const document = makeEditorDocument({
    width: 1000,
    height: 1000,
    texts: [text],
    layerOrder: [{ type: 'text', id: text.id }],
  });
  useStore.setState({
    documents: [document],
    activeDocIndex: 0,
    activeTool: 'select',
    selectedObject: { type: 'text', id: text.id },
    inlineEditingTextId: null,
    viewport: { x: 0, y: 0, scale: 1 },
  });
}

function textProps() {
  expect(konvaHarness.textProps).not.toBeNull();
  return konvaHarness.textProps as {
    onTransformStart: (event: { evt?: { ctrlKey?: boolean; metaKey?: boolean } }) => void;
    onTransform: (event: { evt?: { ctrlKey?: boolean; metaKey?: boolean } }) => void;
    onTransformEnd: (event: { evt?: { ctrlKey?: boolean; metaKey?: boolean } }) => void;
  };
}

function textNode() {
  expect(konvaHarness.textNode).not.toBeNull();
  return konvaHarness.textNode as {
    x: (value?: number) => number;
    y: (value?: number) => number;
    width: (value?: number) => number;
    height: (value?: number) => number;
    scaleX: (value?: number) => number;
    scaleY: (value?: number) => number;
    rotation: (value?: number) => number;
  };
}

describe('paragraph text transforms', () => {
  beforeEach(() => {
    konvaHarness.textProps = null;
    konvaHarness.transformerProps = null;
    konvaHarness.textNode = null;
    konvaHarness.activeAnchor = 'bottom-right';
    konvaHarness.transformerKeepRatio = false;
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Mutations caught: restoring keepRatio or corner-only anchors removes the
  // independent width/height controls that distinguish paragraph text.
  it('offers all resize anchors without a fixed aspect ratio', () => {
    seedText(makeText());
    render(React.createElement(CanvasArea));

    expect(konvaHarness.transformerProps).toMatchObject({
      rotateEnabled: true,
      keepRatio: false,
      enabledAnchors: [
        'top-left', 'top-center', 'top-right',
        'middle-left', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right',
      ],
    });
  });

  // Mutations caught: omitting either scale bake stretches glyphs or leaves
  // the persisted box at its old wrapping dimensions.
  it('reflows width and height live, resets node scales and persists normalized geometry', () => {
    seedText(makeText());
    render(React.createElement(CanvasArea));
    const node = textNode();

    node.scaleX(1.4);
    node.scaleY(0.75);
    node.rotation(17);
    act(() => textProps().onTransformStart({ evt: { ctrlKey: false, metaKey: false } }));
    expect(useStore.getState().documents[0].past).toHaveLength(1);

    act(() => textProps().onTransform({ evt: { ctrlKey: false, metaKey: false } }));
    expect(node.width()).toBeCloseTo(350, 5);
    expect(node.height()).toBeCloseTo(90, 5);
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
    expect(useStore.getState().documents[0].past).toHaveLength(1);

    act(() => textProps().onTransformEnd({ evt: { ctrlKey: false, metaKey: false } }));
    expect(useStore.getState().documents[0].texts[0]).toMatchObject({
      x: 0.1,
      y: 0.12,
      width: 0.35,
      height: 0.09,
      scaleX: 1,
      scaleY: 1,
      rotation: 17,
    });
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  // Mutations caught: reading only Konva's transform event misses modifier
  // changes during the active gesture and incorrectly bakes glyph scale.
  it('preserves proportional corner scaling while Ctrl is held during the gesture', () => {
    seedText(makeText());
    render(React.createElement(CanvasArea));
    const node = textNode();

    act(() => textProps().onTransformStart({ evt: { ctrlKey: false, metaKey: false } }));
    fireEvent.keyDown(document.body, { key: 'Control', ctrlKey: true });
    expect(konvaHarness.transformerKeepRatio).toBe(true);
    node.scaleX(1.5);
    node.scaleY(1.5);
    act(() => textProps().onTransform({ evt: {} }));

    expect(node.width()).toBe(250);
    expect(node.height()).toBe(120);
    expect(node.scaleX()).toBe(1.5);
    expect(node.scaleY()).toBe(1.5);

    act(() => textProps().onTransformEnd({ evt: {} }));
    expect(konvaHarness.transformerKeepRatio).toBe(false);
    expect(useStore.getState().documents[0].texts[0]).toMatchObject({
      width: 0.25,
      height: 0.12,
      scaleX: 1.5,
      scaleY: 1.5,
    });
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  // Mutations caught: a modifier flag that survives transformEnd makes the
  // next unmodified gesture stretch glyphs instead of reflowing the box.
  it('clears modifier state when a transform gesture ends', () => {
    seedText(makeText());
    render(React.createElement(CanvasArea));
    const node = textNode();

    act(() => textProps().onTransformStart({ evt: { ctrlKey: true } }));
    expect(konvaHarness.transformerKeepRatio).toBe(true);
    node.scaleX(1.2);
    node.scaleY(1.2);
    act(() => textProps().onTransform({ evt: {} }));
    act(() => textProps().onTransformEnd({ evt: {} }));

    node.scaleX(2);
    node.scaleY(0.5);
    act(() => textProps().onTransformStart({ evt: {} }));
    act(() => textProps().onTransform({ evt: {} }));

    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
    expect(node.width()).toBeCloseTo(500, 5);
    expect(node.height()).toBeCloseTo(60, 5);
    expect(useStore.getState().documents[0].past).toHaveLength(2);
  });

  it('uses reflow for side anchors even when Ctrl is held', () => {
    seedText(makeText());
    render(React.createElement(CanvasArea));
    const node = textNode();
    konvaHarness.activeAnchor = 'middle-right';

    act(() => textProps().onTransformStart({ evt: { ctrlKey: true } }));
    expect(konvaHarness.transformerKeepRatio).toBe(false);
    node.scaleX(1.4);
    node.scaleY(1);
    act(() => textProps().onTransform({ evt: { ctrlKey: true } }));

    expect(node.width()).toBeCloseTo(350, 5);
    expect(node.height()).toBeCloseTo(120, 5);
    expect(node.scaleX()).toBe(1);
    expect(node.scaleY()).toBe(1);
  });

  it('keeps point text on the legacy proportional scaling path', () => {
    seedText(makeText({ textMode: 'point', height: undefined }));
    render(React.createElement(CanvasArea));
    const node = textNode();

    expect(konvaHarness.transformerProps).toMatchObject({
      keepRatio: true,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    });

    act(() => textProps().onTransformStart({ evt: {} }));
    node.scaleX(1.3);
    node.scaleY(1.3);
    act(() => textProps().onTransform({ evt: {} }));
    expect(node.width()).toBe(250);
    expect(node.scaleX()).toBe(1.3);

    act(() => textProps().onTransformEnd({ evt: {} }));
    expect(useStore.getState().documents[0].texts[0]).toMatchObject({
      width: 0.25,
      scaleX: 1.3,
      scaleY: 1.3,
    });
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });
});
