import type { TownMap } from '../world/map';
import type { Building } from '../world/map';
import { cyberLiftOccluders, paintCyberCity, paintCyberMinimap, paintCyberRoom, paintCyberSky, type LiftOccluder } from './cyberCity';
import { paintOrbitalBodies, paintOrbitalMinimap, paintOrbitalModule, paintOrbitalSky } from './orbitalSystem';

/**
 * A complete painted world: what the renderer draws for a skinned map instead of the countryside, the building
 * sprites and the minimap. A world is local and procedural: nothing is fetched.
 */
export interface WorldArt {
  /** Opaque back layer: sky or starfield. */
  sky: HTMLCanvasElement;
  /** Transparent layer over the sky: towers and street, or the bodies and the station. */
  ground: HTMLCanvasElement;
  /** A room, dome, module or pod, lit or dark. */
  room(b: Building, lit: boolean): HTMLCanvasElement;
  /** One canvas pixel per map tile, for the minimap, over the given background colour. */
  minimap(background: string): HTMLCanvasElement;
  /** Solid pieces of the painted world that must draw over the lift cabins and under every resident. */
  liftOccluders?: LiftOccluder[];
}

/** The minimap base of a skinned world, without painting the whole world. Null for any other map. */
export function paintWorldMinimap(map: TownMap, background: string): HTMLCanvasElement | null {
  if (map.skin === 'cyber-city') return paintCyberMinimap(map, background);
  if (map.skin === 'orbital-system') return paintOrbitalMinimap(map, background);
  return null;
}

export function paintWorld(map: TownMap): WorldArt | null {
  if (map.skin === 'cyber-city') {
    const ground = paintCyberCity(map);
    return { sky: paintCyberSky(), ground, room: paintCyberRoom, minimap: (bg) => paintCyberMinimap(map, bg), liftOccluders: cyberLiftOccluders(ground) };
  }
  if (map.skin === 'orbital-system') {
    return { sky: paintOrbitalSky(map), ground: paintOrbitalBodies(map), room: paintOrbitalModule, minimap: (bg) => paintOrbitalMinimap(map, bg) };
  }
  return null;
}
