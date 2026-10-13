import {
  CHOICE_KEYS, DEFAULT_CHOICE, clearStored, loadChoice, saveStored, shareUrl, toSearch,
  type ChoiceKey, type ChoiceSource, type StorageLike,
} from '../themes/preferences';
import { chooseTheme, resolveAppearance, type ResolvedAppearance } from '../themes/resolve';
import type { Choice } from '../themes/types';

/**
 * The viewer's current appearance. It owns the choice, where it came from, and
 * the three things a viewer can do with it: save it for this browser, share it
 * as a link, or reset it. It performs no rendering and never talks to Hermes
 * or the Town server: appearance is client-side view state.
 */
export interface AppearanceController {
  choice(): Choice;
  resolved(): ResolvedAppearance;
  source(): ChoiceSource;
  /** URL keys that were not recognised on load. */
  rejected(): ChoiceKey[];
  /** Whether this browser holds a saved view. */
  hasSaved(): boolean;
  /** Change one or more fields. Fields not mentioned are kept. */
  update(patch: Partial<Choice>): void;
  selectTheme(id: string): void;
  /** Back to the host default (or Classic), forgetting the saved view and any link parameters. */
  reset(): void;
  /** Persist the current choice for this browser. Returns false when storage is unavailable. */
  save(): boolean;
  link(): string;
  /** Re-resolve against the system motion preference. */
  refresh(): void;
  subscribe(fn: () => void): void;
}

export interface ControllerDeps {
  location: Pick<Location, 'search' | 'origin' | 'pathname'>;
  storage: StorageLike | null;
  hostDefault: string | null;
  systemPrefersReducedMotion(): boolean;
  /** Remove appearance parameters from the address bar, leaving everything else. */
  stripLinkParameters(): void;
}

export function createAppearanceController(deps: ControllerDeps): AppearanceController {
  const loaded = loadChoice({ search: deps.location.search, storage: deps.storage, hostDefault: deps.hostDefault });
  let choice: Choice = loaded.choice;
  let source: ChoiceSource = loaded.source;
  let rejected = loaded.rejected;
  const listeners: (() => void)[] = [];
  const resolve = () => resolveAppearance(choice, { prefersReducedMotion: deps.systemPrefersReducedMotion() });
  let current = resolve();
  const emit = () => { current = resolve(); for (const fn of listeners) fn(); };

  const hostChoice = (): Choice => loadChoice({ search: '', storage: null, hostDefault: deps.hostDefault }).choice;

  return {
    choice: () => choice,
    resolved: () => current,
    source: () => source,
    rejected: () => rejected,
    hasSaved: () => loadChoice({ search: '', storage: deps.storage }).source === 'saved',
    update(patch) { choice = { ...choice, ...patch }; emit(); },
    selectTheme(id) { choice = chooseTheme(choice, id); emit(); },
    reset() {
      clearStored(deps.storage);
      deps.stripLinkParameters();
      choice = hostChoice();
      source = deps.hostDefault ? 'host' : 'default';
      rejected = [];
      emit();
    },
    save() {
      const ok = saveStored(deps.storage, choice);
      if (ok) { deps.stripLinkParameters(); source = 'saved'; rejected = []; }
      emit();
      return ok;
    },
    link: () => shareUrl(choice, { origin: deps.location.origin, pathname: deps.location.pathname, agents: new URLSearchParams(deps.location.search).get('agents') }),
    refresh: emit,
    subscribe(fn) { listeners.push(fn); },
  };
}

/** Remove only the appearance keys from the current address. */
export function stripAppearanceFromAddress(): void {
  const url = new URL(location.href);
  let changed = false;
  for (const key of CHOICE_KEYS) if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
  if (changed) history.replaceState(history.state, '', url);
}

export { DEFAULT_CHOICE, toSearch };
