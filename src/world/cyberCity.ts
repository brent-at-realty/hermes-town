import { TILE } from '../art/tiles';
import type { Place } from '../sim/toolMap';
import type { Building, Prop, Station, TownMap, WorldRegion } from './map';
import { propFooted, WorldGrid, addStation, groundFrom, makeBuilding } from './worldKit';
import type { Point } from './pathfind';
import { createTransitNetwork, LIFT_CAR_BASE_OFFSET, type TransitConnector } from './transit';

/**
 * Cyber City: a 2D cutaway high-rise district.
 *
 * Every floor of every tower is its own walkable deck, drawn inside the tower's
 * cutaway facade. A deck is three tiles deep; the six tiles above it are the
 * room (a Building, which is never walkable). Residents reach another floor
 * only through that tower's lift: walk to the vestibule, board, ride, step out,
 * walk to the station. The street level joins the towers, so a trip between
 * two towers is lift down, walk the street, lift up.
 *
 * The map keeps the original place semantics: every Place has stations here,
 * and the tool-to-place table is untouched.
 */

export const CYBER_W = 84;
export const CYBER_H = 50;
/** Street deck: rows 43..45. Floor k is nine rows higher than floor k-1. */
export const STREET_YB = 45;
export const FLOOR_PITCH = 9;
export const floorBase = (floor: number): number => STREET_YB - FLOOR_PITCH * floor;

export interface CyberFloor { floor: number; place?: Place; pods?: number; label: string }
export interface CyberTower {
  id: string;
  name: string;
  /** Left tile of the tower; it is 19 tiles wide including both walls. */
  x0: number;
  accent: string;
  floors: CyberFloor[];
}

export const TOWER_W = 19;

export const CYBER_TOWERS: readonly CyberTower[] = [
  { id: 'archive', name: 'Archive Tower', x0: 1, accent: '#35e6ff', floors: [
    { floor: 1, place: 'library', label: 'Library' }, { floor: 2, place: 'observatory', label: 'Observatory' } ] },
  { id: 'maker', name: 'Maker Tower', x0: 22, accent: '#ffb347', floors: [
    { floor: 1, place: 'workshop', label: 'Workshop' }, { floor: 2, place: 'forge', label: 'Forge' } ] },
  { id: 'operations', name: 'Operations Tower', x0: 43, accent: '#ff3fa4', floors: [
    { floor: 1, place: 'post', label: 'Post office' }, { floor: 2, place: 'hall', label: 'Town hall' }, { floor: 3, place: 'tavern', label: 'Tavern' } ] },
  { id: 'residential', name: 'Residential Tower', x0: 64, accent: '#8a5cff', floors: [
    { floor: 1, pods: 3, label: 'Pods 1-3' }, { floor: 2, pods: 2, label: 'Pods 4-5' }, { floor: 3, pods: 2, label: 'Pods 6-7' } ] },
];

/** Tile of the lift vestibule on a floor of a tower. Floor 0 is the street. */
export function vestibule(tower: CyberTower, floor: number): Point {
  return { x: tower.x0 + 2, y: floor === 0 ? STREET_YB - 1 : floorBase(floor) - 1 };
}

/**
 * Lift geometry in world pixels. The cabin is in a shaft BEHIND the deck slabs. A resident walks the ordinary deck
 * line (the middle row of the deck, the same row the stations use) to the vestibule tile; the cabin waits at the back
 * edge of the deck with its floor on the deck's top edge, never inside the deck artwork. Between two decks the shaft
 * is open; across a deck the slab is solid and the cabin passes behind it.
 */
export const LIFT_SHAFT_HALF_W = 22;
export const DECK_H = 3 * TILE;
/** Pixel row of the back (top) edge of a floor's deck. */
export const deckTopPx = (floor: number): number => (floorBase(floor) - 2) * TILE;
export const liftCentreX = (tower: CyberTower): number => vestibule(tower, 0).x * TILE + TILE / 2;
/** Where the cabin's floor stands when it is level with a floor: the back edge of that floor's deck. */
export function liftCabinFloorPx(tower: CyberTower, floor: number): number {
  return vestibule(tower, floor).y * TILE + TILE / 2 + LIFT_CAR_BASE_OFFSET;
}

export interface LiftOccluderRect { id: string; tower: string; floor: number; x: number; y: number; w: number; h: number }
/**
 * The solid slab of every upper deck across the shaft. A cabin that is level with one floor passes behind the slabs of
 * the floors between. The street deck needs none: the cabin never travels below its top edge.
 */
export function liftOccluderRects(): LiftOccluderRect[] {
  const out: LiftOccluderRect[] = [];
  for (const tower of CYBER_TOWERS) {
    const cx = liftCentreX(tower);
    for (const f of tower.floors) out.push({ id: `${tower.id}-f${f.floor}`, tower: tower.id, floor: f.floor, x: cx - LIFT_SHAFT_HALF_W, y: deckTopPx(f.floor), w: 2 * LIFT_SHAFT_HALF_W, h: DECK_H });
  }
  return out;
}

