import type { ShapeKind, ShapeObject, ShapeSettings } from '@/types';
import { uid } from '@/utils/imageUtils';
import { cloneGlowStyle, clonePaintStyle } from '@/utils/objectPaint';

export interface ShapePreset {
  kind: ShapeKind;
  label: string;
}

export const BASIC_SHAPE_PRESETS: ShapePreset[] = [
  { kind: 'rect', label: 'Прямоугольник' },
  { kind: 'ellipse', label: 'Эллипс' },
  { kind: 'line', label: 'Линия' },
  { kind: 'arrow', label: 'Стрелка' },
  { kind: 'star', label: 'Звезда' },
];

export const POINTER_PRESETS: ShapePreset[] = [
  { kind: 'arrow', label: 'Прямая' },
  { kind: 'double-arrow', label: 'Двойная' },
  { kind: 'curved-arrow', label: 'Изогнутая' },
  { kind: 'elbow-arrow', label: 'Угловая' },
  { kind: 'block-arrow', label: 'Блочная' },
  { kind: 'chevron', label: 'Шеврон' },
  { kind: 'pointer', label: 'Указатель' },
];

const OPEN_SHAPES = new Set<ShapeKind>([
  'line',
  'arrow',
  'double-arrow',
  'curved-arrow',
  'elbow-arrow',
]);

export function isOpenShape(kind: ShapeKind) {
  return OPEN_SHAPES.has(kind);
}

export function isPointerShape(kind: ShapeKind) {
  return POINTER_PRESETS.some(preset => preset.kind === kind);
}

export function createShapeFromSettings(
  kind: ShapeKind,
  settings: ShapeSettings,
): ShapeObject {
  const open = isOpenShape(kind);
  const tallPath = kind === 'curved-arrow' || kind === 'elbow-arrow';
  return {
    id: uid(),
    kind,
    x: 0.5,
    y: 0.5,
    width: open ? 0.3 : 0.25,
    height: open ? (tallPath ? 0.14 : 0.08) : 0.2,
    fill: open ? '' : settings.fill,
    stroke: settings.stroke,
    // Open paths use their stroke as the object itself, not as an automatic
    // outline. Closed shapes start without an outline until the user adds one.
    strokeWidth: open ? Math.max(1, settings.strokeWidth || 4) : settings.strokeWidth,
    opacity: settings.opacity,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    cornerRadius: settings.cornerRadius,
    visible: true,
    fillStyle: clonePaintStyle(open ? { type: 'solid', color: 'transparent' } : settings.fillStyle),
    strokeStyle: clonePaintStyle(settings.strokeStyle),
    glow: cloneGlowStyle(settings.glow),
    lineStyle: settings.lineStyle,
    curve: settings.curve,
  };
}
