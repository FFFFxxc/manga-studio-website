import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBaseLayerState } from '@/types';
import type { ImageDocument, PerspectiveQuad } from '@/types';

vi.mock('react-konva', async () => {
  const React = await import('react');

  interface DragTarget {
    currentX: number;
    currentY: number;
    x: () => number;
    y: () => number;
    position: (next?: { x: number; y: number }) => { x: number; y: number };
  }

  function Circle(props: {
    x: number;
    y: number;
    onDragStart?: (event: { target: DragTarget }) => void;
    onDragMove?: (event: { target: DragTarget }) => void;
    onDragEnd?: (event: { target: DragTarget }) => void;
    onPointerCancel?: (event: { target: DragTarget }) => void;
  }) {
    const target = React.useRef<DragTarget>({
      currentX: props.x,
      currentY: props.y,
      x() { return this.currentX; },
      y() { return this.currentY; },
      position(next) {
        if (next) { this.currentX = next.x; this.currentY = next.y; }
        return { x: this.currentX, y: this.currentY };
      },
    });
    target.current.currentX = props.x;
    target.current.currentY = props.y;
    return (
      <button
        type="button"
        data-testid="perspective-corner"
        onPointerDown={() => props.onDragStart?.({ target: target.current })}
        onPointerMove={event => {
          target.current.position({ x: event.clientX, y: event.clientY });
          props.onDragMove?.({ target: target.current });
        }}
        onPointerUp={event => {
          target.current.position({ x: event.clientX, y: event.clientY });
          props.onDragEnd?.({ target: target.current });
        }}
        onPointerCancel={() => props.onPointerCancel?.({ target: target.current })}
      />
    );
  }

  const Container = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    Circle,
    Group: Container,
    Image: ({ image }: { image?: { marker?: string } }) => (
      <div data-testid="placed-preview" data-image-marker={image?.marker ?? ''} />
    ),
    Layer: Container,
    Line: () => null,
    Transformer: () => null,
  };
});

vi.mock('@/utils/perspective', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/perspective')>();
  return { ...actual, drawPerspectiveImage: vi.fn() };
});

import { PlacedRasterImage } from '@/components/editor/CanvasArea';
import { PerspectiveOverlay } from '@/components/editor/PerspectiveOverlay';
import { useEditorUiStore } from '@/store/useEditorUiStore';
import { useStore } from '@/store/useStore';
import { drawPerspectiveImage } from '@/utils/perspective';

const quad: PerspectiveQuad = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

const crop = { x: 0.1875, y: 0.25, width: 0.25, height: 0.1875 };
const sourceBounds = { x: 0.125, y: 0.125, width: 0.5, height: 0.5 };
const noop = () => {};

