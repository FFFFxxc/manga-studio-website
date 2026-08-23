import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRasterLayer, BlurSettings, ImageDocument } from '@/types';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { blendEffectPixelData, createRasterEffectSession } from '@/utils/rasterEffectSession';
import { applyRasterEffectPreview } from '@/utils/rasterEffects';

const rasterMocks = vi.hoisted(() => ({
  buildBaseCanvas: vi.fn(),
  buildCleanupMask: vi.fn(),
  buildRasterLayerCanvas: vi.fn(),
  drawBrushStroke: vi.fn(),
  renderRasterEffect: vi.fn(),
}));

vi.mock('@/utils/cleanupRaster', () => ({
  buildBaseCanvas: rasterMocks.buildBaseCanvas,
  buildCleanupMask: rasterMocks.buildCleanupMask,
  buildRasterLayerCanvas: rasterMocks.buildRasterLayerCanvas,
}));

vi.mock('@/utils/brushRaster', () => ({ drawBrushStroke: rasterMocks.drawBrushStroke }));
vi.mock('@/utils/rasterEffectPrimitives', () => ({ renderRasterEffect: rasterMocks.renderRasterEffect }));

interface PixelBounds { x: number; y: number; width: number; height: number }

class SessionCanvas {
  width = 0;
  height = 0;
  alphaBounds: PixelBounds | null = null;
  readonly context = new SessionContext(this);
  private contextInitialized = false;
  firstContextOptions: CanvasRenderingContext2DSettings | undefined;

  getContext(type: string, options?: CanvasRenderingContext2DSettings) {
    if (type === '2d' && !this.contextInitialized) {
      this.contextInitialized = true;
      this.firstContextOptions = options;
    }
    return type === '2d' ? this.context : null;
  }

  toDataURL() {
    return `data:image/png;base64,session-${this.width}x${this.height}`;
  }
}

class SessionContext {
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  imageSmoothingEnabled = true;
  readbackCount = 0;

  constructor(readonly canvas: SessionCanvas) {}

  save() {}
  restore() {}

  fillRect(x: number, y: number, width: number, height: number) {
    this.canvas.alphaBounds = { x, y, width, height };
  }

  drawImage(sourceValue: CanvasImageSource, ...values: number[]) {
    const source = sourceValue as unknown as SessionCanvas;
    if (source.alphaBounds && this.globalCompositeOperation === 'source-over') {
      this.canvas.alphaBounds = values.length >= 8
        ? { x: values[4], y: values[5], width: values[6], height: values[7] }
        : { ...source.alphaBounds };
    }
  }

  getImageData(x: number, y: number, width: number, height: number) {
    this.readbackCount += 1;
    const data = new Uint8ClampedArray(width * height * 4);
    const bounds = this.canvas.alphaBounds;
    if (bounds) {
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          const px = x + column;
          const py = y + row;
          if (px >= bounds.x && px < bounds.x + bounds.width && py >= bounds.y && py < bounds.y + bounds.height) {
            data[(row * width + column) * 4 + 3] = 255;
          }
        }
      }
    }
    return { data, width, height, colorSpace: 'srgb' } as ImageData;
  }

  createImageData(width: number, height: number) {
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;
  }

  putImageData(image: ImageData, x: number, y: number) {
    let hasAlpha = false;
    for (let index = 3; index < image.data.length; index += 4) {
      if (image.data[index] > 0) { hasAlpha = true; break; }
    }
    if (hasAlpha) this.canvas.alphaBounds = { x, y, width: image.width, height: image.height };
  }
}

const createdSurfaces: SessionCanvas[] = [];

function createSurface(width: number, height: number) {
  const canvas = new SessionCanvas();
  canvas.width = width;
  canvas.height = height;
  createdSurfaces.push(canvas);
  return canvas;
}

const settings: BlurSettings = {
  mode: 'blur',
  gesture: 'brush',
  applyTo: 'layer',
  brushSize: 0.1,
  hardness: 0.7,
  radius: 18,
  strength: 0.5,
  cellSize: 24,
  noiseAmount: 0.18,
  noiseMonochrome: true,
  sharpenRadius: 1,
  sharpenAmount: 0.5,
};

