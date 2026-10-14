import { mulberry } from './painter';

/**
 * Procedural weather textures. Pure canvas painters with no Phaser and no
 * knowledge of residents: the scene tiles them over the world and scrolls them.
 * Every texture is seamless, so a TileSprite can wrap it without a visible join.
 */

/** Smooth value noise that repeats every `period` lattice cells in both axes. */
function periodicNoise(seed: number, period: number): (x: number, y: number) => number {
  const r = mulberry(seed);
  const cells = Array.from({ length: period * period }, () => r());
  const at = (ix: number, iy: number) => cells[((iy % period) + period) % period * period + ((ix % period) + period) % period]!;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = fade(x - ix), fy = fade(y - iy);
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
  };
}

/**
 * A seamless bank of fog: soft white-grey billows with clear gaps between
 * them. The alpha is the whole signal, so the scene can tint it to the theme's
 * haze colour. `coverage` is how much of the sheet is fog (0..1).
 */
export function paintFogBank(seed: number, size = 512, coverage = 0.55): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d')!;
  const image = g.createImageData(size, size);
  const base = 3;
  const octaves = [periodicNoise(seed, base), periodicNoise(seed + 1, base * 2), periodicNoise(seed + 2, base * 4)];
  const weights = [0.58, 0.28, 0.14];
  // Where the banks start to appear and where they are fully formed.
  const lo = 0.62 - coverage * 0.5, hi = lo + 0.34;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    for (let o = 0; o < octaves.length; o++) v += octaves[o]!((x / size) * base * 2 ** o, (y / size) * base * 2 ** o) * weights[o]!;
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    const a = t * t * (3 - 2 * t);
    const i = (y * size + x) * 4;
    image.data[i] = 236; image.data[i + 1] = 241; image.data[i + 2] = 245;
    image.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/**
 * A seamless sheet of slanted rain streaks. Streaks are drawn again one sheet
 * over in each direction so a streak that leaves one edge re-enters the other.
 */
export function paintRainSheet(seed: number, streaks: number, length: number, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d')!;
  const r = mulberry(seed);
  const slant = 0.22;
  for (let i = 0; i < streaks; i++) {
    const x = r() * size, y = r() * size, len = length * (0.7 + r() * 0.6);
    const alpha = 0.45 + r() * 0.55, wide = r() < 0.25 ? 2 : 1;
    g.strokeStyle = `rgba(214,228,245,${alpha.toFixed(2)})`;
    g.lineWidth = wide;
    for (const [ox, oy] of [[0, 0], [-size, 0], [size, 0], [0, -size], [0, size]] as const) {
      g.beginPath();
      g.moveTo(x + ox, y + oy);
      g.lineTo(x + ox - len * slant, y + oy + len);
      g.stroke();
    }
  }
  return canvas;
}

/** A small flat ring: the splash a raindrop makes on the ground. */
export function paintRipple(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 14; canvas.height = 8;
  const g = canvas.getContext('2d')!;
  g.strokeStyle = 'rgba(226,238,250,0.95)';
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(7, 4, 5.5, 2.5, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(226,238,250,0.55)';
  g.fillRect(6, 3, 2, 1);
  return canvas;
}
