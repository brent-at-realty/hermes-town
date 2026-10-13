import { T, TILE } from '../art/tiles';
import { profileColorFor } from '../art/profileColors';
import type { TownSim } from '../sim/town';
import type { TownMap } from '../world/map';
import type { UiPalette } from '../themes/types';
import type { TownScene } from '../scenes/TownScene';

/** What the minimap needs from the running Town. All of it is read at draw time, so a map switch only swaps the getters' targets. */
export interface MinimapSource {
  map(): TownMap;
  sim(): TownSim;
  scene(): TownScene | null;
  selectedId(): string | null;
  palette(): UiPalette['minimap'];
}

export function createMinimap(canvas: HTMLCanvasElement, src: MinimapSource): { render(): void; invalidate(): void } {
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  let base: HTMLCanvasElement | null = null;
  let baseMap: TownMap | null = null;
  let basePalette: UiPalette['minimap'] | null = null;

  const paintBase = (map: TownMap, p: UiPalette['minimap']): HTMLCanvasElement => {
    const w = map.grid.w, h = map.grid.h;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = map.ground[y]![x]!;
      g.fillStyle = t === T.water || t === T.water2 || t === T.water3 ? p.water
        : t === T.cobble || t === T.cobble2 ? p.cobble
        : t === T.path || t === T.path2 || t === T.bridge ? p.path
        : t === T.trail || t === T.trail2 ? p.trail
        : t === T.grassDry || t === T.grassDry2 || t === T.seed0 ? p.grassDry
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
