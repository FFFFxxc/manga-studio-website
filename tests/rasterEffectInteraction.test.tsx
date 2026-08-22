import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stageHarness = vi.hoisted(() => ({
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
}));

const effectMocks = vi.hoisted(() => ({
  createRasterEffectSession: vi.fn(),
}));

vi.mock('@/utils/rasterEffectSession', () => ({
  createRasterEffectSession: effectMocks.createRasterEffectSession,
}));

vi.mock('react-konva', () => {
  interface KonvaProps {
    children?: React.ReactNode;
    width?: number;
    height?: number;
    image?: CanvasImageSource;
    opacity?: number;
    name?: string;
    'data-testid'?: string;
    'data-has-preview'?: string;
    onPointerDown?: (event: unknown) => void;
    onPointerMove?: (event: unknown) => void;
    onPointerUp?: (event: unknown) => void;
    onPointerCancel?: (event: unknown) => void;
  }

  const layer = { batchDraw: vi.fn() };
  const makeNode = () => ({
    nodes: vi.fn(),
    getLayer: () => layer,
    setAttrs: vi.fn(),
    points: vi.fn(),
    visible: vi.fn(),
    stroke: vi.fn(),
    opacity: vi.fn(),
    image: vi.fn(),
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
  });

  const Primitive = forwardRef<unknown, KonvaProps>(function Primitive({ children }, ref) {
    const node = useRef(makeNode());
    useImperativeHandle(ref, () => node.current);
    return <div>{children}</div>;
  });

  const Image = forwardRef<unknown, KonvaProps>(function Image(props, ref) {
    const node = useRef(makeNode());
    useImperativeHandle(ref, () => node.current);
    if (!props['data-testid']) return null;
    return (
      <canvas
        data-testid={props['data-testid']}
        data-has-preview={props['data-has-preview']}
        data-opacity={props.opacity}
      />
    );
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
    const eventFor = (event: React.PointerEvent<HTMLDivElement>) => ({ evt: event.nativeEvent, target: node.current });
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
        data-testid="effect-canvas-stage"
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
    Image,
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

describe('CanvasArea raster-effect interaction', () => {
  let animationFrames: FrameRequestCallback[];
  let session: {
    append: ReturnType<typeof vi.fn>;
    renderPreview: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };

  const flushNextFrame = async () => {
    const frame = animationFrames.shift();
    expect(frame).toBeTypeOf('function');
    await act(async () => {
      frame?.(performance.now());
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    animationFrames = [];
    stageHarness.setPointerCapture.mockReset();
    stageHarness.releasePointerCapture.mockReset();
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);

    const documentState = makeEditorDocument({ id: 'effect-doc', width: 1000, height: 1000 });
    documentState.selectedLayer = { type: 'base', id: documentState.baseLayer.id };
    useStore.setState({
      documents: [documentState],
      activeDocIndex: 0,
      activeTool: 'blur',
      viewport: { x: 0, y: 0, scale: 1 },
      blurSettings: {
        ...useStore.getState().blurSettings,
        mode: 'blur',
        gesture: 'brush',
        applyTo: 'layer',
        brushSize: 0.1,
        hardness: 0.5,
      },
    });

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 1000;
    previewCanvas.height = 1000;
    session = {
      append: vi.fn(),
      renderPreview: vi.fn(async () => ({
        canvas: previewCanvas,
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        target: { type: 'base' as const, id: documentState.baseLayer.id },
        opacity: 1,
      })),
      commit: vi.fn(async () => {
        useStore.getState().pushHistory();
        return documentState.baseLayer.id;
      }),
      cancel: vi.fn(),
    };
    effectMocks.createRasterEffectSession.mockReset();
    effectMocks.createRasterEffectSession.mockResolvedValue(session);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders replacement pixels once per frame and commits once on pointerup', async () => {
    render(<CanvasArea />);
    const stage = screen.getByTestId('effect-canvas-stage');
    const before = useStore.getState().documents[0];

    fireEvent.pointerDown(stage, { pointerId: 7, button: 0, clientX: 300, clientY: 300 });
    await waitFor(() => expect(effectMocks.createRasterEffectSession).toHaveBeenCalledTimes(1));
    expect(stageHarness.setPointerCapture).toHaveBeenCalledWith(7);

    const move = new MouseEvent('pointermove', { bubbles: true, clientX: 420, clientY: 360 });
    Object.defineProperty(move, 'pointerId', { value: 7 });
    Object.defineProperty(move, 'getCoalescedEvents', {
      value: () => [{ clientX: 360, clientY: 330 }, { clientX: 420, clientY: 360 }],
    });
    stage.dispatchEvent(move);

    expect(useStore.getState().documents[0]).toBe(before);
    expect(session.renderPreview).not.toHaveBeenCalled();
    expect(animationFrames).toHaveLength(1);
    await flushNextFrame();

    expect(session.append).toHaveBeenCalledTimes(1);
    expect(session.append.mock.calls[0][0]).toHaveLength(6);
    expect(screen.getByTestId('raster-effect-overlay').getAttribute('data-has-preview')).toBe('true');
    expect(useStore.getState().documents[0].past).toHaveLength(0);

    fireEvent.pointerUp(window, { pointerId: 7 });
    await waitFor(() => expect(session.commit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useStore.getState().documents[0].past).toHaveLength(1));
    expect(stageHarness.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(screen.queryByTestId('raster-effect-overlay')).toBeNull();
  });

  it('commits a single-click stamp even when session creation finishes after pointerup', async () => {
    let resolveSession: ((value: typeof session) => void) | null = null;
    effectMocks.createRasterEffectSession.mockReturnValue(new Promise(resolve => { resolveSession = resolve; }));
    render(<CanvasArea />);
    const stage = screen.getByTestId('effect-canvas-stage');

    fireEvent.pointerDown(stage, { pointerId: 9, button: 0, clientX: 320, clientY: 320 });
    fireEvent.pointerUp(window, { pointerId: 9 });
    expect(session.commit).not.toHaveBeenCalled();
    act(() => useStore.getState().setActiveTool('brush'));

    await act(async () => {
      resolveSession?.(session);
      await Promise.resolve();
    });

    await waitFor(() => expect(session.commit).toHaveBeenCalledTimes(1));
    expect(session.append).toHaveBeenCalledWith(expect.any(Array));
    expect(session.append.mock.calls[0][0]).toHaveLength(2);
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('keeps a released pending stamp when Escape clears the current selection', async () => {
    let resolveSession: ((value: typeof session) => void) | null = null;
    effectMocks.createRasterEffectSession.mockReturnValue(new Promise(resolve => { resolveSession = resolve; }));
    render(<CanvasArea />);
    const stage = screen.getByTestId('effect-canvas-stage');

    fireEvent.pointerDown(stage, { pointerId: 12, button: 0, clientX: 320, clientY: 320 });
    fireEvent.pointerUp(window, { pointerId: 12 });
    fireEvent(window, new Event('manga-editor-cancel-transient'));
    act(() => useStore.getState().selectLayer(null));

    await act(async () => {
      resolveSession?.(session);
      await Promise.resolve();
    });

    await waitFor(() => expect(session.commit).toHaveBeenCalledTimes(1));
    expect(session.cancel).not.toHaveBeenCalled();
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('cancels pending session construction when CanvasArea unmounts', async () => {
    let resolveSession: ((value: typeof session) => void) | null = null;
    effectMocks.createRasterEffectSession.mockReturnValue(new Promise(resolve => { resolveSession = resolve; }));
    const view = render(<CanvasArea />);
    fireEvent.pointerDown(screen.getByTestId('effect-canvas-stage'), { pointerId: 10, button: 0, clientX: 320, clientY: 320 });

    view.unmount();
    await act(async () => {
      resolveSession?.(session);
      await Promise.resolve();
    });

    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.commit).not.toHaveBeenCalled();
    expect(stageHarness.releasePointerCapture).toHaveBeenCalledWith(10);
  });

  it.each(['pointercancel', 'window-blur', 'tool-switch', 'document-switch'] as const)(
    'cancels without history on %s',
    async cancellation => {
      if (cancellation === 'document-switch') {
        const first = useStore.getState().documents[0];
        const second = makeEditorDocument({ id: 'effect-doc-2', width: 1000, height: 1000 });
        useStore.setState({ documents: [first, second], activeDocIndex: 0 });
      }
      render(<CanvasArea />);
      const stage = screen.getByTestId('effect-canvas-stage');
      fireEvent.pointerDown(stage, { pointerId: 11, button: 0, clientX: 300, clientY: 300 });
      await waitFor(() => expect(effectMocks.createRasterEffectSession).toHaveBeenCalledTimes(1));
      await flushNextFrame();
      expect(screen.getByTestId('raster-effect-overlay').getAttribute('data-has-preview')).toBe('true');

      if (cancellation === 'pointercancel') {
        fireEvent.pointerCancel(stage, { pointerId: 11, clientX: 300, clientY: 300 });
      } else if (cancellation === 'window-blur') {
        fireEvent.blur(window);
      } else if (cancellation === 'tool-switch') {
        act(() => useStore.getState().setActiveTool('brush'));
      } else {
        act(() => useStore.getState().setActiveDoc(1));
      }

      await waitFor(() => expect(session.cancel).toHaveBeenCalledTimes(1));
      expect(session.commit).not.toHaveBeenCalled();
      expect(useStore.getState().documents[0].past).toHaveLength(0);
      expect(screen.queryByTestId('raster-effect-overlay')).toBeNull();
    },
  );
});
