import { T, TILE } from './tiles';
import { mulberry } from './painter';
import type { TownMap } from '../world/map';

const WATER = new Set<number>([T.water, T.water2, T.water3, T.waterLily0, T.waterLily1, T.waterStone, T.bridge, T.plank]);
const PATH = new Set<number>([T.path, T.path2, T.pathEdge, T.pathGrassy, T.pathStones, T.pathMud, T.trail, T.trail2, T.trampled, T.soot, T.earth, T.earth2, T.mud, T.mudWet]);
const STONE = new Set<number>([T.cobble, T.cobble2, T.cobbleCracked, T.cobbleLeaves, T.cobbleMoss, T.cobbleWorn]);
const BANK = new Set<number>([T.shore, T.shoreGrass, T.reeds0, T.reeds1]);
const family = (tile: number) => WATER.has(tile) ? 3 : PATH.has(tile) ? 1 : STONE.has(tile) ? 2 : BANK.has(tile) ? 4 : 0;

type RGB = readonly [number, number, number];

/**
 * How a map paints its ground. Absent fields keep the original town's colours,
 * so `paintTerrain(map)` with no style is exactly what it has always drawn.
 */
export interface TerrainStyle {
  grass?: RGB;
  water?: RGB;
  /** Scales the broad light and dark swing of the grass. 1 is the original. */
  swing?: number;
  /** Draw blossoms on the tiles the map marks as flowers, tufts on clover, and lily pads on the lily tiles. */
  meadow?: boolean;
}

const BLOSSOM_COLOURS = {
  white: ['#f6f1e2', '#efe6d0', '#ffffff'],
  yellow: ['#f4d54f', '#f0c030', '#f8e27a'],
  blue: ['#86abee', '#6d93dc', '#a9c3f4'],
  pink: ['#ee8fb0', '#e26f9a', '#f6b3c9'],
} as const;

/** The navigation grid stays discrete; the visible ground interpolates across it. */
export function paintTerrain(map: TownMap, style: TerrainStyle = {}): HTMLCanvasElement {
  const w = map.grid.w * TILE * 2, h = map.grid.h * TILE * 2;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(w, h), d = pixels.data;
  const mask = new Uint8Array(w * h);
  const r = mulberry(72178);
  const grass = style.grass ?? [72, 86, 43], water = style.water ?? [36, 76, 88], swing = style.swing ?? 1;
  const kinds = map.ground.map(row => row.map(family));
  const get = (x: number, y: number) => kinds[Math.max(0, Math.min(map.grid.h - 1, y))]![Math.max(0, Math.min(map.grid.w - 1, x))]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = (x + Math.sin(y * 0.19) * 1.6) / (TILE * 2) - 0.5;
    const fy = (y + Math.sin(x * 0.17) * 1.6) / (TILE * 2) - 0.5;
    const tx = Math.floor(fx), ty = Math.floor(fy), u = fx - tx, v = fy - ty;
    const weights = [0, 0, 0, 0, 0];
    weights[get(tx, ty)]! += (1 - u) * (1 - v);
    weights[get(tx + 1, ty)]! += u * (1 - v);
    weights[get(tx, ty + 1)]! += (1 - u) * v;
    weights[get(tx + 1, ty + 1)]! += u * v;
    // Stochastic coverage breaks up the last few pixels of a material edge.
    const edgeNoise = (r() - 0.5) * 0.2;
    weights[0]! += edgeNoise;
    let kind = 0;
    for (let k = 1; k < 5; k++) if (weights[k]! > weights[kind]!) kind = k;
    // A narrow, irregular turf margin replaces the rectangular sand tiles.
    if (kind === 4) kind = weights[3]! > 0.08 ? 4 : 0;
    const grain = (r() - 0.5) * (kind === 3 ? 4 : 15);
    const broad = (Math.sin(x * 0.027 + Math.sin(y * 0.018) * 2) * 7 + Math.sin(y * 0.043 + x * 0.011) * 6) * swing + Math.sin(x * 0.31 + Math.sin(y * 0.25) * 2) * 3;
    const c = kind === 3 ? water : kind === 2 ? [90, 85, 70] : kind === 1 ? [141, 116, 73] : kind === 4 ? [94, 95, 61] : grass;
    const i = (y * w + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = c[ch]! + grain + broad;
    d[i + 3] = 255; mask[y * w + x] = kind;
  }
  ctx.putImageData(pixels, 0, 0);
  // Irregular cobbles span tile boundaries. Each stone has its own mortar,
  // cool shadow, warm upper face, and occasional moss-filled joint.
  for (let y = 0, row = 0; y < h; y += 9, row++) {
    for (let x = row % 2 ? -6 : 0; x < w;) {
      const sw = 8 + Math.floor(r() * 7), sh = 6 + Math.floor(r() * 3);
      if (x >= 0 && mask[y * w + x] === 2) {
        const light = Math.floor(r() * 24);
        ctx.fillStyle = `rgb(${111 + light},${106 + light},${91 + light})`;
        ctx.beginPath(); ctx.moveTo(x + 1, y); ctx.lineTo(x + sw - 2, y);
        ctx.lineTo(x + sw, y + 1); ctx.lineTo(x + sw - 1, y + sh - 1);
        ctx.lineTo(x + 1, y + sh); ctx.lineTo(x, y + 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(224,205,163,.22)'; ctx.fillRect(x + 1, y, sw - 3, 1);
        if (r() < 0.13) { ctx.fillStyle = '#516044'; ctx.fillRect(x, y + sh, 2, 1); }
      }
      x += sw + 1;
    }
  }
  for (let i = 0; i < w * h / 14; i++) {
    const x = Math.floor(r() * w), y = Math.floor(r() * h), k = mask[y * w + x];
    if (k === 0) {
      ctx.fillStyle = r() < 0.5 ? '#71804a' : '#40592f';
      ctx.fillRect(x, y, 1, 1 + Math.floor(r() * 3));
      if (r() < 0.09) { ctx.fillStyle = ['#c4ae61', '#bcbfad', '#a86d82'][Math.floor(r() * 3)]!; ctx.fillRect(x, y - 1, 2, 2); }
    } else if (k === 1 && r() < 0.18) {
      ctx.fillStyle = r() < 0.5 ? '#af9b6d' : '#746342'; ctx.fillRect(x, y, 2, 1);
    } else if (k === 3 && r() < 0.25) {
      ctx.fillStyle = 'rgba(125,170,174,.24)'; ctx.fillRect(x, y, 2 + Math.floor(r() * 5), 1);
    } else if (k === 4 && r() < 0.4) {
      for (let j = 0; j < 4; j++) {
        ctx.strokeStyle = j % 2 ? '#82904b' : '#4a653d';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + j * 2 - 3, y - 8 - r() * 18); ctx.stroke();
      }
    }
  }
  if (style.meadow) paintMeadow(ctx, map, mask, w);
  return canvas;
}

