import { resolveEnvironment, resolveReducedMotion, type ResolvedEnvironment } from './environment';
import { compatibleMaps, findKit, findMap, themeOrDefault, TOWNSFOLK } from './registry';
import type { Choice, MapPreset, PeopleKit, ThemeArt, TownTheme, UiPalette } from './types';

/** A choice with every reference resolved against the registries. Nothing here is a string id to look up again. */
export interface ResolvedAppearance {
  /** The normalised choice: fallbacks applied, `theme` sentinels kept. */
  choice: Choice;
  theme: TownTheme;
  ui: UiPalette;
  art: ThemeArt;
  people: PeopleKit;
  map: MapPreset;
  environment: ResolvedEnvironment;
  /** Human-readable notes for each value that had to fall back. */
  notes: string[];
}

export interface SystemPreferences { prefersReducedMotion: boolean }

/**
 * Resolve a choice. Total: unknown ids fall back (theme to Classic, people and
 * map to the theme's own, time and weather to the theme's), and a map the
 * theme does not list as compatible falls back to the theme's default map.
 */
export function resolveAppearance(choice: Choice, system: SystemPreferences): ResolvedAppearance {
  const notes: string[] = [];
  const theme = themeOrDefault(choice.theme);
  if (theme.id !== choice.theme) notes.push(`Unknown theme "${choice.theme}"; using ${theme.label}.`);

  let people = choice.people === 'theme' ? undefined : findKit(choice.people);
  if (choice.people !== 'theme' && !people) notes.push(`Unknown people kit "${choice.people}"; using the theme's.`);
  people ??= findKit(theme.people) ?? TOWNSFOLK;

  const compatible = compatibleMaps(theme);
  let map = choice.map === 'theme' ? undefined : findMap(choice.map);
  if (choice.map !== 'theme' && !map) notes.push(`Unknown map "${choice.map}"; using the theme's.`);
  if (map && !compatible.some((m) => m.id === map!.id)) {
    notes.push(`${map.label} is not available with ${theme.label}; using the theme's map.`);
    map = undefined;
  }
  map ??= findMap(theme.maps.default) ?? compatible[0]!;

  const reduced = resolveReducedMotion(choice.motion, system.prefersReducedMotion);
  const environment = resolveEnvironment(theme.environment, choice.time, choice.weather, reduced);

  const normalised: Choice = {
    theme: theme.id,
    people: choice.people !== 'theme' && findKit(choice.people) ? choice.people : 'theme',
    map: choice.map !== 'theme' && map.id === choice.map ? choice.map : 'theme',
    time: choice.time,
    weather: choice.weather,
    motion: choice.motion,
  };
  return { choice: normalised, theme, ui: theme.ui, art: theme.art, people, map, environment, notes };
}

/** The choice that results from selecting a theme card: the theme brings its own people, map, time and weather. */
export function chooseTheme(current: Choice, themeId: string): Choice {
  return { theme: themeOrDefault(themeId).id, people: 'theme', map: 'theme', time: 'theme', weather: 'theme', motion: current.motion };
}
