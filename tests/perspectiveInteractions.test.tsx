import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseLayerState } from '@/types';
import type { ImageDocument, PerspectiveQuad } from '@/types';
import { useStore } from '@/store/useStore';
import { PerspectiveOverlay } from '@/components/editor/PerspectiveOverlay';
import { TransformPanel } from '@/components/editor/panels/TransformPanel';

vi.mock('react-konva', async () => {
  const React = await import('react');

  function Circle(props: {
    x: number;
    y: number;
    onDragStart?: (event: { target: DragTarget }) => void;
    onDragMove?: (event: { target: DragTarget }) => void;
    onDragEnd?: (event: { target: DragTarget }) => void;
  }) {
    const target = React.useRef<DragTarget>({
      currentX: props.x,
      currentY: props.y,
      x() { return this.currentX; },
      y() { return this.currentY; },
      position(next) {
        if (next) {
          this.currentX = next.x;
          this.currentY = next.y;
        }
        return { x: this.currentX, y: this.currentY };
      },
    });
    target.current.currentX = props.x;
    target.current.currentY = props.y;

    return (
      <button
        type="button"
        data-testid="perspective-corner"
        data-x={props.x}
        data-y={props.y}
        onPointerDown={() => props.onDragStart?.({ target: target.current })}
        onPointerMove={event => {
          target.current.position({ x: event.clientX, y: event.clientY });
          props.onDragMove?.({ target: target.current });
        }}
        onPointerUp={event => {
          target.current.position({ x: event.clientX, y: event.clientY });
          props.onDragEnd?.({ target: target.current });
        }}
      />
    );
  }

  return {
    Circle,
    Line: () => null,
    Layer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

interface DragTarget {
  currentX: number;
  currentY: number;
  x: () => number;
  y: () => number;
  position: (next?: { x: number; y: number }) => { x: number; y: number };
}

const initialQuad: PerspectiveQuad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

function makeDocument(locked = false): ImageDocument {
  return {
    id: 'doc',
    file: new File(['x'], 'checkerboard.png', { type: 'image/png' }),
    originalSrc: 'blob:checkerboard',
    thumbnail: '',
    width: 100,
    height: 100,
    name: 'checkerboard.png',
    cleanup: { committed: null, strokes: [], locked: false },
    baseLayer: { ...createBaseLayerState('doc'), locked, perspective: initialQuad },
    masks: [],
    aiLayers: [],
    activeMaskId: null,
    selectedLayer: { id: 'base-doc', type: 'base' },
    watermarks: [],
    texts: [],
    shapes: [],
    bubbles: [],
    past: [],
    future: [],
    hasChanges: false,
  };
}

function StorePerspectiveHarness() {
  const document = useStore(state => state.documents[0]);
  return <PerspectiveOverlay document={document} width={100} height={100} viewport={{ x: 0, y: 0, scale: 1 }} />;
}

describe('perspective interactions', () => {
  let animationFrames: FrameRequestCallback[];

  beforeEach(() => {
    animationFrames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    useStore.setState({ documents: [makeDocument()], activeDocIndex: 0, selectedObject: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // Mutations caught: moving pushHistory to drag move/end, or allowing the
  // perspective store update to take its default history snapshot.
  it('creates exactly one undo snapshot for a complete corner drag', () => {
    render(<StorePerspectiveHarness />);
    const corner = screen.getAllByTestId('perspective-corner')[0];

    fireEvent.pointerDown(corner, { pointerId: 1 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 10, clientY: 8 });
    fireEvent.pointerMove(corner, { pointerId: 1, clientX: 20, clientY: 12 });
    act(() => animationFrames.splice(0).forEach(callback => callback(0)));
    fireEvent.pointerUp(corner, { pointerId: 1, clientX: 25, clientY: 15 });

    let document = useStore.getState().documents[0];
    expect(document.past).toHaveLength(1);
    expect(document.baseLayer.perspective?.topLeft).toEqual({ x: 0.25, y: 0.15 });

    act(() => useStore.getState().undo());
    document = useStore.getState().documents[0];
    expect(document.baseLayer.perspective).toEqual(initialQuad);
  });

  // Mutation caught: publishing an invalid in-flight quad, or leaving the
  // invalid corner onscreen instead of restoring the last valid position.
  it('keeps an invalid in-flight quad local and restores the last valid quad', () => {
    render(<StorePerspectiveHarness />);
    const corner = screen.getAllByTestId('perspective-corner')[0];

    fireEvent.pointerDown(corner, { pointerId: 2 });
    fireEvent.pointerMove(corner, { pointerId: 2, clientX: 20, clientY: 10 });
    act(() => animationFrames.splice(0).forEach(callback => callback(0)));
    fireEvent.pointerMove(corner, { pointerId: 2, clientX: 110, clientY: 110 });

    expect(useStore.getState().documents[0].baseLayer.perspective?.topLeft).toEqual({ x: 0.2, y: 0.1 });
    expect(Number(corner.getAttribute('data-x'))).toBeCloseTo(110, 8);

    fireEvent.pointerUp(corner, { pointerId: 2, clientX: 110, clientY: 110 });

    expect(useStore.getState().documents[0].baseLayer.perspective?.topLeft).toEqual({ x: 0.2, y: 0.1 });
    expect(screen.getAllByTestId('perspective-corner')[0].getAttribute('data-x')).toBe('20');
  });

  // Mutation caught: rendering perspective actions for a locked raster layer
  // or changing its lock state as a side effect of opening TransformPanel.
  it('shows the locked-layer message and keeps perspective controls disabled', () => {
    useStore.setState({ documents: [makeDocument(true)], activeDocIndex: 0 });
    render(<TransformPanel />);

    expect(screen.getByText('Слой заблокирован — сначала снимите замок.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Обычная' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Перспектива' }) as HTMLButtonElement).disabled).toBe(true);
    expect(useStore.getState().documents[0].baseLayer.locked).toBe(true);
  });

  // Mutation caught: bypassing the shared raster guard at the canvas overlay
  // boundary would expose draggable handles for a locked selected layer.
  it('does not render perspective handles for a locked selected raster layer', () => {
    useStore.setState({ documents: [makeDocument(true)], activeDocIndex: 0 });

    render(<StorePerspectiveHarness />);

    expect(screen.queryAllByTestId('perspective-corner')).toHaveLength(0);
    expect(useStore.getState().documents[0].past).toHaveLength(0);
    expect(useStore.getState().documents[0].baseLayer.locked).toBe(true);
  });

  // Mutation caught: omitting requestAnimationFrame cleanup would let a stale
  // scheduled preview update survive after the overlay unmounts.
  it('cancels a pending perspective frame when the handles unmount', () => {
    const cancelFrame = vi.mocked(window.cancelAnimationFrame);
    const view = render(<StorePerspectiveHarness />);
    const corner = screen.getAllByTestId('perspective-corner')[0];
    fireEvent.pointerDown(corner, { pointerId: 3 });
    fireEvent.pointerMove(corner, { pointerId: 3, clientX: 15, clientY: 10 });

    view.unmount();

    expect(cancelFrame).toHaveBeenCalledWith(1);
  });
});
