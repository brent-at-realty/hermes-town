import { T, TILE } from '../art/tiles';
import { profileColorFor } from '../art/profileColors';
import type { TownSim } from '../sim/town';
import type { TownMap } from '../world/map';
import type { MinimapTone, UiPalette } from '../themes/types';
import type { TownScene } from '../scenes/TownScene';
import { paintWorldMinimap } from '../art/worlds';

/** What the minimap needs from the running Town. All of it is read at draw time, so a map switch only swaps the getters' targets. */
export interface MinimapSource {
  map(): TownMap;
  sim(): TownSim;
  scene(): TownScene | null;
  selectedId(): string | null;
  palette(): MinimapPalette;
}

/** The theme's minimap colours, optionally overridden by the mounted map's own tone. */
export type MinimapPalette = UiPalette['minimap'] & { meadow?: string };

const merged = new WeakMap<object, WeakMap<object, MinimapPalette>>();
/**
 * Fold a map's own minimap colours over the theme's. The result is cached by
 * identity so the minimap only repaints its base when the palette really changes.
 */
export function minimapPalette(base: UiPalette['minimap'], tone: MinimapTone | undefined): MinimapPalette {
  if (!tone) return base;
  let byTone = merged.get(base);
  if (!byTone) { byTone = new WeakMap(); merged.set(base, byTone); }
  let out = byTone.get(tone);
  if (!out) { out = { ...base, ...Object.fromEntries(Object.entries(tone).filter(([, v]) => v !== undefined)) } as MinimapPalette; byTone.set(tone, out); }
  return out;
}

/**
 * Keep the minimap drawn from the mounted map without depending on animation
 * frames alone. Browsers pause requestAnimationFrame for a background or
 * occluded tab while the Town renderer (which uses timers) keeps running, so a
 * map Apply or Reset made then would leave the previous map on the minimap. A
 * timer redraws when no frame has, and an error in one draw cannot end the loop.
 */
export function runMinimap(render: () => void, win: Pick<Window, 'requestAnimationFrame' | 'setInterval' | 'clearInterval'> = window): () => void {
  let last = Number.NEGATIVE_INFINITY;
  const draw = (): void => { last = performance.now(); render(); };
  const frame = (): void => { try { draw(); } finally { win.requestAnimationFrame(frame); } };
  win.requestAnimationFrame(frame);
  const timer = win.setInterval(() => { if (performance.now() - last > 200) draw(); }, 250);
  draw();
  return () => win.clearInterval(timer);
}

export function createMinimap(canvas: HTMLCanvasElement, src: MinimapSource): { render(): void; invalidate(): void } {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  let base: HTMLCanvasElement | null = null;
  let baseMap: TownMap | null = null;
  let basePalette: MinimapPalette | null = null;

  const paintBase = (map: TownMap, p: MinimapPalette): HTMLCanvasElement => {
    // A skinned world (towers and lifts, or bodies and docks) draws its own structure into the minimap.
    const own = paintWorldMinimap(map, p.background);
    if (own) return own;
    const w = map.grid.w, h = map.grid.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = map.ground[y]![x]!;
      g.fillStyle = t === T.water || t === T.water2 || t === T.water3 || t === T.waterLily0 || t === T.waterLily1 || t === T.waterStone ? p.water
        : t === T.cobble || t === T.cobble2 ? p.cobble
        : t === T.path || t === T.path2 || t === T.bridge ? p.path
        : t === T.trail || t === T.trail2 ? p.trail
        : t === T.grassDry || t === T.grassDry2 || t === T.seed0 ? p.grassDry
        : p.meadow !== undefined && (t === T.flwWhite0 || t === T.flwWhite1 || t === T.flwBlue0 || t === T.flwBlue1 || t === T.flwYellow0 || t === T.flwYellow1) ? p.meadow
        : t === T.grassWet || t === T.grassWet2 || t === T.mudWet ? p.grassWet
        : t === T.ledge || t === T.cliff ? p.ledge
        : p.grass;
      g.fillRect(x, y, 1, 1);
    }
    for (const prop of map.props) if (prop.kind === 'tree') { g.fillStyle = p.tree; g.fillRect(Math.floor((prop.x + 16) / TILE), Math.floor((prop.y + 34) / TILE), 1, 1); }
    for (const b of [...map.buildings, ...map.homes]) { g.fillStyle = b.kind === 'house' ? p.house : p.building; g.fillRect(b.x, b.y, b.w, b.h); }
    return c;
  };

  return {
    invalidate() { base = null; },
    render() {
      const map = src.map(), p = src.palette();
      if (!base || baseMap !== map || basePalette !== p) { base = paintBase(map, p); baseMap = map; basePalette = p; }
      const w = map.grid.w, h = map.grid.h;
      const scaleX = canvas.width / w, scaleY = canvas.height / h;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
      const selected = src.selectedId();
      for (const r of src.sim().residents.values()) {
        const dot = profileColorFor(r.profile, r.profileSlot);
        ctx.fillStyle = r.id === selected ? p.dotSelected : dot ? dot.cloth : r.isChild ? p.dotChild : p.dot;
        ctx.fillRect(Math.round((r.x / TILE) * scaleX) - 1, Math.round((r.y / TILE) * scaleY) - 1, 3, 3);
      }
      const scene = src.scene();
      if (scene) {
        const v = scene.getCameraRect();
        ctx.strokeStyle = p.viewport;
        ctx.lineWidth = 1;
        ctx.strokeRect((v.x / TILE) * scaleX, (v.y / TILE) * scaleY, (v.w / TILE) * scaleX, (v.h / TILE) * scaleY);
      }
    },
  };
}
