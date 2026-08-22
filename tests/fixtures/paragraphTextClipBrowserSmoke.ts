import type { TextObject } from '@/types';
import { renderTextObjectToContext } from '@/utils/textRenderer';

const WIDTH = 240;
const HEIGHT = 180;

const paragraph: TextObject = {
  id: 'paragraph-clip-smoke',
  text: '████████████████\n████████████████\n████████████████\n████████████████',
  fontFamily: 'monospace',
  fontSize: 0.1,
  fill: '#ff0000',
  stroke: '',
  strokeWidth: 0,
  shadowColor: 'transparent',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  lineHeight: 1,
  align: 'left',
  bold: false,
  italic: false,
  vertical: false,
  textMode: 'paragraph',
  width: 0.4,
  height: 0.3,
  x: 0.3666666667,
  y: 0.3222222222,
  scaleX: 1,
  scaleY: 1,
  rotation: 35,
  visible: true,
};

interface PixelSample {
  name: string;
  point: { x: number; y: number };
  rgba: number[];
}

function pixelAt(context: CanvasRenderingContext2D, x: number, y: number): number[] {
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

function assertRedSample(sample: PixelSample) {
  const [red, green, blue, alpha] = sample.rgba;
  if (red < 150 || green > 90 || blue > 90 || alpha < 90) {
    throw new Error(`${sample.name}: expected a red rendered text pixel, received ${sample.rgba.join(',')}`);
  }
}

function assertTransparentSample(sample: PixelSample) {
  const alpha = sample.rgba[3];
  if (alpha > 12) {
    throw new Error(`${sample.name}: expected a transparent clipped pixel, received ${sample.rgba.join(',')}`);
  }
}

export function runParagraphTextClipBrowserSmoke() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable');

  renderTextObjectToContext(context, paragraph, WIDTH, HEIGHT);

  const samples: PixelSample[] = [
    {
      name: 'rotated-only paragraph text survives outside old axis clip',
      point: { x: 72, y: 100 },
      rgba: pixelAt(context, 72, 100),
    },
    {
      name: 'far outside paragraph remains transparent',
      point: { x: 30, y: 30 },
      rgba: pixelAt(context, 30, 30),
    },
  ];

  assertRedSample(samples[0]);
  assertTransparentSample(samples[1]);

  return {
    width: WIDTH,
    height: HEIGHT,
    paragraph: {
      x: paragraph.x,
      y: paragraph.y,
      width: paragraph.width,
      height: paragraph.height,
      rotation: paragraph.rotation,
      scaleX: paragraph.scaleX,
      scaleY: paragraph.scaleY,
    },
    samples,
    image: canvas.toDataURL('image/png'),
  };
}
