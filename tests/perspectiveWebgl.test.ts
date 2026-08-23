import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calculatePerspectiveRenderBounds,
  mapFramebufferUvToDocumentPoint,
  renderPerspectiveWebgl,
  resetPerspectiveWebglRenderer,
} from '@/utils/perspectiveWebgl';

const rectangle = {
  topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 },
};

function createWebglHarness() {
  let contextLostListener: ((event: Event) => void) | undefined;
  let canvasWidth = 300;
  let canvasHeight = 150;
  const widthWrites = vi.fn((value: number) => { canvasWidth = value; });
  const heightWrites = vi.fn((value: number) => { canvasHeight = value; });
  const canvas = {
    get width() { return canvasWidth; },
    set width(value: number) { widthWrites(value); },
    get height() { return canvasHeight; },
    set height(value: number) { heightWrites(value); },
    getContext: vi.fn(),
    addEventListener: vi.fn((name: string, listener: (event: Event) => void) => {
      if (name === 'webglcontextlost') contextLostListener = listener;
    }),
  } as unknown as HTMLCanvasElement;

  const gl = {
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    CLAMP_TO_EDGE: 0x812f,
    LINEAR: 0x2601,
    COLOR_BUFFER_BIT: 0x4000,
    NO_ERROR: 0,
    INVALID_OPERATION: 0x0502,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    getProgramInfoLog: vi.fn(() => ''),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation: vi.fn((_program, name: string) => ({ name })),
    createTexture: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    deleteTexture: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    activeTexture: vi.fn(),
    bindTexture: vi.fn(),
    pixelStorei: vi.fn(),
    texParameteri: vi.fn(),
    texImage2D: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniformMatrix3fv: vi.fn(),
    drawArrays: vi.fn(),
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => false),
  };
  (canvas.getContext as ReturnType<typeof vi.fn>).mockReturnValue(gl);

  return {
    canvas,
    gl,
    widthWrites,
    heightWrites,
    loseContext: () => contextLostListener,
  };
}

afterEach(() => {
  resetPerspectiveWebglRenderer();
});

