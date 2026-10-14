import type { WorldRegion } from './map';

/** Whether a tile centre lies inside an authored region (a rectangle, or the ellipse inscribed in it). */
export function regionContains(region: WorldRegion, x: number, y: number): boolean {
  const px = x + 0.5, py = y + 0.5;
  if (px < region.x || py < region.y || px > region.x + region.w || py > region.y + region.h) return false;
  if (region.shape === 'rect') return true;
  const rx = region.w / 2, ry = region.h / 2;
  const dx = (px - (region.x + rx)) / rx, dy = (py - (region.y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Tiles of the walkable grid that no authored walkable region (street, deck or body) contains, or that the sun contains. */
export function strayWalkable(grid: { w: number; h: number; cost: Uint8Array }, regions: readonly WorldRegion[]): { void: number[]; sun: number[] } {
  const out = { void: [] as number[], sun: [] as number[] };
  const walkable = regions.filter((r) => r.kind !== 'sun');
  const suns = regions.filter((r) => r.kind === 'sun');
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) {
    if (grid.cost[y * grid.w + x] === 0) continue;
    if (suns.some((s) => regionContains(s, x, y))) out.sun.push(y * grid.w + x);
    if (!walkable.some((r) => regionContains(r, x, y))) out.void.push(y * grid.w + x);
  }
  return out;
}
