import { TILE } from '../art/tiles';
import type { Place } from '../sim/toolMap';
import type { Building, ExclusionRect, Prop, Station, TownMap, WorldRegion } from './map';
import { propFooted, WorldGrid, addStation, groundFrom, makeBuilding } from './worldKit';
import type { Point } from './pathfind';
import { createTransitNetwork, LIFT_CAR_BASE_OFFSET, type DistrictModel, type TransitConnector } from './transit';

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

/**
 * The passenger inside a lift cabin, in world pixels: 8 px wide and 14 px tall (the passenger sprite at its drawn
 * scale), standing 4 px above the cabin floor. The scene and the verification share this box, so "the rider is behind a
 * slab" means one thing: this box overlaps the slab.
 */
export const PASSENGER_HALF_W = 4;
export const PASSENGER_H = 14;
/** The lift cabin in world pixels (its floor is the row the cabin stands on; it extends upward). */
export const LIFT_CABIN = { w: 30, h: 50 } as const;
export const PASSENGER_FLOOR_GAP = 4;
export interface RiderBox { x0: number; x1: number; y0: number; y1: number }
export function liftPassengerBox(x: number, cabinFloorY: number): RiderBox {
  return { x0: x - PASSENGER_HALF_W, x1: x + PASSENGER_HALF_W, y0: cabinFloorY - PASSENGER_FLOOR_GAP - PASSENGER_H, y1: cabinFloorY - PASSENGER_FLOOR_GAP };
}
/**
 * The solid slab of the rider's own tower that the rider is physically behind, or null when the rider is in a shaft
 * opening or at a landing. Per slab, never global: it considers only this tower's shaft and only the box passed in.
 */
export function slabBehindRider(tower: string, box: RiderBox, slabs: readonly LiftOccluderRect[] = liftOccluderRects()): LiftOccluderRect | null {
  for (const s of slabs) {
    if (s.tower !== tower) continue;
    if (box.x1 > s.x && box.x0 < s.x + s.w && box.y1 > s.y && box.y0 < s.y + s.h) return s;
  }
  return null;
}

// ------------------------------------------------------------------ the street road and its traffic

/**
 * The road below the street deck, in world pixels. A dashed divider runs down its middle. Traffic keeps to the left, as
 * in Brisbane: the lane nearer the curb carries eastbound traffic and the far lane carries westbound traffic. Every
 * decorative car and every car a resident rides is fixed to the centre line of its lane, so none ever crosses the
 * divider. The painter, the ambient traffic, the car transit and the verification all read this one object.
 */
export const ROAD = {
  y0: (STREET_YB + 1) * TILE,
  y1: CYBER_H * TILE,
  divider: (STREET_YB + 1) * TILE + 22,
  dividerThickness: 3,
  eastLaneY: (STREET_YB + 1) * TILE + 10,
  westLaneY: (STREET_YB + 1) * TILE + 34,
} as const;
/** Car size in world pixels. The cars of earlier builds were 22 by 8. */
export const CAR_SIZE = { w: 40, h: 15 } as const;
export const PRIOR_CAR_SIZE = { w: 22, h: 8 } as const;
/** Decorative traffic speed range, world pixels per second (earlier builds: 26 to 50). */
export const TRAFFIC_SPEED = { min: 72, max: 116 } as const;
/** The speed of a car carrying a resident, world pixels per second. */
export const CAR_RIDE_SPEED = 140;

// ------------------------------------------------------------------ districts and car links

/**
 * A district is the stretch of street in front of one tower. Towers stand in order along the street, so "next to" is
 * simply the neighbouring tower. A trip within a district or to a neighbouring district is a walk (and any lift); a trip
 * to a district that is further along takes a car between the two curb stops. No pixel distance is involved.
 */
export const CYBER_DISTRICTS: readonly { id: string; name: string; index: number }[] = CYBER_TOWERS.map((t, index) => ({ id: t.id, name: t.name, index }));
const districtIndex = (id: string): number => CYBER_DISTRICTS.findIndex((d) => d.id === id);
export function cyberDistrictOf(p: Point): string | null {
  if (p.y < STREET_YB - 2 || p.y > STREET_YB) return null;
  let best: CyberTower | null = null, bestD = Infinity;
  for (const t of CYBER_TOWERS) { const d = Math.abs(p.x + 0.5 - (t.x0 + TOWER_W / 2)); if (d < bestD) { bestD = d; best = t; } }
  return best ? best.id : null;
}
export function cyberDistrictsAdjacent(a: string, b: string): boolean {
  const i = districtIndex(a), j = districtIndex(b);
  return i >= 0 && j >= 0 && Math.abs(i - j) <= 1;
}
export const CYBER_DISTRICT_MODEL: DistrictModel = { of: cyberDistrictOf, adjacent: cyberDistrictsAdjacent };
/** Tiles right of a tower's left edge where its curb stop is. The stop is on the street's front row, beside the road. */
export const CAR_STOP_DX = 12;
export const carStop = (tower: CyberTower): Point => ({ x: tower.x0 + CAR_STOP_DX, y: STREET_YB });