function makeDocument(): ImageDocument {
  return {
    id: 'doc',
    file: new File(['x'], 'page.png', { type: 'image/png' }),
    originalSrc: 'blob:page',
    thumbnail: '',
    width: 100,
    height: 100,
    name: 'page.png',
    cleanup: { committed: null, strokes: [], locked: false },
    baseLayer: {
      ...createBaseLayerState('doc'),
      locked: false,
      perspective: quad,
      perspectiveSourceBounds: sourceBounds,
      crop,
      opacity: 0.45,
    },
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

function Preview({ image, revision }: { image: CanvasImageSource; revision: string }) {
  return (
    <PlacedRasterImage
      nodeName="base-image"
      image={image}
      sourceIdentity="blob:page"
      sourceRevision={revision}
      width={100}
      height={100}
      opacity={0.45}
      placement={{ perspective: quad, perspectiveSourceBounds: sourceBounds, crop }}
      interactive={false}
      isSelected
      onSelect={noop}
      onContextMenu={noop}
      onBeforeChange={noop}
      onChange={noop}
      layerRef={{ id: 'base-doc', type: 'base' }}
    />
  );
}

describe('perspective preview lifecycle', () => {
  let canvasCount = 0;
  let createElement: typeof document.createElement;

  beforeEach(() => {
    canvasCount = 0;
    createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() !== 'canvas') return createElement(tagName);
      canvasCount += 1;
      return {
        width: 0,
        height: 0,
        marker: `preview-${canvasCount}`,
        getContext: () => ({}),
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    vi.mocked(drawPerspectiveImage).mockClear();
    const documentState = makeDocument();
    useStore.setState({ documents: [documentState], activeDocIndex: 0, selectedObject: null });
    useEditorUiStore.setState({
      activeOperation: {
        id: 'perspective-1',
        kind: 'perspective',
        label: 'Perspective',
        commit: noop,
        cancel: noop,
      },
      toolOptions: null,
      floatingDismiss: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useEditorUiStore.setState({ activeOperation: null, toolOptions: null, floatingDismiss: null });
  });

  // Mutation caught: using the whole perspective operation as the drag flag
  // leaves the selected layer in low-quality mode after the corner is released.
  it('uses drag quality only between corner drag start and end', async () => {
    const image = { naturalWidth: 100, naturalHeight: 100 } as CanvasImageSource;
    const documentState = useStore.getState().documents[0];
    render(
      <>
        <Preview image={image} revision="erase-1" />
        <PerspectiveOverlay document={documentState} width={100} height={100} viewport={{ x: 0, y: 0, scale: 1 }} />
      </>,
    );

    await waitFor(() => expect(vi.mocked(drawPerspectiveImage)).toHaveBeenCalled());
    expect(vi.mocked(drawPerspectiveImage).mock.calls.at(-1)?.[5]).toMatchObject({
      crop,
      sourceBounds,
      opacity: 0.45,
      quality: 'preview',
    });

    const corner = screen.getAllByTestId('perspective-corner')[0];
    fireEvent.pointerDown(corner, { pointerId: 1 });
    await waitFor(() => {
      expect(vi.mocked(drawPerspectiveImage).mock.calls.at(-1)?.[5]).toMatchObject({ quality: 'drag' });
    });

    fireEvent.pointerUp(corner, { pointerId: 1, clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(vi.mocked(drawPerspectiveImage).mock.calls.at(-1)?.[5]).toMatchObject({ quality: 'preview' });
    });
    expect(useEditorUiStore.getState().activeOperation?.kind).toBe('perspective');
  });

  // Mutation caught: clearing only the quality flag on pointer cancellation
  // leaves a queued drag frame able to publish after the gesture has ended.
  it('restores preview quality and cancels a queued frame when dragging is cancelled', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(41);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    const image = { naturalWidth: 100, naturalHeight: 100 } as CanvasImageSource;
    const documentState = useStore.getState().documents[0];
    render(
      <>
        <Preview image={image} revision="erase-1" />
        <PerspectiveOverlay document={documentState} width={100} height={100} viewport={{ x: 0, y: 0, scale: 1 }} />
      </>,
    );
    await waitFor(() => expect(vi.mocked(drawPerspectiveImage)).toHaveBeenCalled());

    const corner = screen.getAllByTestId('perspective-corner')[0];
    fireEvent.pointerDown(corner, { pointerId: 2 });
    fireEvent.pointerMove(corner, { pointerId: 2, clientX: 10, clientY: 8 });
    fireEvent.pointerCancel(corner, { pointerId: 2 });

    await waitFor(() => {
      expect(vi.mocked(drawPerspectiveImage).mock.calls.at(-1)?.[5]).toMatchObject({ quality: 'preview' });
    });
    expect(cancelFrame).toHaveBeenCalledWith(41);
    expect(useEditorUiStore.getState().perspectiveDragLayerKey).toBeNull();
    expect(useEditorUiStore.getState().activeOperation?.kind).toBe('perspective');
  });

  // Mutations caught: omitting resolved image identity from the preview effect,
  // or rendering the previous image under a newer source-revision key.
  it('hides an old resolved source and redraws when the new image identity arrives', async () => {
    useEditorUiStore.setState({ activeOperation: null });
    const oldImage = { naturalWidth: 100, naturalHeight: 100 } as CanvasImageSource;
    const newImage = { naturalWidth: 100, naturalHeight: 100 } as CanvasImageSource;
    const view = render(<Preview image={oldImage} revision="erase-1" />);

    await waitFor(() => expect(vi.mocked(drawPerspectiveImage)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(drawPerspectiveImage).mock.calls[0][1]).toBe(oldImage);

    view.rerender(<Preview image={oldImage} revision="erase-2" />);
    await waitFor(() => expect(screen.queryByTestId('placed-preview')).toBeNull());
    expect(vi.mocked(drawPerspectiveImage)).toHaveBeenCalledTimes(1);

    view.rerender(<Preview image={newImage} revision="erase-2" />);
    await waitFor(() => expect(vi.mocked(drawPerspectiveImage)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(drawPerspectiveImage).mock.calls[1][1]).toBe(newImage);
    expect(screen.getByTestId('placed-preview').getAttribute('data-image-marker')).toBe('preview-2');
  });
});
