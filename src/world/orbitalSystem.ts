import { TILE } from '../art/tiles';
import type { Place } from '../sim/toolMap';
import type { Building, Prop, Station, TownMap, WorldRegion } from './map';
import { propFooted, WorldGrid, addStation, groundFrom, makeBuilding } from './worldKit';
import type { Point } from './pathfind';
import { createTransitNetwork, type TransitConnector } from './transit';

/**
 * Orbital System: a bounded orbital diorama.
 *
 * Residents walk only on authored local regions: the decks and spines of Helios
 * Station, the surface of Mercury Lab, the surface of Forge Moon and the habitat
 * of Relay Garden. Everything between them is empty space and is blocked, and
 * the sun is a decoration that nothing can walk on. The only way from one body
 * to another is a shuttle: walk to the dock, board, fly the authored curve,
 * land at the other dock, walk to the station. Helios is the hub: a trip
 * between two outer bodies is two shuttle hops through the station.
 */

export const ORBIT_W = 84;
export const ORBIT_H = 50;

export interface Body { id: string; name: string; kind: 'body' | 'deck'; x: number; y: number; w: number; h: number; shape: 'rect' | 'disk' }

/** The sun: decoration at the corner of the composition, never walkable. */
export const SUN: Body = { id: 'sun', name: 'Sol', kind: 'body', x: -9, y: -9, w: 24, h: 24, shape: 'disk' };
export const MERCURY: Body = { id: 'mercury', name: 'Mercury Lab', kind: 'body', x: 3, y: 24, w: 19, h: 19, shape: 'disk' };
export const FORGE_MOON: Body = { id: 'forge-moon', name: 'Forge Moon', kind: 'body', x: 64, y: 26, w: 18, h: 18, shape: 'disk' };
export const RELAY_GARDEN: Body = { id: 'relay-garden', name: 'Relay Garden', kind: 'body', x: 66, y: 3, w: 15, h: 15, shape: 'disk' };

/** Helios Station modules: three decks joined by two spines. */
export const HELIOS = {
  top: { id: 'helios-top', x: 27, y: 15, w: 31, h: 3 },
  spineA: { id: 'helios-spine-a', x: 41, y: 18, w: 3, h: 8 },
  mid: { id: 'helios-mid', x: 27, y: 26, w: 31, h: 3 },
  spineB: { id: 'helios-spine-b', x: 41, y: 29, w: 3, h: 6 },
  low: { id: 'helios-low', x: 27, y: 35, w: 31, h: 3 },
} as const;

/** Docks: the boarding tile on each side of every shuttle route. */
export const DOCKS = {
  heliosMercury: { x: 27, y: 27 }, mercuryHelios: { x: 19, y: 34 },
  heliosForge: { x: 57, y: 36 }, forgeHelios: { x: 66, y: 35 },
  heliosRelay: { x: 57, y: 16 }, relayHelios: { x: 68, y: 10 },
} as const;

