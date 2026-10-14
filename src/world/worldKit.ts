import { TILE, T } from '../art/tiles';
import type { Facing } from '../art/characters';
import type { Place } from '../sim/toolMap';
import { PROP_ANCHORS } from './dressing';
import type { Building, Prop, PropKind, Station } from './map';
import type { Point } from './pathfind';

/**
 * Small authoring helpers shared by the Cyber City and Orbital System worlds.
 * They only build the same data the original town builds: a cost grid, stations,
 * props, buildings and homes. Nothing here knows about Phaser or the simulator.
 */

export class WorldGrid {
  readonly cost: Uint8Array;
  constructor(readonly w: number, readonly h: number) { this.cost = new Uint8Array(w * h); }

  inside(x: number, y: number): boolean { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  open(x: number, y: number): boolean { return this.inside(x, y) && this.cost[y * this.w + x] !== 0; }
  set(x: number, y: number, c: number): void { if (this.inside(x, y)) this.cost[y * this.w + x] = c; }

  /** A walkable rectangle of floor. */
  carve(x: number, y: number, w: number, h: number, c = 1): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  /** A walkable ellipse inscribed in the rectangle: the local surface of a planet or moon. */
  carveDisk(x: number, y: number, w: number, h: number, c = 1): void {
    const rx = w / 2, ry = h / 2;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      const dx = (i + 0.5 - (x + rx)) / rx, dy = (j + 0.5 - (y + ry)) / ry;
      if (dx * dx + dy * dy <= 1) this.set(i, j, c);
    }
  }

  block(x: number, y: number): void { this.set(x, y, 0); }
  blockRect(x: number, y: number, w: number, h: number): void { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.block(i, j); }
}

/** A prop whose sprite is centred on a tile column with its feet at a pixel row. */
export function propFooted(kind: PropKind, tileX: number, footY: number, blocks: Point[]): Prop {
  const anchor = PROP_ANCHORS[kind] ?? [16, 16];
  return { kind, x: Math.round(tileX * TILE + TILE / 2 - anchor[0] / 2), y: Math.round(footY - anchor[1]), blocks };
}

/**
 * A workstation on a deck or surface tile. Its prop stands behind the tile (the tile one row up), so the resident
 * stands in front of its equipment and the prop blocks only its own tile.
 */
export function addStation(grid: WorldGrid, stations: Station[], props: Prop[], place: Place, tile: Point, facing: Facing, kind: PropKind): void {
  const behind = { x: tile.x, y: tile.y - 1 };
  const prop = propFooted(kind, tile.x, tile.y * TILE + 4, [behind]);
  props.push(prop);
  stations.push({ id: `${place}-${stations.length}`, place, tile, facing, prop: { kind, x: prop.x, y: prop.y } });
  grid.block(behind.x, behind.y);
  grid.set(tile.x, tile.y, 1);
}

/** A building (room, module or pod) whose door tile sits in front of it and which may have porch tiles beside the door. */
export function makeBuilding(id: string, kind: Building['kind'], x: number, y: number, w: number, h: number, label: string, door?: Point, porch: Point[] = []): Building {
  return { id, kind, x, y, w, h, door: door ?? { x: x + Math.floor(w / 2), y: y + h }, porch, label };
}

/** The ground array every TownMap carries. Skinned worlds paint their own art, so this is only a coarse floor class. */
export function groundFrom(grid: WorldGrid): number[][] {
  const ground: number[][] = [];
  for (let y = 0; y < grid.h; y++) {
    ground.push([]);
    for (let x = 0; x < grid.w; x++) ground[y]!.push(grid.cost[y * grid.w + x] === 0 ? T.grass : T.cobble);
  }
  return ground;
}
