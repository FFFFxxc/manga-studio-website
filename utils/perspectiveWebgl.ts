import type { PerspectiveQuad } from '@/types';
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
varying vec2 v_destination;
void main() {
  v_destination = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D u_source;
uniform mat3 u_inverseHomography;
uniform vec2 u_outputSize;
uniform vec4 u_bounds;
varying vec2 v_destination;
void main() {
  vec2 documentPoint = u_bounds.xy + v_destination * u_bounds.zw;
  vec3 sourcePoint = u_inverseHomography * vec3(documentPoint, 1.0);
  vec2 uv = sourcePoint.xy / sourcePoint.z;
  if (sourcePoint.z <= 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  gl_FragColor = texture2D(u_source, vec2(uv.x, 1.0 - uv.y));
}`;

let renderer: RendererState | null = null;

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

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create perspective shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Perspective shader compilation failed';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('Unable to create perspective shader program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Perspective shader program linking failed';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createRenderer(options: PerspectiveWebglOptions): RendererState | null {
  const canvas = options.canvasFactory?.() ?? document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
  });
  if (!gl) return null;

  const program = createProgram(gl);
  const positionBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!positionBuffer || !texture) {
    if (positionBuffer) gl.deleteBuffer(positionBuffer);
    if (texture) gl.deleteTexture(texture);
    gl.deleteProgram(program);
    throw new Error('Unable to allocate perspective renderer resources');
  }

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
  if (state.positionLocation < 0) {
    gl.deleteBuffer(positionBuffer);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
    throw new Error('Perspective vertex attribute is unavailable');
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    if (renderer === state) renderer = null;
    state.onContextLost?.();
  });
  return state;
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.uniform1i(state.sourceLocation, 0);
    gl.uniform2f(state.outputSizeLocation, outputWidth, outputHeight);
    gl.uniform4f(state.boundsLocation, bounds.x, bounds.y, bounds.width, bounds.height);
    gl.uniformMatrix3fv(state.inverseHomographyLocation, false, toColumnMajor(inverseHomography));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return { canvas, bounds };
  } catch {
    return null;
  }
}

export function resetPerspectiveWebglRenderer() {
  if (!renderer) return;
  const { gl, program, positionBuffer, texture } = renderer;
  renderer = null;
  try {
    gl.deleteBuffer(positionBuffer);
    gl.deleteTexture(texture);
    gl.deleteProgram(program);
  } catch {
    // A lost context may reject cleanup; the singleton has already been cleared.
  }
}
