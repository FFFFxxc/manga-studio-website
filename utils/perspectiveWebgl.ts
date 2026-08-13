import type { NormalizedPoint, PerspectiveQuad } from '@/types';
import {
  invertHomography,
  perspectiveHomography,
  type Homography,
} from '@/utils/perspective';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PerspectiveWebglResult {
  canvas: HTMLCanvasElement;
  bounds: PixelRect;
}

export interface PerspectiveWebglOptions {
  canvasFactory?: () => HTMLCanvasElement;
  onContextLost?: () => void;
}

interface RendererState {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  texture: WebGLTexture;
  positionLocation: number;
  sourceLocation: WebGLUniformLocation | null;
  inverseHomographyLocation: WebGLUniformLocation | null;
  outputSizeLocation: WebGLUniformLocation | null;
  boundsLocation: WebGLUniformLocation | null;
  onContextLost?: () => void;
}

const vertexSource = `
attribute vec2 a_position;
varying vec2 v_framebuffer;
void main() {
  v_framebuffer = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D u_source;
uniform mat3 u_inverseHomography;
uniform vec2 u_outputSize;
uniform vec4 u_bounds;
varying vec2 v_framebuffer;
void main() {
  vec2 documentUv = vec2(v_framebuffer.x, 1.0 - v_framebuffer.y);
  vec2 documentPoint = u_bounds.xy + documentUv * u_bounds.zw;
  vec3 sourcePoint = u_inverseHomography * vec3(documentPoint, 1.0);
  vec2 uv = sourcePoint.xy / sourcePoint.z;
  if (sourcePoint.z <= 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  gl_FragColor = texture2D(u_source, uv);
}`;

let renderer: RendererState | null = null;

function hasWebglFailure(gl: WebGLRenderingContext) {
  return gl.isContextLost() || gl.getError() !== gl.NO_ERROR;
}

function safelyCleanup(cleanup: () => void) {
  try {
    cleanup();
  } catch {
    // Best-effort cleanup must not hide the original initialization failure.
  }
}

export function calculatePerspectiveRenderBounds(
  quad: PerspectiveQuad,
  outputWidth: number,
  outputHeight: number,
): PixelRect {
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  const x = Math.floor(Math.min(...points.map(point => point.x)) * outputWidth);
  const y = Math.floor(Math.min(...points.map(point => point.y)) * outputHeight);
  const right = Math.ceil(Math.max(...points.map(point => point.x)) * outputWidth);
  const bottom = Math.ceil(Math.max(...points.map(point => point.y)) * outputHeight);
  return { x, y, width: right - x, height: bottom - y };
}

export function mapFramebufferUvToDocumentPoint(
  framebufferUv: NormalizedPoint,
  bounds: PixelRect,
): NormalizedPoint {
  return {
    x: bounds.x + framebufferUv.x * bounds.width,
    y: bounds.y + (1 - framebufferUv.y) * bounds.height,
  };
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create perspective shader');
  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Perspective shader compilation failed');
    }
    return shader;
  } catch (error) {
    safelyCleanup(() => gl.deleteShader(shader));
    throw error;
  }
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    if (!program) throw new Error('Unable to create perspective shader program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Perspective shader program linking failed');
    }
    return program;
  } catch (error) {
    if (program) safelyCleanup(() => gl.deleteProgram(program));
    throw error;
  } finally {
    safelyCleanup(() => gl.deleteShader(vertexShader));
    if (fragmentShader) safelyCleanup(() => gl.deleteShader(fragmentShader));
  }
}

function createRenderer(options: PerspectiveWebglOptions): RendererState | null {
  const canvas = options.canvasFactory?.() ?? document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
  });
  if (!gl) return null;

  const program = createProgram(gl);
  let positionBuffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  try {
    positionBuffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!positionBuffer || !texture) throw new Error('Unable to allocate perspective renderer resources');

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (hasWebglFailure(gl)) throw new Error('Unable to initialize perspective renderer');

    const state: RendererState = {
      canvas,
      gl,
      program,
      positionBuffer,
      texture,
      positionLocation: gl.getAttribLocation(program, 'a_position'),
      sourceLocation: gl.getUniformLocation(program, 'u_source'),
      inverseHomographyLocation: gl.getUniformLocation(program, 'u_inverseHomography'),
      outputSizeLocation: gl.getUniformLocation(program, 'u_outputSize'),
      boundsLocation: gl.getUniformLocation(program, 'u_bounds'),
      onContextLost: options.onContextLost,
    };
    if (state.positionLocation < 0) throw new Error('Perspective vertex attribute is unavailable');
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      if (renderer === state) renderer = null;
      state.onContextLost?.();
    });
    return state;
  } catch (error) {
    if (positionBuffer) safelyCleanup(() => gl.deleteBuffer(positionBuffer));
    if (texture) safelyCleanup(() => gl.deleteTexture(texture));
    safelyCleanup(() => gl.deleteProgram(program));
    throw error;
  }
}

function getRenderer(options: PerspectiveWebglOptions) {
  if (!renderer) renderer = createRenderer(options);
  else if (options.onContextLost) renderer.onContextLost = options.onContextLost;
  return renderer;
}

function toColumnMajor(matrix: Homography) {
  return new Float32Array([
    matrix[0], matrix[3], matrix[6],
    matrix[1], matrix[4], matrix[7],
    matrix[2], matrix[5], matrix[8],
  ]);
}

export function renderPerspectiveWebgl(
  source: CanvasImageSource,
  quad: PerspectiveQuad,
  outputWidth: number,
  outputHeight: number,
  options: PerspectiveWebglOptions = {},
): PerspectiveWebglResult | null {
  try {
    const homography = perspectiveHomography(quad, outputWidth, outputHeight);
    const inverseHomography = homography && invertHomography(homography);
    if (!inverseHomography) return null;
    const bounds = calculatePerspectiveRenderBounds(quad, outputWidth, outputHeight);
    if (bounds.width <= 0 || bounds.height <= 0) return null;

    const state = getRenderer(options);
    if (!state) return null;
    const { canvas, gl } = state;
    if (canvas.width !== bounds.width) canvas.width = bounds.width;
    if (canvas.height !== bounds.height) canvas.height = bounds.height;

    gl.viewport(0, 0, bounds.width, bounds.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer);
    gl.enableVertexAttribArray(state.positionLocation);
    gl.vertexAttribPointer(state.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    if (hasWebglFailure(gl)) return null;
    gl.uniform1i(state.sourceLocation, 0);
    gl.uniform2f(state.outputSizeLocation, outputWidth, outputHeight);
    gl.uniform4f(state.boundsLocation, bounds.x, bounds.y, bounds.width, bounds.height);
    gl.uniformMatrix3fv(state.inverseHomographyLocation, false, toColumnMajor(inverseHomography));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (hasWebglFailure(gl)) return null;
    return { canvas, bounds };
  } catch {
    return null;
  }
}

export function resetPerspectiveWebglRenderer() {
  if (!renderer) return;
  const { gl, program, positionBuffer, texture } = renderer;
  renderer = null;
  safelyCleanup(() => gl.deleteBuffer(positionBuffer));
  safelyCleanup(() => gl.deleteTexture(texture));
  safelyCleanup(() => gl.deleteProgram(program));
}
