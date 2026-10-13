import { buildTownMap } from '../world/map';
import type { MapPreset, MapView } from './types';

/** The overview framing the original town has always used. */
const TOWN_VIEW: MapView = { centerX: 52, centerY: 40, fitW: 90, fitH: 50 };

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
    description: 'The same streets and buildings, with groves and countryside laid out differently.',
    build: () => buildTownMap(1),
    view: TOWN_VIEW,
  },
];
