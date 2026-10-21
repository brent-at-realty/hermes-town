import { hasPropArt } from '../art/propArt';
import { PLACE_LABEL, type Place } from '../sim/toolMap';
import { hasWorldSprite } from '../world/dressing';
import { findPath } from '../world/pathfind';
import { strayWalkable } from '../world/regions';
import { validateTransit } from '../world/transit';
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
  if (theme.pack) {
    const kit = findKit(theme.people), map = findMap(theme.maps.default);
    if (!theme.pack.summary.trim() || !theme.pack.routeNote.trim()) at('a complete pack needs a summary and a route note');
    if (!kit || !map) at('a complete pack needs a registered people kit and default map');
    if (map && !map.routeNote) at('a complete pack whose map has transit must explain that its route animation is not a lifecycle signal');
  }
  // No theme may reference a remote or arbitrary asset.
  const serialised = JSON.stringify(theme);
  if (/https?:|\/\/|url\(|data:|\.\.\//i.test(serialised)) at('themes may not reference urls, data uris or relative paths');
  return out;
}

export function validateMap(map: TownMap, preset: Pick<MapPreset, 'id' | 'view'> & Partial<Pick<MapPreset, 'routeNote'>>): string[] {
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
  // Routing is by the map's own network when it has lifts or shuttles, and plain A* otherwise.
  const reachable = (to: { x: number; y: number }) => (map.transit ? map.transit.route(map.entrance, to) : findPath(map.grid, map.entrance, to));
  for (const t of targets) if (!reachable(t.tile)) at(`${t.id} is not reachable from the entrance`);
  if (map.transit) {
    out.push(...validateTransit(map.grid, map.entrance, map.transit.connectors, preset.id, map.transit.districts));
    const preview = (preset as Partial<MapPreset>).routeNote;
    if (!preview || !/not a separate Hermes lifecycle signal/.test(preview)) at('a map with transit must say its lifts or shuttles are not a lifecycle signal');
  }
  if (map.regions) {
    const stray = strayWalkable(map.grid, map.regions);
    if (stray.void.length > 0) at(`${stray.void.length} walkable tiles lie outside every authored region (void space must be blocked)`);
    if (stray.sun.length > 0) at('the sun must not be walkable');
  }
  if (map.skin && !map.regions) at('a skinned world must declare its regions');
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
  out.push(...validatePosts(map, preset.id));
  return out;
}

/**
 * Watch posts, when a map authors them: every post is a distinct, walkable tile, outside every building and room,
 * not on a workstation or a lift or car boarding/exit tile, outside every exclusion rectangle (lift shafts, lift
 * landings and approaches, car stops), and reachable from the entrance by the map's own routing.
 */
export function validatePosts(map: TownMap, mapId: string): string[] {
  const out: string[] = [];
  if (!map.posts) return out;
  const at = (m: string) => out.push(`map ${mapId}: ${m}`);
  const { w, h, cost } = map.grid;
  const walkable = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h && cost[y * w + x] !== 0;
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  const buildings = [...map.buildings, ...map.homes];
  const connectorTiles = (map.transit?.connectors ?? []).flatMap((c) => [c.boarding, c.exit]);
  const seen = new Set<string>();
  if (map.posts.length === 0) at('a map that authors posts needs at least one');
  map.posts.forEach((p, i) => {
    const name = `post #${i} (${p.x},${p.y})`;
    if (seen.has(`${p.x},${p.y}`)) at(`${name} duplicates another post`);
    seen.add(`${p.x},${p.y}`);
    if (!walkable(p.x, p.y)) { at(`${name} is not a walkable tile`); return; }
    for (const b of buildings) if (inRect(p, b)) at(`${name} stands inside building ${b.id}`);
    for (const s of map.stations) if (s.tile.x === p.x && s.tile.y === p.y) at(`${name} stands on workstation ${s.id}`);
    for (const t of connectorTiles) if (t.x === p.x && t.y === p.y) at(`${name} stands on a lift or car boarding/exit tile`);
    for (const r of map.postExclusions ?? []) if (inRect(p, r)) at(`${name} lies inside the ${r.kind} exclusion ${r.id}`);
    const reachable = map.transit ? map.transit.route(map.entrance, p) : findPath(map.grid, map.entrance, p);
    if (!reachable) at(`${name} is not reachable from the entrance`);
  });
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
    for (const c of [kit.trim, kit.hatColor, kit.plume, kit.sash, kit.hemBand, kit.sleeve, kit.shell, kit.accent]) if (c !== undefined && !/^#[0-9a-f]{6}$/i.test(c)) out.push(`people kit ${kit.id}: trim, hat, plume, sash and hem colours must be #rrggbb`);
  }
  const tags = KITS.map((k) => k.textureTag);
  dupes('people kit texture tag', tags);
  for (const map of MAPS) {
    if (!ID.test(map.id)) out.push(`map ${map.id}: bad id`);
    out.push(...validateMap(map.build(), map));
  }
  return out;
}