const STATION_X: Partial<Record<Place, number[]>> = {
  library: [7, 9, 13, 15], workshop: [7, 9, 13, 15], forge: [7, 9, 13, 15],
  observatory: [7, 13, 15], post: [7, 13, 15], hall: [7, 9, 13, 15], tavern: [6, 8, 12, 14, 16],
};
const PROP_FOR: Partial<Record<Place, 'terminal' | 'fabBay' | 'foundryRig' | 'dispatchDock' | 'scopeArray' | 'commandConsole' | 'loungeSeat'>> = {
  library: 'terminal', workshop: 'fabBay', forge: 'foundryRig', post: 'dispatchDock', observatory: 'scopeArray', hall: 'commandConsole', tavern: 'loungeSeat',
};

export function buildCyberCityMap(): TownMap {
  const grid = new WorldGrid(CYBER_W, CYBER_H);
  const regions: WorldRegion[] = [];
  const buildings: Building[] = [];
  const homes: Building[] = [];
  const stations: Station[] = [];
  const props: Prop[] = [];
  const connectors: TransitConnector[] = [];

  // ---- street level: one continuous deck joins every tower
  grid.carve(1, STREET_YB - 2, 82, 3);
  regions.push({ id: 'street', label: 'Street', kind: 'street', x: 1, y: STREET_YB - 2, w: 82, h: 3, shape: 'rect' });

  for (const tower of CYBER_TOWERS) {
    for (const f of tower.floors) {
      const yb = floorBase(f.floor);
      grid.carve(tower.x0 + 1, yb - 2, TOWER_W - 2, 3);
      regions.push({ id: `${tower.id}-f${f.floor}`, label: `${tower.name} · ${f.label}`, kind: 'deck', x: tower.x0 + 1, y: yb - 2, w: TOWER_W - 2, h: 3, shape: 'rect' });
      if (f.place) {
        const place = f.place;
        const rx = tower.x0 + 5;
        const room = makeBuilding(place, place, rx, yb - 8, 13, 6, f.label, { x: tower.x0 + 11, y: yb - 2 });
        buildings.push(room);
        for (const dx of STATION_X[place]!) addStation(grid, stations, props, place, { x: tower.x0 + dx, y: yb - 1 }, 'up', PROP_FOR[place]!);
      }
    }
  }

  // ---- homes: resident pods in the Residential Tower, with a door and porch tiles each
  const res = CYBER_TOWERS[3]!;
  let pod = 0;
  for (const f of res.floors) {
    const yb = floorBase(f.floor);
    for (let i = 0; i < (f.pods ?? 0); i++) {
      const x = res.x0 + 5 + i * 4;
      const door = { x: x + 2, y: yb - 2 };
      homes.push(makeBuilding(`home-${pod}`, 'house', x, yb - 6, 4, 4, `Pod ${pod + 1}`, door, [{ x, y: yb - 2 }, { x: x + 3, y: yb - 2 }]));
      pod += 1;
    }
  }

  // ---- the neon arcade at street level: the market's kiosks. They start right of the Maker Tower's lift landing (tile 24)
  // so the lift threshold on the street is free of kiosks and of the arcade facade.
  for (const x of [27, 29, 31, 33, 35, 37]) addStation(grid, stations, props, 'market', { x, y: STREET_YB - 1 }, 'up', 'kiosk');

  // ---- a bulletin board on the command floor: turns are pinned here
  const ops = CYBER_TOWERS[2]!;
  props.push(propFooted('noticeBoard', ops.x0 + 17, floorBase(2) * TILE - 2 * TILE + 6, []));
  grid.block(ops.x0 + 17, floorBase(2) - 2);

  // ---- lifts: every ordered pair of floors of a tower, ground included
  for (const tower of CYBER_TOWERS) {
    const floors = [0, ...tower.floors.map((f) => f.floor)];
    for (const a of floors) for (const b of floors) {
      if (a === b) continue;
      connectors.push({
        id: `lift-${tower.id}-${a}-${b}`,
        kind: 'lift',
        fromRegion: a === 0 ? 'street' : `${tower.id}-f${a}`,
        toRegion: b === 0 ? 'street' : `${tower.id}-f${b}`,
        boarding: vestibule(tower, a),
        exit: vestibule(tower, b),
        durationMs: 1500 + 650 * Math.abs(a - b),
        visual: { kind: 'lift', tower: tower.id, floorFrom: a, floorTo: b },
      });
    }
  }

  const lamps: Point[] = [5, 15, 25, 35, 45, 55, 65, 75].map((x) => ({ x, y: STREET_YB - 3 }));
  const entrance = { x: 2, y: STREET_YB - 1 };
  const transit = createTransitNetwork({ w: grid.w, h: grid.h, cost: grid.cost }, connectors);
  return {
    ground: groundFrom(grid),
    height: new Float32Array(grid.w * grid.h),
    grid: { w: grid.w, h: grid.h, cost: grid.cost },
    buildings, stations, props, homes, lamps, entrance,
    transit, skin: 'cyber-city', regions,
  };
}
