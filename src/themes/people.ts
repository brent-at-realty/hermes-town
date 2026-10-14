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
  description: 'Plumed brimmed hats, long coats with gold and crimson edging, and a bright sash.',
  textureTag: 'mf',
  hat: 'brim',
  garment: 'coat',
  trim: '#d9b34a',
  hatColor: '#3a2548',
  plume: '#d6456a',
  sash: '#e9c24f',
  hemBand: '#b0304f',
  satchel: false,
  hair: ['#1c1428', '#4a2a40', '#8a4a2a', '#c9a35a', '#d8d0e8'],
  cloth: ['#7a2a4a', '#2a5a6a', '#6a3a8a', '#9a6a2a', '#2a4a7a', '#8a2a2a'],
  pants: ['#2a2040', '#3a2a50', '#2a2a3a'],
  preview: ['#7a2a4a', '#2a5a6a', '#6a3a8a', '#9a6a2a'],
};

export const PLAINCLOTHES: PeopleKit = {
  id: 'plainclothes',
  label: 'Plain clothes',
  description: 'Bare-headed, short hair, a coloured tunic over linen sleeves, pale trousers: no hats, aprons, belts or satchels.',
  textureTag: 'pc',
  hat: 'none',
  hairStyle: 'short',
  garment: 'jacket',
  apron: false,
  beard: false,
  satchel: false,
  belt: false,
  trim: '#e6dcc4',
  sleeve: '#e6dcc4',
  hair: ['#3a2c24', '#4a3a2e', '#5a4a3a'],
  pants: ['#a8a294'],
  cloth: ['#6a6a72', '#58606a', '#6a6258', '#585868'],
  preview: ['#6a6a72', '#58606a', '#6a6258', '#585868'],
};

/**
 * Cyber City: tall, wide-hemmed technical coats with a high collar, broad shoulder panels and a glowing visor.
 * The coat is a dark shell; the profile colour is the chest stripe, both shoulder panels, the visor glow and the
 * hip bag, so it is the loudest colour on the figure at the overview scale.
 */
export const NEON_OPERATIVES: PeopleKit = {
  id: 'neon-operatives',
  label: 'Neon operatives',
  description: 'Long technical coats, high collars, shoulder panels and a glowing visor. The profile colour is the chest stripe, shoulders, visor and bag.',
  textureTag: 'no',
  style: 'operative',
  hat: 'visor',
  garment: 'coat',
  apron: false,
  beard: false,
  belt: false,
  satchel: false,
  shell: '#1a2036',
  sleeve: '#232b46',
  accent: '#35e6ff',
  trim: '#35e6ff',
  hair: ['#10121c', '#3a1f5a', '#0d6a7a', '#5a1f3a', '#c9d3e6'],
  cloth: ['#ff3fa4', '#35e6ff', '#ffd36b', '#8a5cff', '#3dff9a'],
  pants: ['#10131f', '#151a2a'],
  preview: ['#1a2036', '#35e6ff', '#ff3fa4', '#ffd36b'],
};

/**
 * Orbital System: pressure suits with a round helmet and a back unit. The suit is pale; the profile colour is the
 * broad chest panel, the helmet ring, the shoulder patches and the call-sign stripe.
 */
export const ORBITAL_CREW: PeopleKit = {
  id: 'orbital-crew',
  label: 'Orbital crew',
  description: 'Pale pressure suits, a round helmet with a dark visor and a back unit. The profile colour is the chest panel, helmet ring, shoulder patches and call-sign stripe.',
  textureTag: 'oc',
  style: 'crew',
  hat: 'helmet',
  garment: 'jacket',
  apron: false,
  beard: false,
  belt: false,
  satchel: false,
  shell: '#dfe5ee',
  sleeve: '#cbd3e0',
  accent: '#ffb347',
  trim: '#9aa6bb',
  hair: ['#2a2230'],
  cloth: ['#ff7a3a', '#3fa7ff', '#ffd24a', '#6fd07a', '#e05a9a'],
  pants: ['#aab4c4', '#b4bdcc'],
  preview: ['#dfe5ee', '#ff7a3a', '#3fa7ff', '#ffd24a'],
};

export const PEOPLE_KITS: readonly PeopleKit[] = [TOWNSFOLK, MARKET_FOLK, PLAINCLOTHES, NEON_OPERATIVES, ORBITAL_CREW];

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
  if (kit.trim !== undefined) next.trim = kit.trim;
  if (kit.hatColor !== undefined) next.hatColor = kit.hatColor;
  if (kit.plume !== undefined) next.plume = kit.plume;
  if (kit.satchel !== undefined) next.satchel = kit.satchel;
  if (kit.belt !== undefined) next.belt = kit.belt;
  if (kit.hairStyle !== undefined) next.hairStyle = kit.hairStyle;
  if (kit.sash !== undefined) next.sash = kit.sash;
  if (kit.hemBand !== undefined) next.hemBand = kit.hemBand;
  if (kit.sleeve !== undefined) next.sleeve = kit.sleeve;
  if (kit.style !== undefined) next.style = kit.style;
  if (kit.shell !== undefined) next.shell = kit.shell;
  if (kit.accent !== undefined) next.accent = kit.accent;
  if (kit.hair) next.hair = pick(kit.hair, 'hair');
  if (kit.pants) next.pants = pick(kit.pants, 'pants');
  if (kit.cloth) next.cloth = pick(kit.cloth, 'cloth');
  if (profileCloth !== undefined) next.cloth = profileCloth;
  next.cloth2 = shade(next.cloth, 0.72);
  return next;
}
