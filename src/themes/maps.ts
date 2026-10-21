import { buildCyberCityMap } from '../world/cyberCity';
import { buildGreenwoodMap, buildTownMap } from '../world/map';
import { buildOrbitalSystemMap } from '../world/orbitalSystem';
import type { MapPreset, MapView } from './types';

/** The overview framing the original town has always used. */
const TOWN_VIEW: MapView = { centerX: 52, centerY: 40, fitW: 90, fitH: 50 };

/** Greenwood frames a wider, taller span so the great lake, the orchards, the meadows and the glades are all in the opening view. */
const GREENWOOD_VIEW: MapView = { centerX: 52, centerY: 41, fitW: 98, fitH: 56 };

/** Cyber City and the Orbital System are each authored to fit the opening camera exactly: nothing outside them is drawn. */
const CYBER_VIEW: MapView = { centerX: 42, centerY: 25, fitW: 84, fitH: 50 };
const ORBITAL_VIEW: MapView = { centerX: 42, centerY: 25, fitW: 84, fitH: 50 };

const LIFT_NOTE = 'Residents ride lifts between floors, and a car along the street when a station is further than the next tower. A lift or a car is a visual route for a resident already on its way to a real workstation: it is not a separate Hermes lifecycle signal, and nothing is sent to Hermes.';
const SHUTTLE_NOTE = 'Residents fly shuttles between bodies. The shuttle is a visual route for a resident already on its way to a real workstation: it is not a separate Hermes lifecycle signal, and nothing is sent to Hermes.';

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
    // The ground is painted brighter and bluer-watered, with blossoms on the flower tiles; trees take a spring tone.
    tone: 0xeaffdc,
    terrain: { grass: [102, 140, 56], water: [44, 114, 152], swing: 1.5, meadow: true },
    minimap: { grass: '#6c9c3a', grassWet: '#5d9a3e', grassDry: '#6c9c3a', water: '#3b86b8', tree: '#356f2a', trail: '#9a8a52', meadow: '#c9d86a' },
  },
  {
    id: 'cyber-city',
    label: 'Cyber City',
    description: 'A cutaway high-rise district: Archive, Maker, Operations and Residential towers on a neon street, joined by lifts.',
    build: () => buildCyberCityMap(),
    view: CYBER_VIEW,
    routeNote: LIFT_NOTE,
  },
  {
    id: 'orbital-system',
    label: 'Orbital System',
    description: 'Helios Station, Mercury Lab, Forge Moon and Relay Garden around a sun, joined by shuttles.',
    build: () => buildOrbitalSystemMap(),
    view: ORBITAL_VIEW,
    atmosphere: 'orbit',
    routeNote: SHUTTLE_NOTE,
  },
];
