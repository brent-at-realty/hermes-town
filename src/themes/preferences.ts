import { MOTION_OPTIONS, TIME_OPTIONS, WEATHER_OPTIONS } from './environment';
import { kitIds, mapIds, themeIds } from './registry';
import type { Choice, MotionChoice, TimeId, WeatherId } from './types';

/**
 * Appearance preferences: one validated shape, three transports.
 *
 *  - stored: `localStorage` under {@link APPEARANCE_STORAGE_KEY}, a versioned JSON object;
 *  - shared: URL query parameters (see {@link CHOICE_KEYS});
 *  - host default: the same query grammar, set by the operator at build time.
 *
 * Every parser is total. Unknown or malformed values are dropped, named in
 * `rejected`, and replaced by the field's default; a bad value can never
 * throw or reach the renderer. This module touches no DOM and no Phaser.
 */

export const APPEARANCE_STORAGE_KEY = 'hermes-town.appearance';
export const APPEARANCE_SCHEMA_VERSION = 1;

/** The query parameters, in the order a share link writes them. */
export const CHOICE_KEYS = ['theme', 'people', 'map', 'time', 'weather', 'motion'] as const;
export type ChoiceKey = (typeof CHOICE_KEYS)[number];

export const FOLLOW_THEME = 'theme';

export const DEFAULT_CHOICE: Readonly<Choice> = {
  theme: 'classic', people: FOLLOW_THEME, map: FOLLOW_THEME, time: FOLLOW_THEME, weather: FOLLOW_THEME, motion: 'system',
};

export interface Parsed {
  choice: Choice;
  /** Keys present in the input whose value was not recognised. */
  rejected: ChoiceKey[];
  /** Whether any appearance key was present at all. */
  present: boolean;
}

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

function allowed(key: ChoiceKey): readonly string[] {
  switch (key) {
    case 'theme': return themeIds();
    case 'people': return [FOLLOW_THEME, ...kitIds()];
    case 'map': return [FOLLOW_THEME, ...mapIds()];
    case 'time': return [FOLLOW_THEME, ...TIME_OPTIONS.map((o) => o.id)];
    case 'weather': return [FOLLOW_THEME, ...WEATHER_OPTIONS.map((o) => o.id)];
    case 'motion': return MOTION_OPTIONS.map((o) => o.id);
  }
}

/** A value for `key`, or undefined when it is not a registered option. */
export function validValue(key: ChoiceKey, value: unknown): string | undefined {
  if (typeof value !== 'string' || !ID.test(value)) return undefined;
  return allowed(key).includes(value) ? value : undefined;
}

/** Parse an untrusted key/value source. Absent keys take defaults; present-but-invalid keys are reported. */
export function parseChoice(read: (key: ChoiceKey) => unknown): Parsed {
  const choice: Choice = { ...DEFAULT_CHOICE } as Choice;
  const rejected: ChoiceKey[] = [];
  let present = false;
  for (const key of CHOICE_KEYS) {
    const raw = read(key);
    if (raw === undefined || raw === null) continue;
    present = true;
    const value = validValue(key, raw);
    if (value === undefined) { rejected.push(key); continue; }
    (choice as unknown as Record<string, string>)[key] = value;
  }
  return { choice, rejected, present };
}

export function parseSearch(search: string | URLSearchParams): Parsed {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return parseChoice((key) => params.get(key));
}

/**
 * The canonical query for a choice: fixed key order, defaults omitted except
 * `theme`, which is always written so a link says what it shows.
 */
export function toSearch(choice: Choice): string {
  const params = new URLSearchParams();
  for (const key of CHOICE_KEYS) {
    const value = choice[key];
    if (key !== 'theme' && value === DEFAULT_CHOICE[key]) continue;
    params.set(key, value);
  }
  return params.toString();
}

/** A share link: the current page with only appearance (and an explicit `agents`) parameters. */
export function shareUrl(choice: Choice, base: { origin: string; pathname: string; agents?: string | null }): string {
  const query = toSearch(choice);
  const agents = base.agents === 'demo' || base.agents === 'live' ? `agents=${base.agents}&` : '';
  return `${base.origin}${base.pathname}?${agents}${query}`;
}

// ------------------------------------------------------------------ storage

export interface StoredAppearance { v: number; theme: string; people: string; map: string; time: string; weather: string; motion: string }

export function serializeStored(choice: Choice): string {
  const stored: StoredAppearance = { v: APPEARANCE_SCHEMA_VERSION, ...choice };
  return JSON.stringify(stored);
}

/** A stored value of another version, or anything unparseable, yields no preference at all. */
export function parseStored(text: string | null | undefined): Parsed | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 2048) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.v !== APPEARANCE_SCHEMA_VERSION) return null;
  return parseChoice((key) => record[key]);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Load a saved view. Storage that throws (private mode, disabled) behaves like an empty store. */
export function loadStored(storage: StorageLike | null): Parsed | null {
  try { return storage ? parseStored(storage.getItem(APPEARANCE_STORAGE_KEY)) : null; } catch { return null; }
}

export function saveStored(storage: StorageLike | null, choice: Choice): boolean {
  try { if (!storage) return false; storage.setItem(APPEARANCE_STORAGE_KEY, serializeStored(choice)); return true; } catch { return false; }
}

export function clearStored(storage: StorageLike | null): boolean {
  try { if (!storage) return false; storage.removeItem(APPEARANCE_STORAGE_KEY); return true; } catch { return false; }
}

// ------------------------------------------------------------ layered source

export type ChoiceSource = 'link' | 'saved' | 'host' | 'default';

export interface Loaded {
  choice: Choice;
  source: ChoiceSource;
  /** URL keys that were not recognised and fell back to their defaults. */
  rejected: ChoiceKey[];
}

/**
 * Precedence: a URL carrying appearance parameters, then the viewer's saved
 * view, then the host's default, then Classic. The URL replaces the whole
 * choice (a share link is complete) and is never written to storage.
 */
export function loadChoice(input: { search: string; storage: StorageLike | null; hostDefault?: string | null }): Loaded {
  const url = parseSearch(input.search);
  if (url.present) return { choice: url.choice, source: 'link', rejected: url.rejected };
  const saved = loadStored(input.storage);
  if (saved) return { choice: saved.choice, source: 'saved', rejected: [] };
  if (input.hostDefault) {
    const host = parseSearch(input.hostDefault);
    if (host.present) return { choice: host.choice, source: 'host', rejected: [] };
  }
  return { choice: { ...DEFAULT_CHOICE } as Choice, source: 'default', rejected: [] };
}

export type { MotionChoice, TimeId, WeatherId };
