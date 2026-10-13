import type { Look } from '../art/characters';
import { hashString, shade } from '../art/painter';
import type { PeopleKit } from './types';

export const TOWNSFOLK: PeopleKit = {
  id: 'townsfolk',
  label: 'Townsfolk',
  description: 'The original residents: role clothes, hats and aprons.',
  textureTag: '',
  preview: ['#7a3a2a', '#3f5e7a', '#4f6b3a', '#6b4a7a'],
};

export const MARKET_FOLK: PeopleKit = {
  id: 'market-folk',
  label: 'Market folk',
  description: 'Brimmed hats, long coats and jewel-coloured cloth.',
  textureTag: 'mf',
  hat: 'brim',
  garment: 'coat',
  hair: ['#1c1428', '#4a2a40', '#8a4a2a', '#c9a35a', '#d8d0e8'],
  cloth: ['#7a2a4a', '#2a5a6a', '#6a3a8a', '#9a6a2a', '#2a4a7a', '#8a2a2a'],
  pants: ['#2a2040', '#3a2a50', '#2a2a3a'],
  preview: ['#7a2a4a', '#2a5a6a', '#6a3a8a', '#9a6a2a'],
};

export const PLAINCLOTHES: PeopleKit = {
  id: 'plainclothes',
  label: 'Plain clothes',
  description: 'Bare-headed and unadorned: the quietest way to read a crowd.',
  textureTag: 'pc',
  hat: 'none',
  garment: 'tunic',
  apron: false,
  beard: false,
  cloth: ['#6a6a72', '#58606a', '#6a6258', '#585868'],
  preview: ['#6a6a72', '#58606a', '#6a6258', '#585868'],
};

export const PEOPLE_KITS: readonly PeopleKit[] = [TOWNSFOLK, MARKET_FOLK, PLAINCLOTHES];

/**
 * Restyle a look with a kit.
 *
 * The kit never changes who a resident is: the seed is the resident's own
 * look bucket, so the same resident always gets the same kit variant. A
 * profile colour is applied last, so every kit keeps a shared Town legible by
 * profile.
 */
export function applyPeopleKit(look: Look, kit: PeopleKit, seed: string, profileCloth?: string): Look {
  if (kit.textureTag === '') return look;
  const pick = <T,>(list: readonly T[], salt: string): T => list[hashString(`${seed}:${salt}`) % list.length]!;
  const next: Look = { ...look };
  if (kit.hat !== undefined) next.hat = kit.hat;
  if (kit.garment !== undefined) next.garment = kit.garment;
  if (kit.apron !== undefined) next.apron = kit.apron;
  if (kit.beard !== undefined) next.beard = kit.beard;
  if (kit.hair) next.hair = pick(kit.hair, 'hair');
  if (kit.pants) next.pants = pick(kit.pants, 'pants');
  if (kit.cloth) next.cloth = pick(kit.cloth, 'cloth');
  if (profileCloth !== undefined) next.cloth = profileCloth;
  next.cloth2 = shade(next.cloth, 0.72);
  return next;
}
