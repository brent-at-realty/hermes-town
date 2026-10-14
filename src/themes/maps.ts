import { buildGreenwoodMap, buildTownMap } from '../world/map';
import type { MapPreset, MapView } from './types';

/** The overview framing the original town has always used. */
const TOWN_VIEW: MapView = { centerX: 52, centerY: 40, fitW: 90, fitH: 50 };

/** Greenwood frames a slightly wider, taller span so the lake, the orchards and the glade are in the opening view. */
const GREENWOOD_VIEW: MapView = { centerX: 52, centerY: 41, fitW: 96, fitH: 54 };

/**
 * Registered world maps. A map is a factory for the existing `TownMap`
 * contract; the renderer, the simulator and the minimap read that contract and
 * never a map's id. A future harbour or camp is one more entry here (plus the
 * theme `maps.compatible` lists that may use it), validated by
 * `validateRegistry` before it can ship.
 */
export const MAP_PRESETS: readonly MapPreset[] = [
  {
    id: 'town',
    label: 'Town',
    description: 'The original town: library, workshop, forge, post office, observatory, hall and tavern.',
    build: () => buildTownMap(0),
    view: TOWN_VIEW,
  },
  {
    id: 'greenwood',
    label: 'Greenwood',
    description: 'The same streets and buildings, in a greener setting: a broad lake, dense groves, orchards in rows and flower glades.',
    build: () => buildGreenwoodMap(),
    view: GREENWOOD_VIEW,
    tone: 0xd6f0d2,
  },
];
