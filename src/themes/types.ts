/**
 * The Town Appearance contract.
 *
 * A theme is presentation only. Nothing here may change where a resident
 * stands, what it is doing, or which emote it shows: those come from the
 * allowlisted lifecycle events and `src/sim`, never from a theme. This
 * directory must not import Phaser or anything under `src/sim`.
 */

/** HUD, minimap and in-world label colours. Every value is a CSS colour string. */
export interface UiPalette {
  canvasBackground: string;
  page: string;
  text: string;
  textStrong: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  panel: string;
  panelSolid: string;
  panelBorder: string;
  divider: string;
  button: string;
  buttonHover: string;
  buttonBorder: string;
  buttonOn: string;
  buttonOnBorder: string;
  statusOk: string;
  statusDemo: string;
  statusBad: string;
  focus: string;
  /** Minimap ground classes. */
  minimap: {
    background: string;
    water: string; cobble: string; path: string; trail: string;
    grassDry: string; grassWet: string; ledge: string; grass: string;
    tree: string; house: string; building: string;
    dot: string; dotChild: string; dotSelected: string; viewport: string;
  };
  /** Colours of text drawn inside the world (name tags, labels, bubbles). */
  scene: {
    label: string; labelBackground: string;
    stallLabel: string;
    name: string; nameSelected: string; nameRunner: string; nameScheduled: string; nameChild: string; nameMemory: string;
    bubbleText: string; bubbleFill: number; bubbleStroke: number;
  };
}

export type TimeId = 'auto' | 'morning' | 'noon' | 'evening' | 'night';
export type WeatherId = 'clear' | 'mist' | 'rain';
export type MotionChoice = 'system' | 'reduced' | 'full';

/** Declarative lighting, wind, water, cloud, haze and decorative-particle profile. */
export interface EnvironmentProfile {
  /** Default time of day when the viewer leaves it on "follow theme". */
  time: TimeId;
  weather: WeatherId;
  /** The overall colour grade over the world. */
  grade: { multiplyColor: number; multiplyAlpha: number; addColor: number; addAlpha: number };
  /** Night colours: the warm end of dusk and the cold end of deep night. */
  night: { warm: number; cold: number; strength: number };
  /** Multiplier for lamp, window and forge glow. */
  lampGlow: number;
  wind: { sway: number };
  clouds: { count: number; alpha: number; drift: number };
  haze: { color: [number, number, number]; alpha: number };
  /** Decorative water: the fountain spray. */
  fountain: boolean;
  /** Decorative chimney smoke that trickles regardless of work. */
  idleSmoke: boolean;
  /** Slow decorative motes (fireflies, lantern dust). Never tied to a resident. */
  motes: { count: number; color: number; alpha: number } | null;
}

/** Art variants the renderer applies to the shared atlas. */
export interface ThemeArt {
  /** Multiplied into the terrain and structure layers. 0xffffff leaves them alone. */
  worldTint: number;
  buildingTint: number;
  /** Cycled over tree sprites by position. */
  treeTints: readonly number[];
  /** Strength of the soft shadows under buildings and props, 0..1. */
  shadow: number;
}

/** A theme that ships as a complete, coherent pack: its own map, people and environment. */
export interface ThemePack {
  /** One line on what the pack changes. */
  summary: string;
  /** What the pack's map transit is, in plain words. It is shown whenever the map is chosen. */
  routeNote: string;
}

export interface TownTheme {
  id: string;
  label: string;
  description: string;
  /** Swatches for the preview card. */
  preview: readonly string[];
  ui: UiPalette;
  /** Default people kit id. */
  people: string;
  maps: { default: string; compatible: readonly string[] };
  art: ThemeArt;
  environment: EnvironmentProfile;
  /** Present for a theme that has a one-click complete pack (theme, recommended people, map and environment together). */
  pack?: ThemePack;
}

/**
 * A resident visual kit. It restyles the procedural figure; the resident's
 * identity hash stays the same and a profile colour always wins over the kit's
 * own clothing palette, so a shared Town still reads by profile.
 */
export interface PeopleKit {
  id: string;
  label: string;
  description: string;
  /** Part of sprite-sheet cache keys. Empty for the original look. */
  textureTag: string;
  hat?: 'none' | 'cap' | 'hood' | 'band' | 'brim' | 'goggles' | 'visor' | 'helmet';
  hair?: readonly string[];
  cloth?: readonly string[];
  pants?: readonly string[];
  garment?: 'jacket' | 'tunic' | 'coat';
  apron?: boolean;
  beard?: boolean;
  /** Collar, lapel, hem and hat-band colour. It never replaces the body colour, so a profile colour still reads. */
  trim?: string;
  /** Colour of the brimmed hat. */
  hatColor?: string;
  /** Colour of a feather in the hat. */
  plume?: string;
  /** Draw the satchel strap (default) or leave it off. */
  satchel?: boolean;
  /** Draw the belt (default) or leave it off. */
  belt?: boolean;
  /** Hair style for every resident in the kit. Absent keeps each resident's own. */
  hairStyle?: 'short' | 'long' | 'bun' | 'bald' | 'mohawk';
  /** A baldric worn shoulder to hip, in an accent colour. Edged in the hat colour. */
  sash?: string;
  /** A band along the coat hem. */
  hemBand?: string;
  /** Colour of the sleeves, when they differ from the body: shirt sleeves under a coloured tunic. */
  sleeve?: string;
  /**
   * A whole-figure silhouette: 'operative' is a long coat with a high collar, shoulder panels and a visor;
   * 'crew' is a pressure suit with a round helmet and a back unit. Absent keeps the original build.
   */
  style?: 'operative' | 'crew';
  /** The shell colour of a styled figure: the coat or suit that the profile colour is worn on. */
  shell?: string;
  /** A second accent colour of a styled figure (belt lights, helmet ring, boots). */
  accent?: string;
  /** Preview swatches. */
  preview: readonly string[];
}

export interface MapView {
  /** Where the overview camera is centred, in tiles. */
  centerX: number;
  centerY: number;
  /** The span in tiles the overview must fit. */
  fitW: number;
  fitH: number;
}

import type { TerrainStyle } from '../art/terrain';

export interface MapPreset {
  id: string;
  label: string;
  description: string;
  build(): import('../world/map').TownMap;
  view: MapView;
  /**
   * Optional colour multiplier folded into the terrain and tree tints on top of
   * the theme's own. 0xffffff (or absent) leaves them alone. It is what makes a
   * map's own character (greener, drier) readable at a glance.
   */
  tone?: number;
  /**
   * Minimap colours that replace the theme's for this map only, so the minimap
   * shows the map's own character (its lakes, meadows and groves) and agrees
   * with the main canvas. `meadow` colours flower tiles, which the theme
   * palette has no class for.
   */
  minimap?: MinimapTone;
  /** How the ground is painted: base colours and meadow dressing. Absent paints the original town's ground. */
  terrain?: TerrainStyle;
  /** Wording for the weather choices on this map. The stored values stay clear, mist and rain: only the labels change. */
  atmosphere?: 'orbit';
  /** Shown when this map is chosen: what its lifts or shuttles are, and what they are not. */
  routeNote?: string;
}

export type MinimapTone = Partial<UiPalette['minimap']> & { meadow?: string };

export interface Choice {
  /** Theme id. */
  theme: string;
  /** People kit id, or 'theme' to follow the theme. */
  people: string;
  /** Map id, or 'theme' to follow the theme. */
  map: string;
  time: TimeId | 'theme';
  weather: WeatherId | 'theme';
  motion: MotionChoice;
}
