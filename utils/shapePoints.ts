import type { EditableShapePaths, ShapeObject, ShapePathCommand } from '@/types';
import { getShapeGeometry, type ShapeGeometry } from './shapeGeometry';

const pointCounts = { M: 2, L: 2, Q: 4, C: 6, Z: 0 } as const;

export function sanitizeShapePaths(value: EditableShapePaths | undefined): EditableShapePaths | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: EditableShapePaths = {};
  for (const key of ['fillPath', 'strokePath'] as const) {
    const path = value[key];
    if (path === undefined) continue;
    if (!Array.isArray(path) || path.length === 0 || path.length > 256 || path[0]?.command !== 'M') return undefined;
    for (const segment of path) {
      if (!segment || !Object.hasOwn(pointCounts, segment.command) || !Array.isArray(segment.points)
        || segment.points.length !== pointCounts[segment.command]
        || !segment.points.every(point => Number.isFinite(point) && Math.abs(point) <= 20)) return undefined;
    }
    result[key] = path.map(segment => ({ command: segment.command, points: [...segment.points] }));
  }
  return result.fillPath || result.strokePath ? result : undefined;
}

function parsePath(data: string | undefined, width: number, height: number): ShapePathCommand[] | undefined {
  if (!data) return undefined;
  return [...data.matchAll(/([MLQCZ])([^MLQCZ]*)/g)].map(([, command, numbers]) => ({
    command: command as ShapePathCommand['command'],
    points: (numbers.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [])
      .map((value, index) => Number(value) / (index % 2 === 0 ? width : height)),
  }));
}

/** Materialize a preset without changing its appearance or document data. */
export function getEditableShapePaths(shape: ShapeObject, docWidth: number, docHeight: number): EditableShapePaths {
  if (shape.paths) return shape.paths;
  const width = Math.max(1, shape.width * docWidth);
  const height = Math.max(1, shape.height * docHeight);
  if (shape.kind === 'ellipse') {
    const k = 0.5522847498307936 / 2;
    return { fillPath: [
      { command: 'M', points: [-0.5, 0] },
      { command: 'C', points: [-0.5, -k, -k, -0.5, 0, -0.5] },
      { command: 'C', points: [k, -0.5, 0.5, -k, 0.5, 0] },
      { command: 'C', points: [0.5, k, k, 0.5, 0, 0.5] },
      { command: 'C', points: [-k, 0.5, -0.5, k, -0.5, 0] },
      { command: 'Z', points: [] },
    ] };
  }
  const geometry = getShapeGeometry(shape.kind, width, height, shape.curve, shape.cornerRadius);
  return { fillPath: parsePath(geometry.fillPath, width, height), strokePath: parsePath(geometry.strokePath, width, height) };
}

export function getShapePointHandles(paths: EditableShapePaths) {
  const handles = new Map<string, { x: number; y: number; control: boolean }>();
  for (const path of [paths.fillPath, paths.strokePath]) {
    for (const segment of path ?? []) {
      for (let i = 0; i < segment.points.length; i += 2) {
        const x = segment.points[i], y = segment.points[i + 1];
        const key = `${x.toFixed(8)},${y.toFixed(8)}`;
        const control = i < segment.points.length - 2;
        const existing = handles.get(key);
        if (!existing || !control) handles.set(key, { x, y, control });
      }
    }
  }
  return [...handles.values()];
}

/** Move coincident points together, keeping closed paths and arrow tips joined. */
export function moveShapePoint(paths: EditableShapePaths, from: { x: number; y: number }, to: { x: number; y: number }): EditableShapePaths {
  if (![to.x, to.y].every(Number.isFinite)) return paths;
  const next: EditableShapePaths = {};
  for (const key of ['fillPath', 'strokePath'] as const) {
    next[key] = paths[key]?.map(segment => {
      const points = [...segment.points];
      for (let i = 0; i < points.length; i += 2) {
        if (Math.abs(points[i] - from.x) < 1e-8 && Math.abs(points[i + 1] - from.y) < 1e-8) {
          points[i] = Math.max(-20, Math.min(20, to.x));
          points[i + 1] = Math.max(-20, Math.min(20, to.y));
        }
      }
      return { command: segment.command, points };
    });
  }
  return next;
}

export function getObjectShapeGeometry(shape: ShapeObject, width: number, height: number, scale = 1): ShapeGeometry {
  if (!shape.paths) return getShapeGeometry(shape.kind, width, height, shape.curve, shape.cornerRadius * scale);
  const renderPath = (segments: ShapePathCommand[] | undefined) => segments?.map(segment =>
    `${segment.command} ${segment.points.map((point, index) => point * (index % 2 === 0 ? width : height)).join(' ')}`,
  ).join(' ');
  return { fillPath: renderPath(shape.paths.fillPath), strokePath: renderPath(shape.paths.strokePath) };
}
