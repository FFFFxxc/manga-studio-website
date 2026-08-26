import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrushCursor } from '@/components/editor/BrushCursor';
import { PaintEditor } from '@/components/editor/panels/PaintEditor';

const stageHarness = vi.hoisted(() => ({
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
}));

const eraserHarness = vi.hoisted(() => ({
  append: vi.fn(),
  renderPreview: vi.fn(async () => null),
  commit: vi.fn(async () => 'moved-raster'),
  cancel: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@/utils/eraserRaster', () => ({
  createEraserSession: eraserHarness.create,
}));

vi.mock('react-konva', () => {
  interface KonvaProps {
    children?: React.ReactNode;
    width?: number;
    height?: number;
    onPointerDown?: (event: unknown) => void;
    onPointerMove?: (event: unknown) => void;
    onPointerUp?: (event: unknown) => void;
    onPointerCancel?: (event: unknown) => void;
  }

  const layer = { batchDraw: vi.fn() };
  const primitiveNode = {
    nodes: vi.fn(),
    getLayer: () => layer,
    setAttrs: vi.fn(),
    points: vi.fn(),
    visible: vi.fn(),
    stroke: vi.fn(),
    opacity: vi.fn(),
    globalCompositeOperation: vi.fn(),
    strokeWidth: vi.fn(),
    shadowColor: vi.fn(),
    shadowBlur: vi.fn(),
    shadowOpacity: vi.fn(),
    getClassName: () => 'Group',
    name: () => '',
    x: () => 0,
    y: () => 0,
    scaleX: () => 1,
    scaleY: () => 1,
    rotation: () => 0,
  };

  const Primitive = forwardRef<unknown, KonvaProps>(function Primitive({ children }, ref) {
    useImperativeHandle(ref, () => primitiveNode);
    return <div>{children}</div>;
  });

  const Stage = forwardRef<unknown, KonvaProps>(function Stage(props, ref) {
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

    const remember = (event: React.PointerEvent<HTMLDivElement>) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    const eventFor = (event: React.PointerEvent<HTMLDivElement>) => ({
      evt: event.nativeEvent,
      target: node.current,
    });

    return (
      <div
        ref={element => {
          elementRef.current = element;
          if (!element) return;
          Object.defineProperty(element, 'setPointerCapture', { configurable: true, value: stageHarness.setPointerCapture });
          Object.defineProperty(element, 'releasePointerCapture', { configurable: true, value: stageHarness.releasePointerCapture });
          element.getBoundingClientRect = () => ({
            x: 0, y: 0, left: 0, top: 0,
            right: props.width ?? 800, bottom: props.height ?? 600,
            width: props.width ?? 800, height: props.height ?? 600,
            toJSON: () => ({}),
          });
        }}
        data-testid="paint-canvas-stage"
        onPointerDown={event => { remember(event); props.onPointerDown?.(eventFor(event)); }}
        onPointerMove={event => { remember(event); props.onPointerMove?.(eventFor(event)); }}
        onPointerUp={event => { remember(event); props.onPointerUp?.(eventFor(event)); }}
        onPointerCancel={event => { remember(event); props.onPointerCancel?.(eventFor(event)); }}
      >
        {props.children}
      </div>
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

const solid = { type: 'solid' as const, color: '#ffffff' };

describe('BrushCursor', () => {
  afterEach(() => cleanup());

  // Mutations caught: a single-ring cursor hides hardness from the user and
  // can no longer predict the alpha footprint produced by brush stamps.
  it('shows the outer diameter, hard core, color and optional crosshair', () => {
    render(<BrushCursor diameterPx={100} hardness={0.5} color="#ff8000" showCrosshair />);

    const cursor = screen.getByTestId('brush-cursor');
    expect(cursor.style.width).toBe('100px');
    expect(cursor.style.height).toBe('100px');
    expect(screen.getByTestId('brush-cursor-outer').style.borderColor).toBe('rgb(255, 128, 0)');
    expect(screen.getByTestId('brush-cursor-hard-core').style.width).toBe('50px');
    expect(screen.getByTestId('brush-cursor-hard-core').style.height).toBe('50px');
    expect(screen.getByTestId('brush-cursor-crosshair')).toBeTruthy();
  });

  it('omits a zero-sized hard core and optional crosshair', () => {
    render(<BrushCursor diameterPx={40} hardness={0} color="#ffffff" showCrosshair={false} />);

    expect(screen.queryByTestId('brush-cursor-hard-core')).toBeNull();
    expect(screen.queryByTestId('brush-cursor-crosshair')).toBeNull();
  });
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('CanvasArea brush preview', () => {
  const contexts = new Map<HTMLCanvasElement, {
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    drawAlphas: number[];
    globalAlpha: number;
    fillStyle: string | CanvasGradient;
    gradientStops: Array<[number, string]>;
  }>();
  let animationFrames: FrameRequestCallback[];

  beforeEach(() => {
    stageHarness.setPointerCapture.mockReset();
    stageHarness.releasePointerCapture.mockReset();
    eraserHarness.append.mockReset();
    eraserHarness.renderPreview.mockReset().mockResolvedValue(null);
    eraserHarness.commit.mockReset().mockResolvedValue('moved-raster');
    eraserHarness.cancel.mockReset();
    eraserHarness.create.mockReset().mockResolvedValue({
      append: eraserHarness.append,
      renderPreview: eraserHarness.renderPreview,
      commit: eraserHarness.commit,
      cancel: eraserHarness.cancel,
    });
    contexts.clear();
    animationFrames = [];
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
      const existing = contexts.get(this);
      if (existing) return existing as unknown as CanvasRenderingContext2D;
      const gradientStops: Array<[number, string]> = [];
      const radialGradient = { addColorStop: (offset: number, color: string) => gradientStops.push([offset, color]) };
      const alphaStack: number[] = [];
      const context = {
        fillStyle: '',
        strokeStyle: '',
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        createRadialGradient: vi.fn(() => radialGradient),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        drawAlphas: [] as number[],
        drawImage: vi.fn(() => context.drawAlphas.push(context.globalAlpha)),
        save: vi.fn(() => alphaStack.push(context.globalAlpha)),
        restore: vi.fn(() => { context.globalAlpha = alphaStack.pop() ?? 1; }),
        gradientStops,
      };
      contexts.set(this, context);
      return context as unknown as CanvasRenderingContext2D;
    });
    const document = makeEditorDocument({ width: 1000, height: 1000 });
    useStore.setState({
      documents: [document],
      activeDocIndex: 0,
      activeTool: 'brush',
      viewport: { x: 0, y: 0, scale: 1 },
      cleanupSettings: {
        ...useStore.getState().cleanupSettings,
        brushSize: 0.1,
        brushHardness: 0.5,
        brushOpacity: 0.6,
        brushColor: '#ff8000',
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Mutations caught: restoring the Konva shadow line, flushing directly on
  // pointermove, or calling a store setter during preview breaks this contract.
  it('renders coalesced points into one raster preview frame without mutating the document', () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('paint-canvas-stage');
    const overlay = screen.getByTestId('brush-preview-overlay') as HTMLCanvasElement;
    const before = useStore.getState().documents[0];

    fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 400, clientY: 300 });
    expect(stageHarness.setPointerCapture).toHaveBeenCalledWith(7);
    expect(contexts.get(overlay)?.drawImage).toHaveBeenCalledTimes(1);
    expect(overlay.dataset.hasPreview).toBe('true');

    const move = new MouseEvent('pointermove', { bubbles: true, clientX: 456, clientY: 300 });
    Object.defineProperty(move, 'pointerId', { value: 7 });
    Object.defineProperty(move, 'getCoalescedEvents', {
      value: () => [
        { clientX: 428, clientY: 300 },
        { clientX: 456, clientY: 300 },
      ],
    });
    stage.dispatchEvent(move);

    expect(animationFrames).toHaveLength(1);
    expect(useStore.getState().documents[0]).toBe(before);
    expect(contexts.get(overlay)?.drawImage).toHaveBeenCalledTimes(1);

    act(() => animationFrames.shift()?.(0));

    expect(contexts.get(overlay)?.drawImage).toHaveBeenCalledTimes(2);
    expect(overlay.dataset.hasPreview).toBe('true');
    expect(useStore.getState().documents[0]).toBe(before);
    const firstFlushClear = contexts.get(overlay)!.clearRect.mock.calls.at(-1)!;

    const secondMove = new MouseEvent('pointermove', { bubbles: true, clientX: 476, clientY: 300 });
    Object.defineProperty(secondMove, 'pointerId', { value: 7 });
    Object.defineProperty(secondMove, 'getCoalescedEvents', {
      value: () => [{ clientX: 476, clientY: 300 }],
    });
    stage.dispatchEvent(secondMove);
    expect(animationFrames).toHaveLength(1);

    act(() => animationFrames.shift()?.(16));

    const overlayContext = contexts.get(overlay)!;
    expect(overlayContext.drawImage).toHaveBeenCalledTimes(3);
    expect(overlayContext.drawAlphas).toEqual([0.6, 0.6, 0.6]);
    const secondFlushClear = overlayContext.clearRect.mock.calls.at(-1)!;
    expect(secondFlushClear).not.toEqual([0, 0, overlay.width, overlay.height]);
    expect(secondFlushClear[0]).toBeGreaterThan(0);
    expect(secondFlushClear[2]).toBeLessThan(firstFlushClear[2]);
    const accumulatedRaster = overlayContext.drawImage.mock.calls[0][0] as HTMLCanvasElement;
    expect(overlayContext.drawImage.mock.calls.every(call => call[0] === accumulatedRaster && call.length === 9)).toBe(true);
    expect(contexts.get(accumulatedRaster)?.drawAlphas).toEqual([1, 1, 1]);

    fireEvent.pointerUp(window, { pointerId: 7 });
    const overlayAfterCommit = screen.getByTestId('brush-preview-overlay') as HTMLCanvasElement;
    expect(stageHarness.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(useStore.getState().documents[0].cleanup.strokes[0].points).toHaveLength(8);
    expect(overlayAfterCommit).toBe(overlay);
    expect(overlayAfterCommit.dataset.hasPreview).toBe('false');
    expect(contexts.get(overlayAfterCommit)?.clearRect).toHaveBeenLastCalledWith(0, 0, overlay.width, overlay.height);
  });

  it('cancels an in-flight brush preview when the active document changes', () => {
    const first = makeEditorDocument({ id: 'first-doc', width: 1000, height: 1000 });
    const second = makeEditorDocument({ id: 'second-doc', width: 1000, height: 1000 });
    useStore.setState({ documents: [first, second], activeDocIndex: 0 });
    render(<CanvasArea />);
    const stage = screen.getByTestId('paint-canvas-stage');
    const overlay = screen.getByTestId('brush-preview-overlay') as HTMLCanvasElement;

    fireEvent.pointerDown(stage, { pointerId: 11, button: 0, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(stage, { pointerId: 11, clientX: 440, clientY: 300 });
    expect(animationFrames).toHaveLength(1);
    expect(overlay.dataset.hasPreview).toBe('true');
    const staleFrame = animationFrames[0];

    act(() => useStore.getState().setActiveDoc(1));

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(stageHarness.releasePointerCapture).toHaveBeenCalledWith(11);
    expect(overlay.dataset.hasPreview).toBe('false');

    act(() => staleFrame(16));
    fireEvent.pointerUp(window, { pointerId: 11 });

    expect(overlay.dataset.hasPreview).toBe('false');
    expect(useStore.getState().documents[0].cleanup.strokes).toHaveLength(0);
    expect(useStore.getState().documents[1].cleanup.strokes).toHaveLength(0);
  });

  it('keeps pointerdown brush settings for preview, cursor, and commit', () => {
    act(() => useStore.getState().updateCleanupSettings({
      brushSize: 0.1,
      brushHardness: 0.5,
      brushOpacity: 0.6,
      brushColor: '#123456',
    }));
    render(<CanvasArea />);
    const stage = screen.getByTestId('paint-canvas-stage');
    const overlay = screen.getByTestId('brush-preview-overlay') as HTMLCanvasElement;

    fireEvent.pointerDown(stage, { pointerId: 19, button: 0, clientX: 400, clientY: 300 });
    const pointerdownCursorWidth = screen.getByTestId('brush-cursor').style.width;
    const pointerdownHardCoreWidth = screen.getByTestId('brush-cursor-hard-core').style.width;
    const pointerdownCursorColor = screen.getByTestId('brush-cursor-outer').style.borderColor;
    const pointerdownDirtyWidth = contexts.get(overlay)!.clearRect.mock.calls[0][2] as number;
    act(() => useStore.getState().updateCleanupSettings({
      brushSize: 0.02,
      brushHardness: 0.1,
      brushOpacity: 0.2,
      brushColor: '#abcdef',
    }));

    const cursor = screen.getByTestId('brush-cursor');
    expect(cursor.style.width).toBe(pointerdownCursorWidth);
    expect(screen.getByTestId('brush-cursor-hard-core').style.width).toBe(pointerdownHardCoreWidth);
    expect(screen.getByTestId('brush-cursor-outer').style.borderColor).toBe(pointerdownCursorColor);
    const documentAfterSettings = useStore.getState().documents[0];

    fireEvent.pointerMove(stage, { pointerId: 19, clientX: 450, clientY: 300 });
    act(() => animationFrames.shift()?.(16));

    expect(useStore.getState().documents[0]).toBe(documentAfterSettings);
    expect(contexts.get(overlay)?.drawAlphas).toEqual([0.6, 0.6]);
    const previewDirtyWidth = contexts.get(overlay)!.clearRect.mock.calls.at(-1)![2] as number;
    expect(previewDirtyWidth).toBeGreaterThan(pointerdownDirtyWidth * 1.5);
    const rasterStamps = [...contexts.values()].filter(context => context.fillStyle === '#123456');
    expect(rasterStamps).toHaveLength(1);
    expect(rasterStamps[0].gradientStops).toContainEqual([0.5, 'rgba(255,255,255,1)']);
    expect([...contexts.values()].some(context => context.fillStyle === '#abcdef')).toBe(false);

    fireEvent.pointerUp(window, { pointerId: 19 });

    expect(useStore.getState().documents[0].cleanup.strokes[0]).toMatchObject({
      size: 0.1,
      hardness: 0.5,
      opacity: 0.6,
      color: '#123456',
      mode: 'paint',
      purpose: 'paint',
    });
  });

  // Mutation caught: routing the eraser through the old grey Konva marker
  // delays real alpha removal until pointerup and stores misplaced points.
  it('routes an eraser click through the live raster session and commits once', async () => {
    const document = makeEditorDocument({ id: 'eraser-transform-doc', width: 1000, height: 1000 });
    document.aiLayers = [{
      id: 'moved-raster',
      name: 'Moved raster',
      src: 'data:image/png;base64,',
      visible: true,
      opacity: 1,
      operation: 'drawing',
      locked: false,
      eraseElements: [],
      crop: null,
      x: 0.1,
      y: 0.05,
      scaleX: 0.5,
      scaleY: 0.5,
      rotation: 0,
      perspective: null,
      perspectiveSourceBounds: null,
    }];
    document.selectedLayer = { id: 'moved-raster', type: 'ai' };
    document.layerOrder = [
      { id: document.baseLayer.id, type: 'base' },
      { id: 'moved-raster', type: 'ai' },
    ];
    useStore.setState({ documents: [document], activeDocIndex: 0, activeTool: 'eraser' });
    render(<CanvasArea />);

    const stage = screen.getByTestId('paint-canvas-stage');
    fireEvent.pointerDown(stage, { pointerId: 23, button: 0, clientX: 400, clientY: 300 });
    await act(async () => {});
    expect(eraserHarness.create).toHaveBeenCalledWith(expect.objectContaining({
      documentId: document.id,
      layer: { type: 'ai', id: 'moved-raster' },
      settings: { size: 0.1, hardness: 0.5, opacity: 0.6 },
    }));
    expect(animationFrames).toHaveLength(1);
    await act(async () => { animationFrames.shift()?.(0); });
    expect(eraserHarness.append).toHaveBeenCalledTimes(1);
    const clickPoints = eraserHarness.append.mock.calls[0][0] as number[];
    expect(clickPoints[0]).toBeCloseTo(0.5, 8);
    expect(clickPoints[1]).toBeCloseTo(0.5, 8);
    fireEvent.pointerUp(window, { pointerId: 23, clientX: 400, clientY: 300 });
    await act(async () => {});

    expect(eraserHarness.commit).toHaveBeenCalledTimes(1);
    expect(stageHarness.releasePointerCapture).toHaveBeenCalledWith(23);
    expect(useStore.getState().documents[0].aiLayers[0].eraseElements).toHaveLength(0);
  });

  it('buffers a continuous eraser stroke by animation frame', async () => {
    const document = makeEditorDocument({ id: 'eraser-move-doc', width: 1000, height: 1000 });
    document.baseLayer.locked = false;
    document.selectedLayer = { id: document.baseLayer.id, type: 'base' };
    useStore.setState({ documents: [document], activeDocIndex: 0, activeTool: 'eraser' });
    render(<CanvasArea />);
    const stage = screen.getByTestId('paint-canvas-stage');

    fireEvent.pointerDown(stage, { pointerId: 31, button: 0, clientX: 300, clientY: 300 });
    await act(async () => {});
    const move = new MouseEvent('pointermove', { bubbles: true, clientX: 420, clientY: 300 });
    Object.defineProperty(move, 'pointerId', { value: 31 });
    Object.defineProperty(move, 'getCoalescedEvents', {
      value: () => [{ clientX: 360, clientY: 300 }, { clientX: 420, clientY: 300 }],
    });
    stage.dispatchEvent(move);

    expect(animationFrames).toHaveLength(1);
    expect(eraserHarness.append).not.toHaveBeenCalled();
    await act(async () => { animationFrames.shift()?.(16); });
    expect(eraserHarness.append).toHaveBeenCalledTimes(1);
    expect((eraserHarness.append.mock.calls[0][0] as number[])).toHaveLength(6);

    fireEvent.pointerUp(window, { pointerId: 31 });
    await act(async () => {});
    expect(eraserHarness.commit).toHaveBeenCalledTimes(1);
  });

  it('does not start the live eraser on a locked raster layer', () => {
    const document = makeEditorDocument({ id: 'locked-eraser-doc', width: 1000, height: 1000 });
    document.selectedLayer = { id: document.baseLayer.id, type: 'base' };
    useStore.setState({ documents: [document], activeDocIndex: 0, activeTool: 'eraser' });
    render(<CanvasArea />);

    fireEvent.pointerDown(screen.getByTestId('paint-canvas-stage'), {
      pointerId: 37, button: 0, clientX: 400, clientY: 300,
    });

    expect(eraserHarness.create).not.toHaveBeenCalled();
    expect(screen.getByText('Слой заблокирован — сначала снимите замок')).toBeTruthy();
  });
});

describe('PaintEditor', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('creates two stops when switching from solid to linear', () => {
    const onChange = vi.fn();
    render(<PaintEditor label="Заливка" value={solid} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Линейный' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'linear',
      stops: expect.arrayContaining([expect.objectContaining({ offset: 0 }), expect.objectContaining({ offset: 1 })]),
    }));
  });

  it('uses a visible contrasting stop for a dark solid paint', () => {
    const onChange = vi.fn();
    render(<PaintEditor label="Заливка" value={{ type: 'solid', color: '#000000' }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Линейный' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      type: 'linear',
      stops: expect.arrayContaining([
        expect.objectContaining({ offset: 0, color: '#000000' }),
        expect.objectContaining({ offset: 1, color: '#ffffff' }),
      ]),
    }));
  });

  it('changes the selected stop color', () => {
    const onChange = vi.fn();
    const value = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { id: 'a', offset: 0, color: '#000000' },
        { id: 'b', offset: 1, color: '#ffffff' },
      ],
    };
    render(<PaintEditor label="Заливка" value={value} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Цвет выбранной точки'), { target: { value: '#ff0000' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      stops: expect.arrayContaining([expect.objectContaining({ id: 'a', color: '#ff0000' })]),
    }));
  });

  it('moves a gradient stop directly on the preview bar', () => {
    const onChange = vi.fn();
    const onGestureStart = vi.fn();
    const value = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { id: 'a', offset: 0.2, color: '#000000' },
        { id: 'b', offset: 1, color: '#ffffff' },
      ],
    };
    render(
      <PaintEditor
        label="Заливка"
        value={value}
        onGestureStart={onGestureStart}
        onChange={onChange}
      />,
    );
    const bar = screen.getByRole('button', { name: 'Добавить точку градиента' });
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 38,
      width: 200,
      height: 38,
      toJSON: () => ({}),
    });
    const stop = screen.getByRole('button', { name: 'Точка градиента 20%' });
    fireEvent.pointerDown(stop, { pointerId: 1, clientX: 40 });
    fireEvent.pointerMove(stop, { pointerId: 1, clientX: 150 });
    fireEvent.pointerUp(stop, { pointerId: 1, clientX: 150 });

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      stops: expect.arrayContaining([expect.objectContaining({ id: 'a', offset: 0.75 })]),
    }));
  });

  it('adds and removes gradient stops with one history gesture each', () => {
    const onChange = vi.fn();
    const onGestureStart = vi.fn();
    const value = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { id: 'a', offset: 0, color: '#000000' },
        { id: 'b', offset: 0.5, color: '#888888' },
        { id: 'c', offset: 1, color: '#ffffff' },
      ],
    };
    render(
      <PaintEditor
        label="Заливка"
        value={value}
        onGestureStart={onGestureStart}
        onChange={onChange}
      />,
    );
    const bar = screen.getByRole('button', { name: 'Добавить точку градиента' });
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 38,
      width: 200,
      height: 38,
      toJSON: () => ({}),
    });

    fireEvent.click(bar, { clientX: 50 });
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      stops: expect.arrayContaining([expect.objectContaining({ offset: 0.25 })]),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Удалить выбранную точку' }));
    expect(onGestureStart).toHaveBeenCalledTimes(2);
  });

  it('edits radial gradient center and radius', () => {
    const onChange = vi.fn();
    const value = {
      type: 'radial' as const,
      centerX: 0.5,
      centerY: 0.5,
      radius: 1,
      stops: [
        { id: 'a', offset: 0, color: '#ffffff' },
        { id: 'b', offset: 1, color: '#000000' },
      ],
    };
    render(<PaintEditor label="Заливка" value={value} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Центр градиента X'), { target: { value: '70' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ centerX: 0.7 }));

    fireEvent.change(screen.getByLabelText('Радиус градиента'), { target: { value: '125' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ radius: 1.25 }));
  });

  it('reverses gradient colors and offsets', () => {
    const onChange = vi.fn();
    const onGestureStart = vi.fn();
    const value = {
      type: 'linear' as const,
      angle: 0,
      stops: [
        { id: 'a', offset: 0, color: '#000000' },
        { id: 'b', offset: 0.25, color: '#ff0000' },
        { id: 'c', offset: 1, color: '#ffffff' },
      ],
    };
    render(
      <PaintEditor
        label="Заливка"
        value={value}
        onGestureStart={onGestureStart}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть градиент' }));

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      stops: [
        expect.objectContaining({ offset: 0, color: '#ffffff' }),
        expect.objectContaining({ offset: 0.75, color: '#ff0000' }),
        expect.objectContaining({ offset: 1, color: '#000000' }),
      ],
    }));
  });

  it('saves and applies a custom preset', () => {
    const onChange = vi.fn();
    render(<PaintEditor label="Заливка" value={solid} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить градиент' }));
    fireEvent.change(screen.getByLabelText('Название градиента'), { target: { value: 'Мой неон' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пресет' }));
    const preset = screen.getByTitle('Мой неон');
    expect(preset).toBeTruthy();
    fireEvent.click(preset);
    expect(onChange).toHaveBeenCalledWith(solid);
  });

  it('renames a custom preset without a browser prompt', () => {
    render(<PaintEditor label="Заливка" value={solid} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить градиент' }));
    fireEvent.change(screen.getByLabelText('Название градиента'), { target: { value: 'Старое имя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пресет' }));
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать Старое имя' }));
    fireEvent.change(screen.getByLabelText('Название градиента'), { target: { value: 'Новое имя' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить пресет' }));

    expect(screen.getByTitle('Новое имя')).toBeTruthy();
    expect(screen.queryByTitle('Старое имя')).toBeNull();
  });

  it('toggles neon and reports the glow update', () => {
    const onGlowChange = vi.fn();
    render(<PaintEditor label="Заливка" value={solid} glow={{ enabled: false, color: '#00e5ff', blur: 24, opacity: 0.8, intensity: 1 }} onChange={vi.fn()} onGlowChange={onGlowChange} />);
    fireEvent.click(screen.getByLabelText('Неон'));
    expect(onGlowChange).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
  });

  it('applies neon color presets and intensity controls', () => {
    const onGlowChange = vi.fn();
    const onGestureStart = vi.fn();
    render(
      <PaintEditor
        label="Заливка"
        value={solid}
        glow={{ enabled: true, color: '#00e5ff', blur: 24, opacity: 0.8, intensity: 1 }}
        onGestureStart={onGestureStart}
        onChange={vi.fn()}
        onGlowChange={onGlowChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Неон Розовый' }));
    expect(onGlowChange).toHaveBeenCalledWith(expect.objectContaining({ color: '#ff4fd8' }));

    fireEvent.change(screen.getByLabelText('Яркость неона'), { target: { value: '60' } });
    expect(onGlowChange).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.6 }));

    fireEvent.change(screen.getByLabelText('Интенсивность неона'), { target: { value: '3' } });
    expect(onGlowChange).toHaveBeenCalledWith(expect.objectContaining({ intensity: 3 }));
    expect(onGestureStart).toHaveBeenCalled();
  });

  it('converts a saved radial preset when radial strokes are disabled', () => {
    localStorage.setItem('manga-studio:paint-presets:v1', JSON.stringify([{
      id: 'radial-stroke',
      name: 'Радиальный пользовательский',
      style: {
        type: 'radial',
        centerX: 0.5,
        centerY: 0.5,
        radius: 1,
        stops: [
          { id: 'a', offset: 0, color: '#000000' },
          { id: 'b', offset: 1, color: '#ffffff' },
        ],
      },
    }]));
    const onChange = vi.fn();
    render(
      <PaintEditor
        label="Обводка"
        value={solid}
        allowRadial={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Применить градиент Радиальный пользовательский' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'linear', angle: 0 }));
  });
});
