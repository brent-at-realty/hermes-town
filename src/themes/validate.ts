import { hasPropArt } from '../art/propArt';
import { PLACE_LABEL, type Place } from '../sim/toolMap';
import { hasWorldSprite } from '../world/dressing';
import { findPath } from '../world/pathfind';
import type { TownMap } from '../world/map';
import { compatibleMaps, DEFAULT_THEME_ID, findKit, findMap, KITS, MAPS, THEMES } from './registry';
import type { MapPreset, TownTheme, UiPalette } from './types';

/**
 * Structural validation for everything the registries hold. Run by
 * `tests/verify-themes.mjs` (part of `npm run test:contracts`), so a theme or
 * map that breaks the contract fails the build gate rather than the viewer.
 * Returns problems as strings; an empty list is a pass.
 */

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CSS_COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+|1\.0)\s*)?\))$/i;

const isColour = (value: unknown): value is string => typeof value === 'string' && CSS_COLOUR.test(value);

function checkPalette(prefix: string, node: unknown, out: string[]): void {
  if (typeof node === 'string') { if (!isColour(node)) out.push(`${prefix}: "${node}" is not a plain CSS colour (no urls, no functions beyond rgb/rgba)`); return; }
  if (typeof node === 'number') return;
  if (typeof node === 'object' && node !== null) for (const [k, v] of Object.entries(node)) checkPalette(`${prefix}.${k}`, v, out);
}

