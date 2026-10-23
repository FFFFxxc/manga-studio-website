import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '@/store/useStore';
import { makeEditorDocument } from '@/tests/helpers/makeEditorDocument';
import { BASIC_SHAPE_PRESETS, POINTER_PRESETS, createShapeFromSettings } from '@/utils/shapePresets';
import { getEditableShapePaths, getObjectShapeGeometry, getShapePointHandles, moveShapePoint, sanitizeShapePaths } from '@/utils/shapePoints';

const makeShape = () => createShapeFromSettings('rect', { ...useStore.getState().shapeSettings, cornerRadius: 0 });

describe('editable shape points', () => {
  beforeEach(() => useStore.setState({ documents: [makeEditorDocument()], activeDocIndex: 0, selectedObject: null }));

  it.each([...BASIC_SHAPE_PRESETS, ...POINTER_PRESETS])('creates editable paths for $kind', ({ kind }) => {
    const shape = createShapeFromSettings(kind, useStore.getState().shapeSettings);
    const paths = getEditableShapePaths(shape, 1000, 800);
    expect(sanitizeShapePaths(paths)).toEqual(paths);
    expect(getShapePointHandles(paths).length).toBeGreaterThanOrEqual(2);
    expect(shape.paths).toBeUndefined();
  });

  it('moves coincident rectangle vertices together without mutating the source', () => {
    const paths = getEditableShapePaths(makeShape(), 1000, 800);
    expect(getShapePointHandles(paths)).toHaveLength(4);
    const original = structuredClone(paths);
    const next = moveShapePoint(paths, { x: -0.5, y: -0.5 }, { x: -0.3, y: -0.1 });
    expect(paths).toEqual(original);
    expect(getShapePointHandles(next)).toContainEqual({ x: -0.3, y: -0.1, control: false });
    expect(getShapePointHandles(next).some(point => point.x === -0.5 && point.y === -0.5)).toBe(false);
  });

  it('retains cubic curves and closes the ellipse when its first node moves', () => {
    const shape = createShapeFromSettings('ellipse', useStore.getState().shapeSettings);
    const paths = getEditableShapePaths(shape, 1000, 800);
    const next = moveShapePoint(paths, { x: -0.5, y: 0 }, { x: -0.7, y: 0.1 });
    expect(next.fillPath![0].points).toEqual([-0.7, 0.1]);
    expect(next.fillPath!.at(-2)!.points.slice(-2)).toEqual([-0.7, 0.1]);
    expect(next.fillPath!.filter(segment => segment.command === 'C')).toHaveLength(4);
  });

  it('scales custom coordinates identically for preview and export', () => {
    const shape = makeShape();
    shape.paths = moveShapePoint(getEditableShapePaths(shape, 1000, 800), { x: -0.5, y: -0.5 }, { x: -0.3, y: -0.1 });
    expect(getObjectShapeGeometry(shape, 200, 100).fillPath).toContain('M -60 -10');
    expect(getObjectShapeGeometry(shape, 400, 200).fillPath).toContain('M -120 -20');
  });

  it('groups live point changes into one undo step and restores them on redo', () => {
    const shape = makeShape();
    useStore.getState().addShape(shape);
    const paths = getEditableShapePaths(shape, 1000, 800);
    useStore.getState().pushHistory();
    for (const x of [-0.4, -0.3, -0.2]) {
      useStore.getState().updateShape(shape.id, { paths: moveShapePoint(paths, { x: -0.5, y: -0.5 }, { x, y: -0.5 }) });
    }
    expect(useStore.getState().documents[0].past).toHaveLength(2);
    const edited = structuredClone(useStore.getState().documents[0].shapes[0].paths);
    useStore.getState().undo();
    expect(useStore.getState().documents[0].shapes[0].paths).toBeUndefined();
    useStore.getState().redo();
    expect(useStore.getState().documents[0].shapes[0].paths).toEqual(edited);
  });

  it('does not change points on a locked shape', () => {
    const shape = { ...makeShape(), locked: true };
    useStore.getState().addShape(shape);
    useStore.getState().updateShape(shape.id, { paths: getEditableShapePaths(shape, 1000, 800) });
    expect(useStore.getState().documents[0].shapes[0].paths).toBeUndefined();
  });

  it('rejects invalid path data', () => {
    expect(sanitizeShapePaths({ fillPath: [{ command: 'M', points: [Infinity, 0] }] })).toBeUndefined();
    expect(sanitizeShapePaths({ fillPath: [{ command: 'C', points: [0, 0] }] })).toBeUndefined();
  });
});
