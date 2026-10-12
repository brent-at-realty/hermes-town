/**
 * Profile clothing colours for a shared Town.
 *
 * Self-contained on purpose (no imports): the verification script transpiles
 * this file on its own and compares it with the server's slot allocation.
 *
 * The server decides the slot (see `allocateSlots` in server/lib/profiles.mjs)
 * and sends it as `paletteSlot`, so two registered profiles never share a
 * colour while the palette lasts. A resident that arrives without a slot (a
 * journal from before the registry assigned one, say) falls back to the slot
 * its name hashes to, which is the same number the server prefers.
 */

export interface ProfileColor {
  /** Index into {@link PROFILE_PALETTE}. */
  slot: number;
  /** Human word for the legend. */
  name: string;
  /** Clothing colour. */
  cloth: string;
}

/**
 * Twelve clothing colours, ordered so that neighbouring slots differ in hue.
 * The verification script enforces a minimum perceptual distance between every
 * pair, so a new entry cannot quietly look like an old one.
 */
export const PROFILE_PALETTE: readonly { name: string; cloth: string }[] = [
  { name: 'red', cloth: '#c0392b' },
  { name: 'blue', cloth: '#2e6fd0' },
  { name: 'green', cloth: '#2fa35a' },
  { name: 'gold', cloth: '#e0a81e' },
  { name: 'purple', cloth: '#8e44ad' },
  { name: 'teal', cloth: '#17a2a2' },
  { name: 'orange', cloth: '#e67e22' },
  { name: 'pink', cloth: '#e0609a' },
  { name: 'lime', cloth: '#9ccc3c' },
  { name: 'sky', cloth: '#6cc4f0' },
  { name: 'cream', cloth: '#e8e2d0' },
  { name: 'ink', cloth: '#2b2d3a' },
];

/** Same label the server accepts: the Hermes profile directory name. */
export const PROFILE_LABEL = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** FNV-1a, identical to `hashString` in painter.ts and `fnv1a` in server/lib/contract.mjs. */
export function profileHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The colour for a profile, or null when the resident has no profile (single
 * profile Town, demo mode), in which case the role-based look is untouched.
 */
export function profileColorFor(profile: string | null | undefined, slot?: number | null): ProfileColor | null {
  if (typeof profile !== 'string' || !PROFILE_LABEL.test(profile)) return null;
  const size = PROFILE_PALETTE.length;
  const index = typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 ? slot % size : profileHash(profile) % size;
  const entry = PROFILE_PALETTE[index]!;
  return { slot: index, name: entry.name, cloth: entry.cloth };
}