/** One authored car link for every ordered pair of districts that are apart (never a neighbouring pair). */
export function cyberCarConnectors(): TransitConnector[] {
  const out: TransitConnector[] = [];
  for (const a of CYBER_TOWERS) for (const b of CYBER_TOWERS) {
    if (a === b || cyberDistrictsAdjacent(a.id, b.id)) continue;
    const from = carStop(a), to = carStop(b);
    const east = to.x > from.x;
    out.push({
      id: `car-${a.id}-${b.id}`, kind: 'car', fromRegion: 'street', toRegion: 'street', boarding: from, exit: to,
      durationMs: Math.round(1100 + (Math.abs(to.x - from.x) * TILE / CAR_RIDE_SPEED) * 1000),
      visual: { kind: 'car', lane: east ? 'east' : 'west', laneY: east ? ROAD.eastLaneY : ROAD.westLaneY, from: a.id, to: b.id, destination: b.name },
    });
  }
  return out;
}

// ------------------------------------------------------------------ watch posts

export interface CyberPost { id: string; label: string; landmark: string; tile: Point }
/**
 * Where keepers stand on watch. Every post is on the street deck beside a landmark (a street lamp, an alley mouth, the
 * arcade, a curb), clear of every lift approach, shaft and car stop. `validatePosts` (and the map validation) hold that.
 */
export const CYBER_POSTS: readonly CyberPost[] = [
  { id: 'archive-forecourt', label: 'Archive forecourt', landmark: 'Archive Tower forecourt, beside the neon edge', tile: { x: 8, y: STREET_YB - 2 } },
  { id: 'archive-lamp', label: 'Archive street lamp', landmark: 'street lamp east of the Archive Tower', tile: { x: 17, y: STREET_YB - 2 } },
  { id: 'service-alley-west', label: 'West service alley', landmark: 'mouth of the service alley between the Archive and Maker towers', tile: { x: 20, y: STREET_YB } },
  { id: 'arcade-lamp', label: 'Arcade lamp', landmark: 'street lamp at the neon arcade', tile: { x: 30, y: STREET_YB - 2 } },
  { id: 'arcade-east', label: 'Arcade east curb', landmark: 'east end of the neon arcade, on the curb', tile: { x: 40, y: STREET_YB } },
  { id: 'operations-lamp', label: 'Operations street lamp', landmark: 'street lamp west of the Operations Tower mid-block', tile: { x: 51, y: STREET_YB - 2 } },
  { id: 'operations-curb', label: 'Operations curb', landmark: 'curb below the Operations Tower, beside the road', tile: { x: 59, y: STREET_YB } },
  { id: 'service-alley-east', label: 'East service alley', landmark: 'mouth of the service alley between the Operations and Residential towers', tile: { x: 62, y: STREET_YB } },
  { id: 'residence-lamp', label: 'Residence street lamp', landmark: 'street lamp west of the Residential Tower mid-block', tile: { x: 71, y: STREET_YB - 2 } },
  { id: 'residence-curb', label: 'Residence curb', landmark: 'curb at the east end of the street, beside the road', tile: { x: 80, y: STREET_YB } },
];

/** Tile rectangles no post may stand in: every lift shaft, every lift's landing and approach on every deck, every car stop. */
export function cyberPostExclusions(): ExclusionRect[] {
  const out: ExclusionRect[] = [];
  for (const tower of CYBER_TOWERS) {
    const v = vestibule(tower, 0).x;
    const top = Math.max(...tower.floors.map((f) => f.floor));
    const roof = floorBase(top) - 8;
    out.push({ id: `${tower.id}-shaft`, kind: 'shaft', x: v - 1, y: roof, w: 3, h: STREET_YB - roof + 1 });
    for (const floor of [0, ...tower.floors.map((f) => f.floor)]) {
      out.push({ id: `${tower.id}-f${floor}-approach`, kind: 'lift-approach', x: v - 3, y: floor === 0 ? STREET_YB - 2 : floorBase(floor) - 2, w: 7, h: 3 });
    }
    const stop = carStop(tower);
    out.push({ id: `${tower.id}-car-stop`, kind: 'car-stop', x: stop.x - 2, y: STREET_YB - 2, w: 5, h: 3 });
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

  // ---- cars: the street's own transit. A trip to a district that is further along than the next one rides a car between curb stops
  connectors.push(...cyberCarConnectors());

  const lamps: Point[] = [5, 15, 25, 35, 45, 55, 65, 75].map((x) => ({ x, y: STREET_YB - 3 }));
  const entrance = { x: 2, y: STREET_YB - 1 };
  const transit = createTransitNetwork({ w: grid.w, h: grid.h, cost: grid.cost }, connectors, { districts: CYBER_DISTRICT_MODEL });
  return {
    ground: groundFrom(grid),
    height: new Float32Array(grid.w * grid.h),
    grid: { w: grid.w, h: grid.h, cost: grid.cost },
    buildings, stations, props, homes, lamps, entrance,
    posts: CYBER_POSTS.map((p) => ({ ...p.tile })), postExclusions: cyberPostExclusions(),
    transit, skin: 'cyber-city', regions,
  };
}