describe('perspective WebGL renderer', () => {
  it('limits its surface to the quad bounds', () => {
    expect(calculatePerspectiveRenderBounds({
      topLeft: { x: .2, y: .1 }, topRight: { x: .8, y: .2 },
      bottomRight: { x: .9, y: .7 }, bottomLeft: { x: .1, y: .8 },
    }, 1000, 500)).toEqual({ x: 100, y: 50, width: 800, height: 350 });
  });

  it('maps bottom-up framebuffer UV into top-down document coordinates', () => {
    const bounds = { x: 10, y: 20, width: 80, height: 60 };
    expect(mapFramebufferUvToDocumentPoint({ x: 0, y: 1 }, bounds)).toEqual({ x: 10, y: 20 });
    expect(mapFramebufferUvToDocumentPoint({ x: 1, y: 1 }, bounds)).toEqual({ x: 90, y: 20 });
    expect(mapFramebufferUvToDocumentPoint({ x: 1, y: 0 }, bounds)).toEqual({ x: 90, y: 80 });
    const interior = mapFramebufferUvToDocumentPoint({ x: .25, y: .8 }, bounds);
    expect(interior.x).toBeCloseTo(30);
    expect(interior.y).toBeCloseTo(32);
  });

  it('returns null instead of throwing when WebGL is unavailable', () => {
    const canvasFactory = () => ({ getContext: vi.fn(() => null) }) as unknown as HTMLCanvasElement;
    expect(renderPerspectiveWebgl({} as CanvasImageSource, rectangle, 100, 100, { canvasFactory })).toBeNull();
  });

  it('reuses one program and surface while uploading premultiplied, edge-safe textures', () => {
    const harness = createWebglHarness();
    const canvasFactory = vi.fn(() => harness.canvas);
    const quad = {
      topLeft: { x: .1, y: .2 }, topRight: { x: .9, y: .2 },
      bottomRight: { x: .9, y: .8 }, bottomLeft: { x: .1, y: .8 },
    };

    const first = renderPerspectiveWebgl({} as CanvasImageSource, quad, 100, 100, { canvasFactory });
    const second = renderPerspectiveWebgl({} as CanvasImageSource, quad, 100, 100, { canvasFactory });

    expect(first).toEqual({ canvas: harness.canvas, bounds: { x: 10, y: 20, width: 80, height: 60 } });
    expect(second).toEqual(first);
    expect(canvasFactory).toHaveBeenCalledTimes(1);
    expect(harness.gl.createProgram).toHaveBeenCalledTimes(1);
    expect(harness.gl.createBuffer).toHaveBeenCalledTimes(1);
    expect(harness.widthWrites).toHaveBeenCalledTimes(1);
    expect(harness.heightWrites).toHaveBeenCalledTimes(1);
    expect(harness.gl.pixelStorei).toHaveBeenCalledWith(harness.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    expect(harness.gl.pixelStorei).toHaveBeenCalledWith(harness.gl.UNPACK_FLIP_Y_WEBGL, false);
    expect(harness.gl.texParameteri).toHaveBeenCalledWith(
      harness.gl.TEXTURE_2D, harness.gl.TEXTURE_WRAP_S, harness.gl.CLAMP_TO_EDGE,
    );
    expect(harness.gl.texParameteri).toHaveBeenCalledWith(
      harness.gl.TEXTURE_2D, harness.gl.TEXTURE_WRAP_T, harness.gl.CLAMP_TO_EDGE,
    );
    expect(harness.gl.texParameteri).toHaveBeenCalledWith(
      harness.gl.TEXTURE_2D, harness.gl.TEXTURE_MIN_FILTER, harness.gl.LINEAR,
    );
    expect(harness.gl.texParameteri).toHaveBeenCalledWith(
      harness.gl.TEXTURE_2D, harness.gl.TEXTURE_MAG_FILTER, harness.gl.LINEAR,
    );
    expect(harness.gl.drawArrays).toHaveBeenCalledTimes(2);
  });

  it('uploads a column-major inverse mapping from document pixels directly to normalized source UV', () => {
    const harness = createWebglHarness();
    const quad = {
      topLeft: { x: .1, y: .2 }, topRight: { x: .9, y: .2 },
      bottomRight: { x: .9, y: .8 }, bottomLeft: { x: .1, y: .8 },
    };

    renderPerspectiveWebgl({} as CanvasImageSource, quad, 100, 100, { canvasFactory: () => harness.canvas });

    const matrix = harness.gl.uniformMatrix3fv.mock.calls[0][2] as Float32Array;
    expect(Array.from(matrix)).toEqual([
      0.012500000186264515, 0, 0,
      0, 0.01666666753590107, 0,
      -0.125, -0.3333333432674408, 1,
    ]);
  });

  it('uploads sourceBounds and local crop rectangles for a seam-free partial-source draw', () => {
    const harness = createWebglHarness();
    renderPerspectiveWebgl({} as CanvasImageSource, rectangle, 100, 100, {
      canvasFactory: () => harness.canvas,
      sourceRect: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      sampleRect: { x: 0.25, y: 0.125, width: 0.5, height: 0.75 },
    });

    expect(harness.gl.uniform4f).toHaveBeenCalledWith(
      { name: 'u_sourceRect' }, 0.2, 0.1, 0.6, 0.8,
    );
    expect(harness.gl.uniform4f).toHaveBeenCalledWith(
      { name: 'u_sampleRect' }, 0.25, 0.125, 0.5, 0.75,
    );
  });

  it('clears the singleton and notifies the caller when the context is lost', () => {
    const firstHarness = createWebglHarness();
    const secondHarness = createWebglHarness();
    const canvasFactory = vi.fn()
      .mockReturnValueOnce(firstHarness.canvas)
      .mockReturnValueOnce(secondHarness.canvas);
    const onContextLost = vi.fn();
    renderPerspectiveWebgl({} as CanvasImageSource, rectangle, 100, 100, { canvasFactory, onContextLost });
    const preventDefault = vi.fn();

    firstHarness.loseContext()?.({ preventDefault } as unknown as Event);
    const recovered = renderPerspectiveWebgl({} as CanvasImageSource, rectangle, 100, 100, { canvasFactory });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onContextLost).toHaveBeenCalledOnce();
    expect(canvasFactory).toHaveBeenCalledTimes(2);
    expect(recovered?.canvas).toBe(secondHarness.canvas);
  });

  it('returns null when texture upload sets a WebGL error', () => {
    const harness = createWebglHarness();
    harness.gl.getError
      .mockReturnValueOnce(harness.gl.NO_ERROR)
      .mockReturnValueOnce(harness.gl.INVALID_OPERATION);

    expect(renderPerspectiveWebgl(
      {} as CanvasImageSource,
      rectangle,
      100,
      100,
      { canvasFactory: () => harness.canvas },
    )).toBeNull();
    expect(harness.gl.texImage2D).toHaveBeenCalledOnce();
    expect(harness.gl.drawArrays).not.toHaveBeenCalled();
  });

  it('returns null when drawing sets a WebGL error', () => {
    const harness = createWebglHarness();
    harness.gl.getError
      .mockReturnValueOnce(harness.gl.NO_ERROR)
      .mockReturnValueOnce(harness.gl.NO_ERROR)
      .mockReturnValueOnce(harness.gl.INVALID_OPERATION);

    expect(renderPerspectiveWebgl(
      {} as CanvasImageSource,
      rectangle,
      100,
      100,
      { canvasFactory: () => harness.canvas },
    )).toBeNull();
    expect(harness.gl.drawArrays).toHaveBeenCalledOnce();
  });

  it('returns null when the WebGL context becomes lost during upload', () => {
    const harness = createWebglHarness();
    harness.gl.isContextLost
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    expect(renderPerspectiveWebgl(
      {} as CanvasImageSource,
      rectangle,
      100,
      100,
      { canvasFactory: () => harness.canvas },
    )).toBeNull();
    expect(harness.gl.drawArrays).not.toHaveBeenCalled();
  });

  it('releases both shaders when fragment compilation fails', () => {
    const harness = createWebglHarness();
    harness.gl.getShaderParameter
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(renderPerspectiveWebgl(
      {} as CanvasImageSource,
      rectangle,
      100,
      100,
      { canvasFactory: () => harness.canvas },
    )).toBeNull();
    expect(harness.gl.deleteShader).toHaveBeenCalledTimes(2);
  });

  it('releases partially allocated resources when initialization throws', () => {
    const harness = createWebglHarness();
    harness.gl.bufferData.mockImplementation(() => { throw new Error('buffer allocation failed'); });

    expect(renderPerspectiveWebgl(
      {} as CanvasImageSource,
      rectangle,
      100,
      100,
      { canvasFactory: () => harness.canvas },
    )).toBeNull();
    expect(harness.gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(harness.gl.deleteTexture).toHaveBeenCalledOnce();
    expect(harness.gl.deleteProgram).toHaveBeenCalledOnce();
  });
});