export function validateTheme(theme: TownTheme): string[] {
  const out: string[] = [];
  const at = (m: string) => out.push(`theme ${theme.id}: ${m}`);
  if (!ID.test(theme.id)) at('id must be lowercase letters, digits and dashes');
  if (!theme.label.trim() || !theme.description.trim()) at('needs a label and description');
  if (theme.preview.length === 0 || !theme.preview.every(isColour)) at('preview swatches must be plain colours');
  checkPalette(`theme ${theme.id}.ui`, theme.ui as UiPalette, out);
  if (!findKit(theme.people)) at(`people kit "${theme.people}" is not registered`);
  if (!findMap(theme.maps.default)) at(`default map "${theme.maps.default}" is not registered`);
  if (!theme.maps.compatible.includes(theme.maps.default)) at('default map must be in the compatible list');
  for (const id of theme.maps.compatible) if (!findMap(id)) at(`compatible map "${id}" is not registered`);
  const e = theme.environment;
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  if (![e.grade.multiplyAlpha, e.grade.addAlpha, e.haze.alpha, e.clouds.alpha, e.night.strength].every(unit)) at('environment alphas must be between 0 and 1');
  if (![e.lampGlow, e.wind.sway, e.clouds.drift].every((n) => Number.isFinite(n) && n >= 0 && n <= 4)) at('environment multipliers must be between 0 and 4');
  if (!Number.isInteger(e.clouds.count) || e.clouds.count < 0 || e.clouds.count > 24) at('cloud count must be an integer from 0 to 24');
  if (e.motes && (!Number.isInteger(e.motes.count) || e.motes.count < 0 || e.motes.count > 120 || !unit(e.motes.alpha))) at('motes must be 0-120 and alpha 0-1');
  if (theme.art.treeTints.length === 0) at('treeTints must not be empty');
  // No theme may reference a remote or arbitrary asset.
  const serialised = JSON.stringify(theme);
  if (/https?:|\/\/|url\(|data:|\.\.\//i.test(serialised)) at('themes may not reference urls, data uris or relative paths');
  return out;
}

export function validateMap(map: TownMap, preset: Pick<MapPreset, 'id' | 'view'>): string[] {
  const out: string[] = [];
  const at = (m: string) => out.push(`map ${preset.id}: ${m}`);
  const { w, h, cost } = map.grid;
  if (!(w > 0 && h > 0) || cost.length !== w * h) at('grid size does not match its cost array');
  if (map.ground.length !== h || map.ground.some((row) => row.length !== w)) at('ground is not the same size as the grid');
  if (map.height.length !== w * h) at('height field is not the same size as the grid');
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const walkable = (x: number, y: number) => inGrid(x, y) && cost[y * w + x] !== 0;
  if (!walkable(map.entrance.x, map.entrance.y)) at('entrance is not walkable');
  const v = preset.view;
  if (!(v.fitW > 0 && v.fitH > 0 && v.centerX >= 0 && v.centerY >= 0 && v.centerX <= w && v.centerY <= h)) at('camera view lies outside the map');
  if (map.homes.length === 0) at('needs at least one home');

  const buildings = [...map.buildings, ...map.homes];
  const ids = new Set<string>();
  for (const b of buildings) {
    if (ids.has(b.id)) at(`duplicate building id ${b.id}`);
    ids.add(b.id);
    if (!inGrid(b.x, b.y) || !inGrid(b.x + b.w - 1, b.y + b.h - 1)) at(`building ${b.id} leaves the map`);
  }
  const targets = [
    ...map.stations.map((s) => ({ id: `station ${s.id}`, tile: s.tile })),
    ...buildings.flatMap((b) => [{ id: `door ${b.id}`, tile: b.door }, ...b.porch.map((tile, i) => ({ id: `porch ${b.id}#${i}`, tile }))]),
  ];
  for (const t of targets) if (!findPath(map.grid, map.entrance, t.tile)) at(`${t.id} is not reachable from the entrance`);
  for (const s of map.stations) {
    if (buildings.some((b) => s.tile.x >= b.x && s.tile.x < b.x + b.w && s.tile.y >= b.y && s.tile.y < b.y + b.h)) at(`station ${s.id} sits inside a building`);
  }
  for (const place of Object.keys(PLACE_LABEL) as Place[]) {
    if (!map.stations.some((s) => s.place === place)) at(`no station for ${place}`);
    if (place !== 'market' && !map.buildings.some((b) => b.kind === place)) at(`no building for ${place}`);
  }
  for (const p of map.props) {
    if (!hasWorldSprite(p.kind)) at(`prop ${p.kind} has no world sprite anchor`);
    if (!hasPropArt(p.kind, p.variant ?? 0)) at(`prop ${p.kind} has no art`);
  }
  for (const s of map.stations) if (!hasPropArt(s.prop.kind)) at(`station prop ${s.prop.kind} has no art`);
  return out;
}

/** Validate every registered theme, kit and map, and the cross references between them. */
export function validateRegistry(): string[] {
  const out: string[] = [];
  const dupes = (kind: string, ids: string[]) => { for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) out.push(`duplicate ${kind} id ${id}`); };
  dupes('theme', THEMES.map((t) => t.id)); dupes('people kit', KITS.map((k) => k.id)); dupes('map', MAPS.map((m) => m.id));
  if (!THEMES.some((t) => t.id === DEFAULT_THEME_ID)) out.push('the default theme is not registered');
  for (const theme of THEMES) { out.push(...validateTheme(theme)); if (compatibleMaps(theme).length === 0) out.push(`theme ${theme.id}: no usable map`); }
  for (const kit of KITS) {
    if (!ID.test(kit.id)) out.push(`people kit ${kit.id}: bad id`);
    if (!kit.preview.every(isColour)) out.push(`people kit ${kit.id}: preview swatches must be plain colours`);
    for (const list of [kit.hair, kit.cloth, kit.pants]) if (list && !list.every(isColour)) out.push(`people kit ${kit.id}: palettes must be plain colours`);
  }
  const tags = KITS.map((k) => k.textureTag);
  dupes('people kit texture tag', tags);
  for (const map of MAPS) {
    if (!ID.test(map.id)) out.push(`map ${map.id}: bad id`);
    out.push(...validateMap(map.build(), map));
  }
  return out;
}
