'use client';

import { useState } from 'react';
import { Circle, Line } from 'react-konva';
import type { EditableShapePaths } from '@/types';
import { getShapePointHandles, moveShapePoint } from '@/utils/shapePoints';

export function ShapePointHandles({ paths, width, height, handleScale = 1, onBeforeChange, onChange }: {
  paths: EditableShapePaths;
  width: number;
  height: number;
  handleScale?: number;
  onBeforeChange: () => void;
  onChange: (paths: EditableShapePaths) => void;
}) {
  const [dragSource, setDragSource] = useState<EditableShapePaths | null>(null);
  const source = dragSource ?? paths;
  const handles = getShapePointHandles(source);
  const guides: number[][] = [];
  for (const path of [paths.fillPath, paths.strokePath]) {
    let previous: number[] | undefined;
    for (const segment of path ?? []) {
      const p = segment.points;
      if (previous && (segment.command === 'Q' || segment.command === 'C')) {
        guides.push([previous[0] * width, previous[1] * height, p[0] * width, p[1] * height]);
        if (segment.command === 'C') guides.push([p[2] * width, p[3] * height, p[4] * width, p[5] * height]);
        else guides.push([p[0] * width, p[1] * height, p[2] * width, p[3] * height]);
      }
      if (p.length) previous = p.slice(-2);
    }
  }

  return <>
    {guides.map((points, index) => <Line key={`guide-${index}`} points={points} stroke="#eeb76d" strokeWidth={1 / handleScale} dash={[4 / handleScale, 4 / handleScale]} listening={false} />)}
    {handles.map((point, index) => <Circle
      key={index}
      name={`shape-point-${index}`}
      x={point.x * width}
      y={point.y * height}
      radius={(point.control ? 4 : 6) / handleScale}
      fill={point.control ? '#eeb76d' : '#ffffff'}
      stroke={point.control ? '#704819' : '#5e9fe8'}
      strokeWidth={2 / handleScale}
      hitStrokeWidth={14 / handleScale}
      draggable
      onMouseDown={event => { event.cancelBubble = true; }}
      onTouchStart={event => { event.cancelBubble = true; }}
      onClick={event => { event.cancelBubble = true; }}
      onTap={event => { event.cancelBubble = true; }}
      onDragStart={event => {
        event.cancelBubble = true;
        setDragSource(paths);
        onBeforeChange();
      }}
      onDragMove={event => {
        event.cancelBubble = true;
        onChange(moveShapePoint(source, point, { x: event.target.x() / width, y: event.target.y() / height }));
      }}
      onDragEnd={event => {
        event.cancelBubble = true;
        onChange(moveShapePoint(source, point, { x: event.target.x() / width, y: event.target.y() / height }));
        setDragSource(null);
      }}
    />)}
  </>;
}
