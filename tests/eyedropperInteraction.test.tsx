import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const colorMocks = vi.hoisted(() => ({
  buildColorSamplingCanvas: vi.fn(),
  sampleCanvasColor: vi.fn(),
}));

const cloneMocks = vi.hoisted(() => ({ createCloneStampSession: vi.fn() }));

vi.mock('@/utils/colorSampler', () => colorMocks);
vi.mock('@/utils/cloneStamp', () => cloneMocks);

vi.mock('react-konva', () => {
  interface Props {
    children?: React.ReactNode;
    width?: number;
    height?: number;
    onPointerDown?: (event: unknown) => void;
    onPointerMove?: (event: unknown) => void;
    onPointerUp?: (event: unknown) => void;
    onPointerCancel?: (event: unknown) => void;
  }
  const layer = { batchDraw: vi.fn() };
  const makeNode = () => ({
    nodes: vi.fn(), getLayer: () => layer, setAttrs: vi.fn(), points: vi.fn(), visible: vi.fn(),
    stroke: vi.fn(), opacity: vi.fn(), image: vi.fn(), globalCompositeOperation: vi.fn(),
    strokeWidth: vi.fn(), shadowColor: vi.fn(), shadowBlur: vi.fn(), shadowOpacity: vi.fn(),
    getClassName: () => 'Group', name: () => '', x: () => 0, y: () => 0,
    scaleX: () => 1, scaleY: () => 1, rotation: () => 0,
  });
  const Primitive = forwardRef<unknown, Props>(function Primitive({ children }, ref) {
    const node = useRef(makeNode());
    useImperativeHandle(ref, () => node.current);
    return <div>{children}</div>;
  });
  const Stage = forwardRef<unknown, Props>(function Stage(props, ref) {
    const elementRef = useRef<HTMLDivElement>(null);
    const pointer = useRef({ x: 0, y: 0 });
    const node = useRef({
      getPointerPosition: () => pointer.current,
      container: () => elementRef.current,
      width: () => props.width ?? 800,
      height: () => props.height ?? 600,
      getClassName: () => 'Stage',
      name: () => '',
      toDataURL: () => 'data:image/png;base64,',
    });
    useImperativeHandle(ref, () => node.current);
    const wrap = (event: React.PointerEvent<HTMLDivElement>) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      return { evt: event.nativeEvent, target: node.current };
    };
    return (
      <div
        ref={elementRef}
        data-testid="eyedropper-stage"
        onPointerDown={event => props.onPointerDown?.(wrap(event))}
        onPointerMove={event => props.onPointerMove?.(wrap(event))}
        onPointerUp={event => props.onPointerUp?.(wrap(event))}
        onPointerCancel={event => props.onPointerCancel?.(wrap(event))}
      >{props.children}</div>
    );
  });
  return {
    Stage,
    Layer: Primitive,
    Image: Primitive,
    Line: Primitive,
    Text: Primitive,
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

describe('CanvasArea eyedropper interaction', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '', fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const doc = makeEditorDocument({ id: 'eyedropper-doc', width: 1000, height: 1000 });
    doc.selectedLayer = { type: 'base', id: doc.baseLayer.id };
    useStore.setState({
      documents: [doc],
      activeDocIndex: 0,
      activeTool: 'brush',
      viewport: { x: 0, y: 0, scale: 1 },
      eyedropperSettings: { sample: 'all' },
      foregroundColor: '#000000',
      cleanupSettings: { ...useStore.getState().cleanupSettings, brushColor: '#ffffff' },
      textSettings: { ...useStore.getState().textSettings, fill: '#000000' },
    });
    colorMocks.buildColorSamplingCanvas.mockReset();
    colorMocks.buildColorSamplingCanvas.mockResolvedValue(document.createElement('canvas'));
    colorMocks.sampleCanvasColor.mockReset();
    colorMocks.sampleCanvasColor.mockReturnValue({ hex: '#123456', rgba: [18, 52, 86, 255] });
    cloneMocks.createCloneStampSession.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('samples the composed document, updates defaults, and returns to the previous paint tool', async () => {
    render(<CanvasArea />);
    act(() => useStore.getState().setActiveTool('eyedropper'));
    fireEvent.pointerDown(screen.getByTestId('eyedropper-stage'), {
      pointerId: 3, button: 0, clientX: 300, clientY: 300,
    });

    await waitFor(() => expect(useStore.getState().foregroundColor).toBe('#123456'));
    const state = useStore.getState();
    expect(colorMocks.buildColorSamplingCanvas).toHaveBeenCalledWith(expect.objectContaining({ id: 'eyedropper-doc' }), 'all');
    expect(state.cleanupSettings.brushColor).toBe('#123456');
    expect(state.textSettings.fill).toBe('#123456');
    expect(state.activeTool).toBe('brush');
    expect(state.documents[0].past).toHaveLength(0);
  });

  it('temporarily samples with Alt without changing the selected brush tool', async () => {
    render(<CanvasArea />);
    fireEvent.keyDown(document.body, { key: 'Alt', altKey: true });
    fireEvent.pointerDown(screen.getByTestId('eyedropper-stage'), {
      pointerId: 4, button: 0, clientX: 360, clientY: 320, altKey: true,
    });

    await waitFor(() => expect(useStore.getState().foregroundColor).toBe('#123456'));
    expect(useStore.getState().activeTool).toBe('brush');
    expect(useStore.getState().documents[0].past).toHaveLength(0);
    fireEvent.keyUp(document.body, { key: 'Alt' });
  });

  it('selects a clone source with Alt and commits one undoable stamp', async () => {
    const session = {
      append: vi.fn(),
      renderPreview: vi.fn(async () => null),
      commit: vi.fn(async () => {
        useStore.getState().pushHistory();
        return useStore.getState().documents[0].baseLayer.id;
      }),
      cancel: vi.fn(),
    };
    cloneMocks.createCloneStampSession.mockResolvedValue(session);
    useStore.setState({ activeTool: 'cloneStamp' });
    render(<CanvasArea />);
    const stage = screen.getByTestId('eyedropper-stage');

    fireEvent.pointerDown(stage, { pointerId: 8, button: 0, clientX: 260, clientY: 260, altKey: true });
    expect(cloneMocks.createCloneStampSession).not.toHaveBeenCalled();
    expect(useStore.getState().documents[0].past).toHaveLength(0);

    fireEvent.pointerDown(stage, { pointerId: 9, button: 0, clientX: 360, clientY: 320 });
    await waitFor(() => expect(cloneMocks.createCloneStampSession).toHaveBeenCalledTimes(1));
    fireEvent.pointerUp(window, { pointerId: 9 });

    await waitFor(() => expect(session.commit).toHaveBeenCalledTimes(1));
    expect(session.append).toHaveBeenCalledTimes(1);
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });
});