function drawingLayer(overrides: Partial<AiRasterLayer> = {}): AiRasterLayer {
  return {
    id: 'drawing-layer',
    name: 'Drawing',
    src: 'data:image/png;base64,source',
    visible: true,
    opacity: 1,
    operation: 'drawing',
    locked: false,
    eraseElements: [],
    adjustments: { brightness: 1, contrast: 1, saturation: 1 },
    crop: null,
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...overrides,
  };
}

function documentWithDrawing(overrides: Partial<ImageDocument> = {}) {
  const document = makeEditorDocument({
    id: 'effect-document',
    width: 100,
    height: 80,
    baseLayer: {
      ...makeEditorDocument({ id: 'effect-document' }).baseLayer,
      id: 'base-effect-document',
      visible: true,
      locked: false,
    },
    aiLayers: [drawingLayer()],
    selectedLayer: { type: 'ai', id: 'drawing-layer' },
    layerOrder: [
      { type: 'base', id: 'base-effect-document' },
      { type: 'ai', id: 'drawing-layer' },
    ],
    ...overrides,
  });
  return document;
}

function makeOptions(overrides: Partial<Parameters<typeof createRasterEffectSession>[0]> = {}) {
  return {
    documentId: 'effect-document',
    layer: { type: 'ai' as const, id: 'drawing-layer' },
    settings: { ...settings },
    previewScale: 0.5,
    createCanvas: createSurface as unknown as NonNullable<Parameters<typeof createRasterEffectSession>[0]['createCanvas']>,
    ...overrides,
  };
}

