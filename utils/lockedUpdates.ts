const GEOMETRY_KEYS = new Set([
  'x',
  'y',
  'width',
  'height',
  'scaleX',
  'scaleY',
  'rotation',
  'crop',
  'perspective',
  'perspectiveSourceBounds',
  'paths',
]);

export function filterLockedGeometryUpdates<T extends object>(
  locked: boolean | undefined,
  updates: T,
): Partial<T> {
  if (!locked) return updates;
  return Object.fromEntries(
    Object.entries(updates).filter(([key]) => !GEOMETRY_KEYS.has(key)),
  ) as Partial<T>;
}
