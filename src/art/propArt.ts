import type { PropKind } from '../world/map';

/**
 * Which sprite draws each placed prop. Data only, so the renderer and the
 * map validation read the same table: a map that places a prop with no entry
 * here is rejected before it can reach the scene.
 */
export type PropArtSource = 'tree' | 'bush' | 'prop' | 'furniture' | 'equipment';

export interface PropArtSpec {
  /** Texture key suffix: the scene registers `art-${key}`. */
  key: string;
  source: PropArtSource;
  index: number;
  w: number;
  h: number;
}

export const TREE_VARIANT_COUNT = 6;

const spec = (key: string, source: PropArtSource, index: number, w = 0, h = 0): PropArtSpec => ({ key, source, index, w, h });

export const PROP_ART: readonly PropArtSpec[] = [
  ...Array.from({ length: TREE_VARIANT_COUNT }, (_, i) => spec(`tree${i}`, 'tree', i)),
  spec('bush', 'bush', 0),
  spec('fountain', 'prop', 0, 82, 78), spec('chapel', 'prop', 1, 76, 80),
  spec('marketStall0', 'prop', 2, 54, 46), spec('marketStall1', 'prop', 3, 54, 46),
  spec('bridge', 'prop', 4, 70, 35), spec('rock', 'prop', 5, 25, 18),
  spec('lamp', 'prop', 6, 11, 35), spec('cart', 'prop', 7, 32, 23),
  spec('bench', 'furniture', 0, 24, 16), spec('porchBench', 'furniture', 0, 18, 12),
  spec('flowerBox', 'furniture', 1, 25, 16), spec('planter', 'furniture', 1, 22, 15),
  spec('barrel', 'furniture', 2, 16, 15), spec('crate', 'furniture', 3, 18, 17),
  spec('noticeBoard', 'furniture', 4, 26, 30), spec('signpost', 'furniture', 5, 19, 27),
  spec('grave0', 'furniture', 6, 17, 22), spec('grave1', 'furniture', 7, 15, 23), spec('grave2', 'furniture', 6, 14, 19),
  spec('banner', 'furniture', 15, 17, 35),
  spec('anvil', 'equipment', 0, 19, 17), spec('workbench', 'equipment', 1, 25, 18), spec('lectern', 'equipment', 2, 17, 21),
  spec('telescope', 'equipment', 3, 23, 27), spec('postbox', 'equipment', 4, 13, 21), spec('desk', 'equipment', 5, 24, 18),
  spec('stall', 'equipment', 6, 24, 17),
  spec('hedge', 'bush', 0), spec('dock', 'prop', 4, 30, 18),
];

const KEYS = new Set(PROP_ART.map((s) => s.key));

/** The texture key suffix for a placed prop. */
export function propArtKey(kind: PropKind, variant: number): string {
  if (kind === 'tree') return `tree${variant % TREE_VARIANT_COUNT}`;
  return kind;
}

export const hasPropArt = (kind: PropKind, variant = 0): boolean => KEYS.has(propArtKey(kind, variant));