describe('raster effect stroke session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdSurfaces.length = 0;
    vi.stubGlobal('OffscreenCanvas', SessionCanvas);
    const source = createSurface(100, 80);
    source.alphaBounds = { x: 0, y: 0, width: 100, height: 80 };
    rasterMocks.buildBaseCanvas.mockResolvedValue(source);
    rasterMocks.buildRasterLayerCanvas.mockResolvedValue(source);
    const selection = createSurface(100, 80);
    selection.alphaBounds = { x: 10, y: 12, width: 30, height: 24 };
    rasterMocks.buildCleanupMask.mockResolvedValue({ canvas: selection, isEmpty: false, blob: new Blob() });
    rasterMocks.drawBrushStroke.mockImplementation((context: SessionContext) => {
      context.canvas.alphaBounds = { x: 10, y: 12, width: 20, height: 24 };
      return { x: 10, y: 12, width: 20, height: 24 };
    });
    rasterMocks.renderRasterEffect.mockImplementation((_source, bounds: PixelBounds) => createSurface(bounds.width, bounds.height));
    useStore.setState({
      documents: [documentWithDrawing()],
      activeDocIndex: 0,
      blurSettings: { ...settings },
      selectedObject: null,
      activeTool: 'blur',
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not mutate the document while appending or rendering a preview', async () => {
    const session = await createRasterEffectSession(makeOptions());
    const before = useStore.getState().documents[0];

    session.append([0.1, 0.2, 0.3, 0.4]);
    const preview = await session.renderPreview();

    expect(useStore.getState().documents[0]).toBe(before);
    expect(preview?.bounds).toEqual({ x: 5, y: 6, width: 10, height: 12 });
    expect(preview?.canvas).toMatchObject({ width: 50, height: 40 });
    expect(preview?.target).toEqual({ type: 'ai', id: 'drawing-layer' });
    expect(preview?.opacity).toBe(1);
  });

  it('initializes every preview readback surface with willReadFrequently', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);

    await session.renderPreview();

    const readbackSurfaces = createdSurfaces.filter(canvas => canvas.context.readbackCount > 0);
    expect(readbackSurfaces.length).toBeGreaterThan(0);
    expect(readbackSurfaces.every(canvas => canvas.firstContextOptions?.willReadFrequently === true)).toBe(true);
  });

  it('replaces RGB through the soft mask without increasing source alpha', () => {
    const result = blendEffectPixelData(
      new Uint8ClampedArray([20, 40, 60, 80]),
      new Uint8ClampedArray([220, 140, 100, 80]),
      new Uint8ClampedArray([255, 255, 255, 128]),
    );

    expect([...result]).toEqual([120, 90, 80, 80]);
  });

  it('snapshots settings and reuses one seed for preview and commit', async () => {
    const mutableSettings = { ...settings };
    const session = await createRasterEffectSession(makeOptions({ settings: mutableSettings }));
    mutableSettings.mode = 'noise';
    mutableSettings.radius = 64;
    mutableSettings.strength = 1;
    mutableSettings.hardness = 0;
    session.append([0.1, 0.2, 0.3, 0.4]);

    await session.renderPreview();
    await session.commit();

    expect(rasterMocks.renderRasterEffect).toHaveBeenCalledTimes(2);
    const previewCall = rasterMocks.renderRasterEffect.mock.calls[0];
    const commitCall = rasterMocks.renderRasterEffect.mock.calls[1];
    expect(previewCall[2]).toBe('blur');
    expect(commitCall[2]).toBe('blur');
    expect(previewCall[3].seed).toBe(commitCall[3].seed);
    expect(previewCall[3].coordinateScale).toBe(0.5);
    expect(commitCall[3].coordinateScale).toBe(1);
  });

  it.each([
    ['blur', { radius: 7, strength: 0.3 }],
    ['pixelate', { cellSize: 20, strength: 0.3 }],
    ['noise', { noiseAmount: 0.2, noiseMonochrome: false, strength: 1 }],
    ['sharpen', { radius: 2, strength: 0.8 }],
  ] as const)('maps independent %s controls into preview parameters', async (mode, expected) => {
    const session = await createRasterEffectSession(makeOptions({
      settings: {
        ...settings,
        mode,
        radius: 14,
        strength: 0.3,
        cellSize: 40,
        noiseAmount: 0.2,
        noiseMonochrome: false,
        sharpenRadius: 4,
        sharpenAmount: 0.8,
      },
    }));
    session.append([0.1, 0.2, 0.3, 0.4]);

    await session.renderPreview();

    expect(rasterMocks.renderRasterEffect).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      mode,
      expect.objectContaining(expected),
    );
    session.cancel();
  });

  it('renders only newly dirty preview bounds and reuses the scaled source', async () => {
    rasterMocks.drawBrushStroke
      .mockImplementationOnce((context: SessionContext) => {
        context.canvas.alphaBounds = { x: 10, y: 12, width: 20, height: 24 };
        return { x: 10, y: 12, width: 20, height: 24 };
      })
      .mockImplementationOnce((context: SessionContext) => {
        context.canvas.alphaBounds = { x: 70, y: 60, width: 10, height: 10 };
        return { x: 70, y: 60, width: 10, height: 10 };
      });
    const session = await createRasterEffectSession(makeOptions());

    session.append([0.1, 0.2, 0.3, 0.4]);
    const first = await session.renderPreview();
    session.append([0.7, 0.7, 0.8, 0.8]);
    const second = await session.renderPreview();

    expect(first?.bounds).toEqual({ x: 5, y: 6, width: 10, height: 12 });
    expect(second?.bounds).toEqual({ x: 35, y: 30, width: 5, height: 5 });
    expect(rasterMocks.renderRasterEffect.mock.calls[0][0])
      .toBe(rasterMocks.renderRasterEffect.mock.calls[1][0]);
  });

  it('commits a drawing layer with one history entry and preserves its operation', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);

    const id = await session.commit();

    const document = useStore.getState().documents[0];
    expect(id).toBe('drawing-layer');
    expect(document.past).toHaveLength(1);
    expect(document.aiLayers).toHaveLength(1);
    expect(document.aiLayers[0].operation).toBe('drawing');
    expect(document.aiLayers[0].src).toBe('data:image/png;base64,session-100x80');
  });

  it('rebases erase elements already baked into the committed AI source', async () => {
    const erased = drawingLayer({
      eraseElements: [{ type: 'polygon', points: [0, 0, 1, 0, 1, 1], mode: 'add' }],
    });
    useStore.setState({
      documents: [documentWithDrawing({ aiLayers: [erased] })],
      activeDocIndex: 0,
    });
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);

    await session.commit();

    expect(useStore.getState().documents[0].aiLayers[0].eraseElements).toEqual([]);
  });

  it('cancels without history and refuses a later commit', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);
    session.cancel();

    await expect(session.commit()).rejects.toThrow('Операция отменена');
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('cancels an in-flight commit before its store boundary', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);

    const pending = session.commit();
    session.cancel();

    await expect(pending).rejects.toThrow('Операция отменена');
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('allows only one in-flight commit for a stroke', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);

    const results = await Promise.allSettled([session.commit(), session.commit()]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('allows only one in-flight base commit and preserves the base visual slot', async () => {
    const document = documentWithDrawing({
      selectedLayer: { type: 'base', id: 'base-effect-document' },
      baseLayer: {
        ...documentWithDrawing().baseLayer,
        id: 'base-effect-document',
        opacity: 0.65,
        adjustments: { brightness: 1.2, contrast: 0.8, saturation: 0.9 },
        eraseElements: [{ type: 'polygon', points: [0, 0, 1, 0, 1, 1], mode: 'add' }],
      },
    });
    const originalOrder = (document.layerOrder ?? []).map(ref => ({ ...ref }));
    useStore.setState({ documents: [document], activeDocIndex: 0 });
    const session = await createRasterEffectSession(makeOptions({ layer: { type: 'base' } }));
    session.append([0.1, 0.2, 0.3, 0.4]);

    const results = await Promise.allSettled([session.commit(), session.commit()]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const updated = useStore.getState().documents[0];
    expect(updated.past).toHaveLength(1);
    expect(updated.aiLayers).toEqual(document.aiLayers);
    expect(updated.layerOrder).toEqual(originalOrder);
    expect(updated.cleanup.committed).toBe('data:image/png;base64,session-100x80');
    expect(updated.baseLayer.opacity).toBe(0.65);
    expect(updated.baseLayer.adjustments).toEqual({ brightness: 1, contrast: 1, saturation: 1 });
    expect(updated.baseLayer.eraseElements).toEqual([]);

    useStore.getState().undo();
    const restored = useStore.getState().documents[0];
    expect(restored.cleanup.committed).toBe(document.cleanup.committed);
    expect(restored.baseLayer.adjustments).toEqual(document.baseLayer.adjustments);
    expect(restored.baseLayer.eraseElements).toEqual(document.baseLayer.eraseElements);
    expect(restored.layerOrder).toEqual(originalOrder);
  });

  it('rejects a locked target before building source pixels', async () => {
    const document = documentWithDrawing({ aiLayers: [drawingLayer({ locked: true })] });
    useStore.setState({ documents: [document], activeDocIndex: 0 });

    await expect(createRasterEffectSession(makeOptions())).rejects.toThrow('Слой заблокирован');
    expect(rasterMocks.buildRasterLayerCanvas).not.toHaveBeenCalled();
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('rejects hidden and missing targets before building source pixels', async () => {
    const hidden = documentWithDrawing({ aiLayers: [drawingLayer({ visible: false })] });
    useStore.setState({ documents: [hidden], activeDocIndex: 0 });
    await expect(createRasterEffectSession(makeOptions())).rejects.toThrow('Слой скрыт');
    expect(rasterMocks.buildRasterLayerCanvas).not.toHaveBeenCalled();

    useStore.setState({ documents: [documentWithDrawing()], activeDocIndex: 0 });
    await expect(createRasterEffectSession(makeOptions({ layer: { type: 'ai', id: 'missing' } }))).rejects.toThrow('Слой не найден');
    expect(rasterMocks.buildRasterLayerCanvas).not.toHaveBeenCalled();
  });

  it('rejects transformed and perspective targets before building source pixels', async () => {
    useStore.setState({
      documents: [documentWithDrawing({ aiLayers: [drawingLayer({ x: 0.1 })] })],
      activeDocIndex: 0,
    });
    await expect(createRasterEffectSession(makeOptions())).rejects.toThrow('деформированного слоя');
    expect(rasterMocks.buildRasterLayerCanvas).not.toHaveBeenCalled();

    useStore.setState({
      documents: [documentWithDrawing({
        aiLayers: [drawingLayer({
          perspective: {
            topLeft: { x: 0.1, y: 0.1 },
            topRight: { x: 0.9, y: 0.1 },
            bottomRight: { x: 0.9, y: 0.9 },
            bottomLeft: { x: 0.1, y: 0.9 },
          },
        })],
      })],
      activeDocIndex: 0,
    });
    await expect(createRasterEffectSession(makeOptions())).rejects.toThrow('деформированного слоя');
    expect(rasterMocks.buildRasterLayerCanvas).not.toHaveBeenCalled();
  });

  it('rejects an empty selection before building source pixels or history', async () => {
    rasterMocks.buildCleanupMask.mockResolvedValueOnce({ canvas: createSurface(100, 80), isEmpty: true, blob: new Blob() });

    await expect(createRasterEffectSession(makeOptions({ settings: { ...settings, applyTo: 'selection' } })))
      .rejects.toThrow('Сначала создайте выделение');

    expect(rasterMocks.buildRasterLayerCanvas).not.toHaveBeenCalled();
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('keeps the captured selection mask when the store selection changes', async () => {
    const session = await createRasterEffectSession(makeOptions({ settings: { ...settings, applyTo: 'selection' } }));
    const current = useStore.getState().documents[0];
    useStore.setState({ documents: [{ ...current, activeMaskId: null }] });

    const preview = await session.renderPreview();
    await session.commit();

    expect(preview?.bounds).toEqual({ x: 5, y: 6, width: 15, height: 12 });
    expect(rasterMocks.buildCleanupMask).toHaveBeenCalledTimes(1);
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('rejects commit after switching documents without changing either history', async () => {
    const first = useStore.getState().documents[0];
    const second = documentWithDrawing({ id: 'other-document', selectedLayer: { type: 'ai', id: 'drawing-layer' } });
    useStore.setState({ documents: [first, second], activeDocIndex: 0 });
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);
    useStore.setState({ activeDocIndex: 1 });

    await expect(session.commit()).rejects.toThrow('Активная страница изменилась');
    expect(useStore.getState().documents.every(document => document.past.length === 0)).toBe(true);
  });

  it('rejects commit after the captured layer source changes', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);
    const current = useStore.getState().documents[0];
    useStore.setState({
      documents: [{ ...current, aiLayers: current.aiLayers.map(layer => ({ ...layer, src: 'data:image/png;base64,newer' })) }],
    });

    await expect(session.commit()).rejects.toThrow('Содержимое или геометрия слоя изменились');
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('rejects commit after target geometry changes', async () => {
    const session = await createRasterEffectSession(makeOptions());
    session.append([0.1, 0.2, 0.3, 0.4]);
    const current = useStore.getState().documents[0];
    useStore.setState({
      documents: [{ ...current, aiLayers: current.aiLayers.map(layer => ({ ...layer, rotation: 12 })) }],
    });

    await expect(session.commit()).rejects.toThrow('деформированного слоя');
    expect(useStore.getState().documents[0].past).toHaveLength(0);
  });

  it('keeps applyRasterEffectPreview as a one-history compatibility wrapper', async () => {
    const id = await applyRasterEffectPreview([0.1, 0.2, 0.3, 0.4]);

    expect(id).toBe('drawing-layer');
    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });

  it('commits an area gesture without brush points through the wrapper', async () => {
    useStore.setState({ blurSettings: { ...settings, gesture: 'area' } });

    await applyRasterEffectPreview();

    expect(useStore.getState().documents[0].past).toHaveLength(1);
  });
});