export function buildOrbitalSystemMap(): TownMap {
  const grid = new WorldGrid(ORBIT_W, ORBIT_H);
  const regions: WorldRegion[] = [{ id: SUN.id, label: SUN.name, kind: 'sun', x: SUN.x, y: SUN.y, w: SUN.w, h: SUN.h, shape: 'disk' }];
  const buildings: Building[] = [];
  const homes: Building[] = [];
  const stations: Station[] = [];
  const props: Prop[] = [];
  const connectors: TransitConnector[] = [];

  // ---- local surfaces: nothing outside these is walkable
  for (const b of [MERCURY, FORGE_MOON, RELAY_GARDEN]) {
    grid.carveDisk(b.x, b.y, b.w, b.h);
    regions.push({ id: b.id, label: b.name, kind: 'body', x: b.x, y: b.y, w: b.w, h: b.h, shape: 'disk' });
  }
  for (const d of Object.values(HELIOS)) {
    grid.carve(d.x, d.y, d.w, d.h);
    regions.push({ id: d.id, label: 'Helios Station', kind: 'deck', x: d.x, y: d.y, w: d.w, h: d.h, shape: 'rect' });
  }

  // ---- buildings: modules and domes. They are never walkable; a station stands in front of one.
  const room = (id: Place, x: number, y: number, w: number, h: number, label: string, doorX: number) => {
    const b = makeBuilding(id, id, x, y, w, h, label, { x: doorX, y: y + h });
    buildings.push(b);
    grid.blockRect(x, y, w, h);
  };
  const stand = (place: Place, xs: number[], y: number, kind: Parameters<typeof addStation>[6]) => {
    for (const x of xs) addStation(grid, stations, props, place, { x, y }, 'up', kind);
  };

  // Helios Station: command ring and relay module on the top deck, the crew lounge on the middle deck.
  room('hall', 29, 9, 11, 6, 'Town hall', 34);
  room('post', 45, 9, 11, 6, 'Post office', 50);
  room('tavern', 45, 20, 11, 6, 'Tavern', 50);
  stand('hall', [30, 32, 36, 38], 16, 'commandConsole');
  stand('post', [46, 52, 54], 16, 'dispatchDock');
  stand('tavern', [46, 48, 52, 54, 56], 27, 'loungeSeat');

  // Mercury Lab: the archive dome above the observatory ridge.
  room('library', 6, 27, 9, 5, 'Library', 10);
  room('observatory', 7, 37, 7, 3, 'Observatory', 10);
  stand('library', [7, 8, 12, 13], 33, 'terminal');
  stand('observatory', [8, 12, 13], 41, 'scopeArray');

  // Forge Moon: the fabrication bay over the foundry crater.
  room('workshop', 68, 28, 8, 4, 'Workshop', 72);
  room('forge', 68, 38, 8, 3, 'Forge', 72);
  stand('workshop', [69, 70, 74, 75], 33, 'fabBay');
  stand('forge', [69, 70, 74, 75], 42, 'foundryRig');

  // Relay Garden: the exchange habitat, six kiosks in two rows.
  stand('market', [70, 73, 76], 8, 'kiosk');
  stand('market', [70, 73, 76], 13, 'kiosk');

  // ---- crew quarters: pods on Helios Station, each with a door and two porch tiles
  const podAt = (x: number, y: number, doorRow: number) => {
    const id = `home-${homes.length}`;
    homes.push(makeBuilding(id, 'house', x, y, 4, 4, `Crew pod ${homes.length + 1}`, { x: x + 2, y: doorRow }, [{ x, y: doorRow }, { x: x + 3, y: doorRow }]));
    grid.blockRect(x, y, 4, 4);
  };
  podAt(29, 22, 26);
  for (const x of [27, 31, 35, 45, 49, 53]) podAt(x, 31, 35);

  // ---- bulletin board on the command deck
  props.push(propFooted('noticeBoard', 42, 15 * TILE + 6, []));
  grid.block(42, 15);

  // ---- shuttles: Helios is the hub, one route to each outer body, in both directions
  const route = (id: string, a: Point, aRegion: string, b: Point, bRegion: string, control: Point, durationMs: number) => {
    for (const [from, fromR, to, toR, key] of [[a, aRegion, b, bRegion, 'out'], [b, bRegion, a, aRegion, 'back']] as const) {
      connectors.push({
        id: `shuttle-${id}-${key}`, kind: 'shuttle', fromRegion: fromR, toRegion: toR,
        boarding: from, exit: to, durationMs,
        visual: { kind: 'shuttle', from: fromR, to: toR, control: { x: control.x * TILE, y: control.y * TILE } },
      });
    }
  };
  route('mercury', DOCKS.heliosMercury, 'helios', DOCKS.mercuryHelios, 'mercury', { x: 23.5, y: 38 }, 3200);
  route('forge', DOCKS.heliosForge, 'helios', DOCKS.forgeHelios, 'forge-moon', { x: 62, y: 41 }, 3200);
  route('relay', DOCKS.heliosRelay, 'helios', DOCKS.relayHelios, 'relay-garden', { x: 61, y: 5 }, 3600);

  const lamps: Point[] = [{ x: 29, y: 13 }, { x: 55, y: 13 }, { x: 33, y: 24 }, { x: 55, y: 33 }, { x: 33, y: 33 }, { x: 11, y: 31 }];
  const entrance = { x: 28, y: 16 };
  const transit = createTransitNetwork({ w: grid.w, h: grid.h, cost: grid.cost }, connectors);
  return {
    ground: groundFrom(grid),
    height: new Float32Array(grid.w * grid.h),
    grid: { w: grid.w, h: grid.h, cost: grid.cost },
    buildings, stations, props, homes, lamps, entrance,
    transit, skin: 'orbital-system', regions, vacuum: true,
  };
}
