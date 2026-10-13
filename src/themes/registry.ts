import { CLASSIC } from './classic';
import { MAP_PRESETS } from './maps';
import { NIGHT_MARKET } from './nightMarket';
import { PEOPLE_KITS, TOWNSFOLK } from './people';
import type { MapPreset, PeopleKit, TownTheme } from './types';

/**
 * Registered themes. Adding a theme is adding an entry here; no renderer,
 * HUD or simulation code branches on a theme id. `CLASSIC` is the default and
 * the fallback for anything unknown.
 */
export const THEMES: readonly TownTheme[] = [CLASSIC, NIGHT_MARKET];
export const DEFAULT_THEME_ID = CLASSIC.id;
export const MAPS: readonly MapPreset[] = MAP_PRESETS;
export const KITS: readonly PeopleKit[] = PEOPLE_KITS;

export const themeIds = (): string[] => THEMES.map((t) => t.id);
export const mapIds = (): string[] => MAPS.map((m) => m.id);
export const kitIds = (): string[] => KITS.map((k) => k.id);

export const findTheme = (id: string): TownTheme | undefined => THEMES.find((t) => t.id === id);
export const findMap = (id: string): MapPreset | undefined => MAPS.find((m) => m.id === id);
export const findKit = (id: string): PeopleKit | undefined => KITS.find((k) => k.id === id);

/** Always returns a theme: an unknown id falls back to Classic. */
export function themeOrDefault(id: string | null | undefined): TownTheme {
  return (id ? findTheme(id) : undefined) ?? CLASSIC;
}

/** Maps a theme can host, in registry order. */
export function compatibleMaps(theme: TownTheme): MapPreset[] {
  return theme.maps.compatible.map((id) => findMap(id)).filter((m): m is MapPreset => m !== undefined);
}

export { TOWNSFOLK };