/**
 * Meadow dressing for a map that asks for it: blossoms on flower tiles, clover
 * tufts, lily pads. Its own generator, run after the ground, so the ground it
 * sits on is the same pixels the town would have drawn.
 */
function paintMeadow(ctx: CanvasRenderingContext2D, map: TownMap, mask: Uint8Array, w: number): void {
  const r = mulberry(40441);
  const T2 = TILE * 2;
  const flower = new Map<number, readonly (readonly string[])[]>([
    [T.flwWhite0, [BLOSSOM_COLOURS.white, BLOSSOM_COLOURS.pink]], [T.flwWhite1, [BLOSSOM_COLOURS.white, BLOSSOM_COLOURS.yellow]],
    [T.flwBlue0, [BLOSSOM_COLOURS.blue, BLOSSOM_COLOURS.white]], [T.flwBlue1, [BLOSSOM_COLOURS.blue, BLOSSOM_COLOURS.pink]],
    [T.flwYellow0, [BLOSSOM_COLOURS.yellow, BLOSSOM_COLOURS.white]], [T.flwYellow1, [BLOSSOM_COLOURS.yellow, BLOSSOM_COLOURS.pink]],
  ]);
  for (let ty = 0; ty < map.grid.h; ty++) for (let tx = 0; tx < map.grid.w; tx++) {
    const id = map.ground[ty]![tx]!;
    const x0 = tx * T2, y0 = ty * T2;
    const blooms = flower.get(id);
    if (blooms) {
      for (let i = 0; i < 16; i++) {
        const x = x0 + 2 + Math.floor(r() * (T2 - 6)), y = y0 + 2 + Math.floor(r() * (T2 - 6));
        if (mask[y * w + x] !== 0) continue;
        const set = blooms[r() < 0.72 ? 0 : 1]!;
        ctx.fillStyle = '#3f6a2c'; ctx.fillRect(x + 1, y + 3, 1, 4);
        ctx.fillStyle = set[Math.floor(r() * set.length)]!; ctx.fillRect(x, y, 4, 4); ctx.fillRect(x - 1, y + 1, 6, 2);
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillRect(x + 1, y + 1, 2, 2);
      }
    } else if (id === T.clover) {
      for (let i = 0; i < 9; i++) {
        const x = x0 + 2 + Math.floor(r() * (T2 - 6)), y = y0 + 2 + Math.floor(r() * (T2 - 6));
        if (mask[y * w + x] !== 0) continue;
        ctx.fillStyle = r() < 0.5 ? '#79b04a' : '#8cc558'; ctx.fillRect(x, y, 3, 2); ctx.fillRect(x + 1, y - 1, 1, 4);
      }
    } else if (id === T.waterLily0 || id === T.waterLily1) {
      for (let i = 0; i < 3; i++) {
        const x = x0 + 4 + Math.floor(r() * (T2 - 12)), y = y0 + 4 + Math.floor(r() * (T2 - 10));
        ctx.fillStyle = '#3f8a4a'; ctx.fillRect(x, y, 7, 4); ctx.fillRect(x + 1, y - 1, 5, 6);
        ctx.fillStyle = '#5fae5a'; ctx.fillRect(x + 1, y, 5, 1);
        if (i === 0) { ctx.fillStyle = '#f2a6c0'; ctx.fillRect(x + 2, y + 1, 3, 2); ctx.fillStyle = '#fbe3a0'; ctx.fillRect(x + 3, y + 1, 1, 1); }
      }
    }
  }
}
