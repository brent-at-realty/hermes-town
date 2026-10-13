// Appearance contract verification. No browser: the registries, the preference
// parsers and the resolver are plain TypeScript, bundled here with esbuild.
//
// Proves:
//   - the registries are consistent and every registered theme, people kit and
//     map satisfies the structural contract (reachability, art for every prop,
//     no remote assets);
//   - Classic is the pinned compatibility baseline and the fallback;
//   - Night Market is registered and supported;
//   - stored preferences and share URLs parse, validate and round-trip, and
//     hostile or unknown input falls back without throwing;
//   - reduced motion follows the system unless the viewer chooses;
//   - people kits never override a profile colour;
//   - src/sim and src/themes stay free of Phaser, and themes stay out of sim.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function load(entry) {
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  });
  const file = path.join(process.env.TMPDIR ?? '/tmp', `hermes-town-themes-${process.pid}.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

const t = await load(`
  export * from './src/themes/index.ts';
  export { validateRegistry, validateTheme, validateMap } from './src/themes/validate.ts';
  export { CLASSIC } from './src/themes/classic.ts';
  export { NIGHT_MARKET } from './src/themes/nightMarket.ts';
  export { lookFor } from './src/art/characters.ts';
  export { PROP_ART, hasPropArt } from './src/art/propArt.ts';
  export { buildTownMap } from './src/world/map.ts';
`);

let checks = 0;
const ok = (name, fn) => { try { fn(); checks += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } };
const system = (prefersReducedMotion) => ({ prefersReducedMotion });

// ------------------------------------------------------------- registry
ok('registry is internally consistent and every theme, kit and map validates', () => {
  assert.deepEqual(t.validateRegistry(), []);
});
ok('registry ids', () => {
  assert.deepEqual(t.themeIds(), ['classic', 'night-market']);
  assert.ok(t.kitIds().includes('townsfolk') && t.kitIds().includes('market-folk'));
  assert.ok(t.mapIds().includes('town'));
});
ok('unknown theme ids fall back to Classic', () => {
  for (const id of ['nope', '', undefined, null, '__proto__', 'CLASSIC']) assert.equal(t.themeOrDefault(id).id, 'classic');
  assert.equal(t.DEFAULT_THEME_ID, 'classic');
});
ok('a theme that points at a missing kit or map is rejected', () => {
  const bad = { ...t.CLASSIC, id: 'bad', people: 'ghost', maps: { default: 'atlantis', compatible: ['atlantis'] } };
  const problems = t.validateTheme(bad);
  assert.ok(problems.some((p) => /people kit "ghost"/.test(p)));
  assert.ok(problems.some((p) => /default map "atlantis"/.test(p)));
});
ok('a theme cannot reference a remote asset or url', () => {
  const bad = { ...t.CLASSIC, id: 'bad', ui: { ...t.CLASSIC.ui, panel: 'url(https://example.test/x.png)' } };
  assert.ok(t.validateTheme(bad).length > 0);
  const sneaky = { ...t.CLASSIC, id: 'bad', description: 'see https://example.test/asset.png' };
  assert.ok(t.validateTheme(sneaky).some((p) => /urls/.test(p)));
});

// --------------------------------------------------- classic compatibility
ok('Classic pins the original presentation literals', () => {
  const c = t.CLASSIC;
  assert.equal(c.ui.canvasBackground, '#1a1620');
  assert.equal(c.ui.page, '#14111a');
  assert.equal(c.ui.panel, 'rgba(20,17,26,.82)');
  assert.equal(c.ui.panelBorder, '#4a3b33');
  assert.equal(c.ui.statusOk, '#9fd08a');
  assert.deepEqual(c.ui.minimap, {
    background: '#1a1620', water: '#2f5566', cobble: '#6f6a68', path: '#8a6a44', trail: '#6f6a3e', grassDry: '#7a7a3c',
    grassWet: '#3f5a30', ledge: '#5a4a3e', grass: '#4f6b34', tree: '#2f5228', house: '#6b3d2a', building: '#c9b391',
    dot: '#f3e6c9', dotChild: '#c9b58f', dotSelected: '#ffd36b', viewport: 'rgba(255,255,255,0.7)',
  });
  assert.equal(c.ui.scene.name, '#f3e6c9');
  assert.equal(c.ui.scene.nameRunner, '#a9c4d6');
  assert.equal(c.ui.scene.bubbleFill, 0xf7f1e3);
  assert.deepEqual(c.art.treeTints, [0xe2ebe1, 0xc4d9d1, 0xe2dfb9, 0xd2e3d0]);
  assert.equal(c.art.worldTint, 0xffffff);
  assert.deepEqual(c.environment.grade, { multiplyColor: 0xf6dfb4, multiplyAlpha: 0.3, addColor: 0xffc070, addAlpha: 0.015 });
  assert.deepEqual(c.environment.night, { warm: 0xb08a6a, cold: 0x2a3550, strength: 0.78 });
  assert.equal(c.environment.time, 'auto');
  assert.equal(c.environment.weather, 'clear');
  assert.equal(c.environment.motes, null);
  assert.equal(c.environment.clouds.count, 7);
  assert.deepEqual(c.environment.haze, { color: [178, 190, 200], alpha: 0.22 });
});
ok('Classic resolves to the original look: default kit, original map, clock time, no weather', () => {
  const r = t.resolveAppearance(t.DEFAULT_CHOICE, system(false));
  assert.equal(r.theme.id, 'classic');
  assert.equal(r.people.id, 'townsfolk');
  assert.equal(r.map.id, 'town');
  assert.equal(r.environment.hour, null);
  assert.equal(r.environment.weather, 'clear');
  assert.equal(r.environment.windSway, 1);
  assert.equal(r.environment.particleRate, 1);
  assert.equal(r.environment.rain, false);
  assert.equal(r.environment.motes, null);
  assert.deepEqual(r.notes, []);
});
ok('the original townsfolk kit leaves every look untouched', () => {
  const kit = t.findKit('townsfolk');
  for (const role of ['coordinator', 'research', 'fabrication', 'review', 'tooling', 'general', 'scheduled']) {
    const look = t.lookFor(`bucket-${role}`, role);
    assert.strictEqual(t.applyPeopleKit(look, kit, `bucket-${role}`), look);
  }
});
ok('the "town" map is the original map', () => {
  const original = t.buildTownMap();
  const preset = t.findMap('town').build();
  assert.deepEqual([...preset.grid.cost], [...original.grid.cost]);
  assert.deepEqual(preset.props, original.props);
  assert.deepEqual(preset.entrance, original.entrance);
  assert.equal(preset.buildings.length, 7);
  assert.equal(preset.homes.length, 7);
});

// ------------------------------------------------------------ night market
ok('Night Market is registered, distinct, and uses the existing topology', () => {
  const nm = t.findTheme('night-market');
  assert.ok(nm);
  assert.notDeepEqual(nm.ui, t.CLASSIC.ui);
  assert.notEqual(nm.people, t.CLASSIC.people);
  assert.equal(nm.maps.default, 'town');
  const r = t.resolveAppearance({ ...t.DEFAULT_CHOICE, theme: 'night-market' }, system(false));
  assert.equal(r.people.id, 'market-folk');
  assert.equal(r.environment.time, 'night');
  assert.equal(r.environment.hour, 23);
  assert.ok(r.environment.motes && r.environment.motes.count > 0);
  assert.ok(r.environment.lampGlow > t.CLASSIC.environment.lampGlow);
});
ok('Night Market motes are decorative only and disappear under reduced motion', () => {
  const r = t.resolveAppearance({ ...t.DEFAULT_CHOICE, theme: 'night-market', motion: 'reduced' }, system(false));
  assert.equal(r.environment.motes, null);
  assert.ok(r.environment.particleRate < 1);
});

// ------------------------------------------------------ people kit semantics
ok('every kit keeps the profile colour it is given', () => {
  const palette = ['#c0392b', '#2e6fd0', '#2fa35a', '#e0a81e'];
  for (const kit of t.KITS) for (const role of ['coordinator', 'fabrication', 'scheduled']) for (const cloth of palette) {
    const look = t.lookFor('x', role, cloth);
    const styled = t.applyPeopleKit(look, kit, 'x', cloth);
    assert.equal(styled.cloth, cloth, `${kit.id}/${role}`);
  }
});
ok('kits are deterministic per resident and vary across residents', () => {
  const kit = t.findKit('market-folk');
  const a = t.applyPeopleKit(t.lookFor('a', 'research'), kit, 'a');
  assert.deepEqual(a, t.applyPeopleKit(t.lookFor('a', 'research'), kit, 'a'));
  const clothes = new Set(Array.from({ length: 24 }, (_, i) => t.applyPeopleKit(t.lookFor(`r${i}`, 'research'), kit, `r${i}`).cloth));
  assert.ok(clothes.size > 2);
});
ok('kit texture tags are unique so sprite sheets never collide', () => {
  const tags = t.KITS.map((k) => k.textureTag);
  assert.equal(new Set(tags).size, tags.length);
  assert.equal(t.findKit('townsfolk').textureTag, '');
});

// ----------------------------------------------------------- maps and props
ok('every placed prop on every map has art', () => {
  for (const preset of t.MAPS) {
    const map = preset.build();
    const missing = map.props.filter((p) => !t.hasPropArt(p.kind, p.variant ?? 0)).map((p) => p.kind);
    assert.deepEqual(missing, [], preset.id);
  }
});
ok('map validation catches an unreachable station and a prop without art', () => {
  const preset = t.findMap('town');
  const map = preset.build();
  const station = map.stations[0];
  const cost = new Uint8Array(map.grid.cost);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) cost[(station.tile.y + dy) * map.grid.w + station.tile.x + dx] = 0;
  const walled = { ...map, grid: { ...map.grid, cost } };
  assert.ok(t.validateMap(walled, preset).some((p) => /not reachable/.test(p)));
  const broken = { ...map, props: [...map.props, { kind: 'mystery', x: 0, y: 0 }] };
  assert.ok(t.validateMap(broken, preset).some((p) => /no art/.test(p)));
});
ok('registered maps are distinct layouts of the same contract', () => {
  const a = t.findMap('town').build(), b = t.findMap('greenwood').build();
  assert.equal(a.grid.w, b.grid.w);
  assert.notDeepEqual(a.props.map((p) => [p.kind, p.x, p.y]), b.props.map((p) => [p.kind, p.x, p.y]));
});

// ---------------------------------------------------------------- preferences
ok('defaults parse from nothing and serialise to a stable minimal query', () => {
  const p = t.parseSearch('');
  assert.equal(p.present, false);
  assert.deepEqual(p.choice, t.DEFAULT_CHOICE);
  assert.equal(t.toSearch(t.DEFAULT_CHOICE), 'theme=classic');
});
ok('share URL round-trips for every combination of registered options', () => {
  let n = 0;
  for (const theme of t.themeIds()) for (const people of ['theme', ...t.kitIds()]) for (const map of ['theme', ...t.mapIds()])
    for (const time of ['theme', ...t.TIME_OPTIONS.map((o) => o.id)]) for (const weather of ['theme', ...t.WEATHER_OPTIONS.map((o) => o.id)])
      for (const motion of t.MOTION_OPTIONS.map((o) => o.id)) {
        const choice = { theme, people, map, time, weather, motion };
        const query = t.toSearch(choice);
        const back = t.parseSearch(query);
        assert.deepEqual(back.rejected, []);
        assert.deepEqual(back.choice, choice, query);
        assert.equal(t.toSearch(back.choice), query);
        n += 1;
      }
  assert.ok(n > 500);
});
ok('share links are stable: fixed key order, no volatile fields', () => {
  const q = t.toSearch({ theme: 'night-market', people: 'plainclothes', map: 'greenwood', time: 'evening', weather: 'mist', motion: 'reduced' });
  assert.equal(q, 'theme=night-market&people=plainclothes&map=greenwood&time=evening&weather=mist&motion=reduced');
  assert.equal(t.shareUrl(t.DEFAULT_CHOICE, { origin: 'http://127.0.0.1:4187', pathname: '/', agents: 'demo' }), 'http://127.0.0.1:4187/?agents=demo&theme=classic');
  assert.equal(t.shareUrl(t.DEFAULT_CHOICE, { origin: 'http://127.0.0.1:4187', pathname: '/', agents: 'evil&x=1' }), 'http://127.0.0.1:4187/?theme=classic');
});
ok('hostile and unknown URL values fall back field by field, never throw', () => {
  const hostile = ['<script>', '../../etc/passwd', 'javascript:alert(1)', 'x'.repeat(5000), '__proto__', 'constructor', '%00', 'Night-Market', ' classic', 'classic ', '', '1', 'NaN'];
  for (const value of hostile) {
    for (const key of t.CHOICE_KEYS) {
      const p = t.parseSearch(new URLSearchParams([[key, value]]));
      assert.ok(p.rejected.includes(key), `${key}=${value.slice(0, 20)}`);
      assert.deepEqual(p.choice, t.DEFAULT_CHOICE);
      const r = t.resolveAppearance(p.choice, system(false));
      assert.equal(r.theme.id, 'classic');
    }
  }
  const mixed = t.parseSearch('theme=night-market&people=wizard&map=atlantis&time=midnight&weather=snow&motion=wild');
  assert.equal(mixed.choice.theme, 'night-market');
  assert.deepEqual(mixed.rejected, ['people', 'map', 'time', 'weather', 'motion']);
  assert.equal(mixed.choice.people, 'theme');
  assert.equal(mixed.present, true);
});
ok('duplicate and extra parameters are ignored safely', () => {
  const p = t.parseSearch('theme=night-market&theme=classic&evil=1&agents=demo&hour=3');
  assert.equal(p.choice.theme, 'night-market');
  assert.deepEqual(p.rejected, []);
});
ok('stored preferences are versioned and round-trip', () => {
  const choice = { theme: 'night-market', people: 'plainclothes', map: 'greenwood', time: 'night', weather: 'rain', motion: 'full' };
  const text = t.serializeStored(choice);
  assert.equal(JSON.parse(text).v, 1);
  assert.deepEqual(t.parseStored(text).choice, choice);
});
ok('stored preferences of another version, or junk, yield nothing', () => {
  for (const text of [null, undefined, '', 'not json', '[]', '"x"', '{"v":2,"theme":"classic"}', '{"v":0}', '{"theme":"classic"}', JSON.stringify({ v: 1, pad: 'x'.repeat(3000) }), '{"v":"1"}']) {
    assert.equal(t.parseStored(text), null, String(text).slice(0, 30));
  }
});
ok('stored preferences must be complete: bad or missing fields yield nothing, never partial defaults', () => {
  assert.equal(t.parseStored('{"v":1,"theme":"night-market","people":{"a":1},"map":"atlantis","motion":"reduced"}'), null);
  assert.equal(t.parseStored('{"v":1}'), null);
  assert.equal(t.parseStored('{"v":1,"theme":null,"people":null,"map":null,"time":null,"weather":null,"motion":null}'), null);
  const choice = { theme: 'night-market', people: 'plainclothes', map: 'greenwood', time: 'night', weather: 'rain', motion: 'full' };
  const full = { v: 1, ...choice };
  const ok1 = t.parseStored(JSON.stringify(full));
  assert.deepEqual(ok1.choice, choice);
  assert.deepEqual(ok1.rejected, []);
  for (const key of ['theme', 'people', 'map', 'time', 'weather', 'motion']) {
    const missing = { ...full }; delete missing[key];
    assert.equal(t.parseStored(JSON.stringify(missing)), null, `missing ${key}`);
    assert.equal(t.parseStored(JSON.stringify({ ...full, [key]: null })), null, `null ${key}`);
    for (const bad of ['bogus', 7, {}, [], true, '../x', 'x'.repeat(40)]) {
      assert.equal(t.parseStored(JSON.stringify({ ...full, [key]: bad })), null, `invalid ${key}=${JSON.stringify(bad)}`);
    }
  }
});
ok('an incomplete saved record never overrides a valid host default or Classic, and never throws', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  const full = { v: 1, theme: 'classic', people: 'theme', map: 'theme', time: 'theme', weather: 'mist', motion: 'system' };
  const noWeather = { ...full }; delete noWeather.weather;
  const incomplete = [{ v: 1 }, { v: 1, theme: 'night-market' }, noWeather, { ...full, motion: 'bogus' }, { ...full, map: 7 }];
  for (const record of incomplete) {
    mem.set(t.APPEARANCE_STORAGE_KEY, JSON.stringify(record));
    const label = JSON.stringify(record);
    const host = t.loadChoice({ search: '', storage, hostDefault: 'theme=night-market&weather=rain' });
    assert.equal(host.source, 'host', label);
    assert.equal(host.choice.theme, 'night-market', label);
    assert.equal(host.choice.weather, 'rain', label);
    const none = t.loadChoice({ search: '', storage });
    assert.equal(none.source, 'default', label);
    assert.deepEqual(none.choice, t.DEFAULT_CHOICE, label);
  }
  // A complete record keeps its precedence over the host default.
  mem.set(t.APPEARANCE_STORAGE_KEY, JSON.stringify(full));
  const saved = t.loadChoice({ search: '', storage, hostDefault: 'theme=night-market' });
  assert.equal(saved.source, 'saved');
  assert.equal(saved.choice.weather, 'mist');
  // Saving over an incomplete record yields a valid saved view.
  mem.set(t.APPEARANCE_STORAGE_KEY, '{"v":1}');
  assert.ok(t.saveStored(storage, { ...t.DEFAULT_CHOICE, theme: 'night-market', weather: 'rain' }));
  const resaved = t.loadChoice({ search: '', storage, hostDefault: 'theme=classic' });
  assert.equal(resaved.source, 'saved');
  assert.equal(resaved.choice.theme, 'night-market');
  // An incomplete record does not suppress a share link either.
  mem.set(t.APPEARANCE_STORAGE_KEY, '{"v":1}');
  assert.equal(t.loadChoice({ search: '?theme=night-market', storage }).source, 'link');
});
ok('storage that throws behaves like an empty store', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(t.loadStored(throwing), null);
  assert.equal(t.saveStored(throwing, t.DEFAULT_CHOICE), false);
  assert.equal(t.clearStored(throwing), false);
  assert.equal(t.loadStored(null), null);
  assert.equal(t.saveStored(null, t.DEFAULT_CHOICE), false);
});
ok('precedence: link over saved view over host default over Classic; a link is not persisted', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(t.loadChoice({ search: '', storage }).source, 'default');
  assert.equal(t.loadChoice({ search: '', storage, hostDefault: 'theme=night-market' }).choice.theme, 'night-market');
  assert.equal(t.loadChoice({ search: '', storage, hostDefault: 'theme=night-market' }).source, 'host');
  assert.ok(t.saveStored(storage, { ...t.DEFAULT_CHOICE, theme: 'classic', weather: 'mist' }));
  const saved = t.loadChoice({ search: '', storage, hostDefault: 'theme=night-market' });
  assert.equal(saved.source, 'saved');
  assert.equal(saved.choice.weather, 'mist');
  const link = t.loadChoice({ search: '?theme=night-market&weather=rain', storage });
  assert.equal(link.source, 'link');
  assert.equal(link.choice.theme, 'night-market');
  assert.equal(link.choice.weather, 'rain');
  assert.equal(JSON.parse(mem.get(t.APPEARANCE_STORAGE_KEY)).theme, 'classic', 'a link must not overwrite the saved view');
  assert.equal(t.loadChoice({ search: '?hour=3&agents=demo', storage }).source, 'saved', 'non-appearance parameters do not count as a link');
  assert.equal(t.loadChoice({ search: '', storage: null, hostDefault: 'theme=bogus' }).source, 'host');
  assert.equal(t.loadChoice({ search: '?theme=bogus', storage }).rejected[0], 'theme');
  t.clearStored(storage);
  assert.equal(t.loadChoice({ search: '', storage }).source, 'default');
});

// --------------------------------------------------------------- resolution
ok('map compatibility: an incompatible map falls back to the theme map with a note', () => {
  const only = { ...t.CLASSIC, id: 'only-town', maps: { default: 'town', compatible: ['town'] } };
  const r = t.compatibleMaps(only);
  assert.deepEqual(r.map((m) => m.id), ['town']);
  const ok2 = t.resolveAppearance({ ...t.DEFAULT_CHOICE, map: 'greenwood' }, system(false));
  assert.equal(ok2.map.id, 'greenwood');
  assert.equal(ok2.choice.map, 'greenwood');
  const unknown = t.resolveAppearance({ ...t.DEFAULT_CHOICE, map: 'atlantis', people: 'wizard', theme: 'nope' }, system(false));
  assert.equal(unknown.theme.id, 'classic');
  assert.equal(unknown.map.id, 'town');
  assert.equal(unknown.people.id, 'townsfolk');
  assert.equal(unknown.choice.map, 'theme');
  assert.equal(unknown.notes.length, 3);
});
ok('selecting a theme brings its own people, map, time and weather but keeps the motion choice', () => {
  const next = t.chooseTheme({ theme: 'classic', people: 'plainclothes', map: 'greenwood', time: 'noon', weather: 'rain', motion: 'reduced' }, 'night-market');
  assert.deepEqual(next, { theme: 'night-market', people: 'theme', map: 'theme', time: 'theme', weather: 'theme', motion: 'reduced' });
  assert.equal(t.chooseTheme(t.DEFAULT_CHOICE, 'bogus').theme, 'classic');
});
ok('time and weather overrides beat the theme default', () => {
  const r = t.resolveAppearance({ ...t.DEFAULT_CHOICE, theme: 'night-market', time: 'noon', weather: 'mist' }, system(false));
  assert.equal(r.environment.hour, 13);
  assert.equal(r.environment.weather, 'mist');
  assert.ok(r.environment.hazeAlpha > t.NIGHT_MARKET.environment.haze.alpha);
});

// ------------------------------------------------------------- reduced motion
ok('reduced motion follows the system unless the viewer chooses', () => {
  assert.equal(t.resolveReducedMotion('system', true), true);
  assert.equal(t.resolveReducedMotion('system', false), false);
  assert.equal(t.resolveReducedMotion('reduced', false), true);
  assert.equal(t.resolveReducedMotion('full', true), false);
});
ok('reduced motion lowers decorative movement and particle intensity', () => {
  const full = t.resolveAppearance({ ...t.DEFAULT_CHOICE, motion: 'full', weather: 'rain' }, system(true)).environment;
  const reduced = t.resolveAppearance({ ...t.DEFAULT_CHOICE, motion: 'system', weather: 'rain' }, system(true)).environment;
  assert.equal(full.reducedMotion, false);
  assert.equal(reduced.reducedMotion, true);
  assert.ok(reduced.windSway < full.windSway);
  assert.ok(reduced.cloudDrift < full.cloudDrift);
  assert.ok(reduced.particleRate < full.particleRate);
  assert.equal(full.rain, true);
  assert.equal(reduced.rain, false, 'rain streaks are movement; the dimming stays');
  assert.equal(reduced.weather, 'rain');
  assert.ok(reduced.extraDim > 0);
});

// ------------------------------------------------------------- source rules
ok('src/sim and src/themes import no Phaser; src/sim imports no themes', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const file of [...walk(path.join(root, 'src/sim')), ...walk(path.join(root, 'src/themes'))].filter((f) => f.endsWith('.ts'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/from\s+['"]phaser['"]/.test(text), `${path.relative(root, file)} imports Phaser`);
  }
  for (const file of walk(path.join(root, 'src/sim')).filter((f) => f.endsWith('.ts'))) {
    assert.ok(!/from\s+['"][^'"]*themes[^'"]*['"]/.test(fs.readFileSync(file, 'utf8')), `${path.relative(root, file)} imports themes`);
  }
});
ok('the renderer, HUD and simulator never branch on a theme, map or kit id', () => {
  const files = ['src/main.ts', 'src/scenes/TownScene.ts', 'src/hud/appearancePanel.ts', 'src/runtime.ts', ...fs.readdirSync(path.join(root, 'src/sim')).map((f) => `src/sim/${f}`)];
  const ids = [...t.themeIds(), ...t.kitIds(), ...t.mapIds()].filter((id) => !['town'].includes(id));
  for (const file of files) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const id of ids) assert.ok(!new RegExp(`['"\`]${id}['"\`]`).test(text), `${file} mentions the id "${id}"`);
    assert.ok(!/theme\.id\s*[=!]==|\.id\s*===\s*['"](classic|night-market)/.test(text), `${file} branches on a theme id`);
  }
});
ok('no appearance code reads Hermes data or loads remote assets', () => {
  for (const file of fs.readdirSync(path.join(root, 'src/themes')).map((f) => `src/themes/${f}`)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/\bfetch\(|XMLHttpRequest|EventSource|new Image\(|import\(['"]https?:/.test(text), `${file} performs I/O`);
  }
});

console.log(`verify-themes: ${checks} checks passed`);
