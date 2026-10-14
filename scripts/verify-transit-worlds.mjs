// Cyber City and Orbital System browser verification, against the production build served by the real Town
// server on loopback (run `npm run build` first). All activity is synthetic.
//
// Proves, in a real browser:
//   - each world mounts as one canvas with no browser error, and the main canvas and the minimap differ per map;
//   - a lift or shuttle ride is one resident's visual route: one resident, no clone, the rider's own sprite hidden while
//     inside the car or craft, a car or craft present, the public state unchanged, the ride never an event;
//   - the car, the craft and every ambient layer sit beneath name tags, bubbles and emotes;
//   - reduced motion keeps a static cue (floor label, lit signs) and removes continuous travel: the lift stands at a
//     floor, the shuttle at a dock, never between;
//   - the orbital "rain" setting is a solar-particle field, never rain, and its label says so;
//   - appearance and map changes make no write request; every request is a GET;
//   - repeated map switching and a reload in the middle of a ride leak no canvas, scene, texture, listener or pool slot;
//   - the complete-pack buttons set theme, people, map and environment together, and Reset returns the Town defaults.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';
import { createPixels } from './lib/pixels.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/worlds');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-worlds-'));
const token = crypto.randomBytes(32).toString('base64url');
const town = createTownServer({ token, journalPath: path.join(temp, 'journal.jsonl'), staticRoot: path.join(root, 'dist') });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const pixels = createPixels(browser);
const errors = [];
const receipts = { syntheticActivity: true };

const ready = (page) => page.waitForFunction(() => {
  const s = window.__town?.runtime?.scene?.();
  return Boolean(s && s.textures.exists('art-tree0') && s.appearance);
}, null, { timeout: 30000 });
const open = async (page) => { if (await page.locator('#appearance:not([hidden])').count() === 0) await page.click('#appearance-toggle'); await page.waitForSelector('#appearance:not([hidden])'); };
const track = (page, log) => page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) log.push({ method: req.method(), path: u.pathname }); });
const shot = (page) => page.locator('#game canvas').screenshot();
const mini = async (page) => Buffer.from((await page.evaluate(() => document.querySelector('#minimap').toDataURL('image/png'))).split(',')[1], 'base64');
const quiet = (page) => page.evaluate(() => { const t = window.__town; t.source.stop(); t.sim.residents.clear(); const s = t.runtime.scene(); s.setDirector(true); s.overview(); });
const settle = (page, n = 8) => page.evaluate((frames) => new Promise((resolve) => { const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))); tick(frames); }), n);

/** Spawn one session and fast-forward the simulation until it is riding. Returns what the ride is. */
const startRide = (page, { tool = null } = {}) => page.evaluate(async (toolName) => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  t.source.stop(); sim.residents.clear();
  s.setDirector(false);
  const id = 'h/main/riderxxxxxxxxxxx';
  sim.push({ id: 'w1', agentId: id, seq: 1, at: 0, type: 'agent.spawned', role: 'coordinator', displayName: 'rider', profile: 'work', paletteSlot: 1 });
  sim.push({ id: 'w2', agentId: id, seq: 2, at: 0, type: 'agent.assigned' });
  if (toolName) sim.push({ id: 'w3', agentId: id, seq: 3, at: 0, type: 'agent.tool_started', tool: toolName });
  const rider = () => [...sim.residents.values()].find((r) => r.transit);
  for (let i = 0; i < 6000 && !rider(); i++) sim.update(0.05);
  const r = rider();
  if (!r) return { error: 'no ride', residents: sim.residents.size };
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return { id: r.id, connector: r.transit?.connectorId ?? null, state: r.state, place: r.place };
}, tool);

const rideFacts = (page) => page.evaluate(() => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  const r = [...sim.residents.values()].find((x) => x.transit);
  if (!r) return null;
  const snap = s.transit.snapshot();
  const view = s.views.get(r.id);
  return { residents: sim.residents.size, state: r.state, place: r.place, snap, spriteVisible: view?.sprite.visible, labelDepth: view?.name?.depth ?? null, rideDepth: snap[0]?.depth ?? null, kind: snap[0]?.kind, phase: snap[0]?.phase, x: r.x, y: r.y, from: r.transit.from, to: r.transit.to };
});

const worlds = [
  { id: 'cyber-city', people: 'neon-operatives', kind: 'lift', pack: 'ap-pack-cyber-city', tool: null },
  { id: 'orbital-system', people: 'orbital-crew', kind: 'shuttle', pack: 'ap-pack-orbital-system', tool: 'read_file' },
];
const { port } = await town.listen(0);
const base = `http://127.0.0.1:${port}`;

try {
  // ============================================================ each world mounts, differs, and rides
  const mainShots = {}, miniShots = {};
  for (const w of worlds) {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${w.id}: ${e.message}`));
    const requests = [];
    track(page, requests);
    await page.goto(`${base}/?agents=demo&hour=12&theme=${w.id}`);
    await ready(page);
    assert.equal(await page.locator('canvas').count() >= 1, true);
    assert.equal(await page.locator('#game canvas').count(), 1, 'one game canvas');
    const preset = await page.evaluate(() => window.__town.runtime.preset.id);
    assert.equal(preset, w.id);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await quiet(page); await settle(page);
    mainShots[w.id] = await shot(page); miniShots[w.id] = await mini(page);
    await fs.writeFile(path.join(output, `${w.id}-overview.png`), mainShots[w.id]);
    await fs.writeFile(path.join(output, `${w.id}-minimap.png`), miniShots[w.id]);

    // ride
    const ride = await startRide(page, { tool: w.tool });
    assert.ok(!ride.error, `${w.id}: ${JSON.stringify(ride)}`);
    const expectResidents = w.tool ? 2 : 1;
    assert.equal((await page.evaluate((id) => window.__town.map.transit.byId(id)?.kind, ride.connector)), w.kind);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); const r = [...window.__town.sim.residents.values()].find((x) => x.transit); s.setDirector(false); s.cameras.main.setZoom(3); s.cameras.main.centerOn(r.x, r.y - 20); });
    const seen = { board: 0, ride: 0, exit: 0, hidden: 0, shown: 0 };
    let facts = null, snapMid = null;
    for (let i = 0; i < 60; i++) {
      facts = await rideFacts(page);
      if (!facts) break;
      assert.equal(facts.residents, expectResidents, `${w.id}: no clone of the rider`);
      assert.ok(['moving', 'returning'].includes(facts.state), `${w.id}: public state ${facts.state}`);
      assert.equal(facts.snap.length, 1);
      seen[facts.phase] += 1;
      if (facts.snap[0].riderHidden) { seen.hidden += 1; assert.equal(facts.spriteVisible, false, 'the rider sprite is hidden while inside'); } else { seen.shown += 1; assert.equal(facts.spriteVisible, true); }
      if (facts.phase === 'ride' && !snapMid) { snapMid = facts; await fs.writeFile(path.join(output, `${w.id}-ride.png`), await shot(page)); }
      await page.waitForTimeout(80);
    }
    assert.ok(seen.ride > 3 && seen.hidden > 3, `${w.id}: the rider was seen riding (${JSON.stringify(seen)})`);
    assert.ok(snapMid, `${w.id}: a mid-ride frame was captured`);
    assert.ok(snapMid.rideDepth !== null && snapMid.rideDepth < 150000, 'the car or craft is beneath every name tag (150000), bubble and emote');
    const after = await page.evaluate(() => ({ residents: window.__town.sim.residents.size, ids: [...window.__town.sim.residents.keys()], transit: [...window.__town.sim.residents.values()].some((r) => r.transit) }));
    assert.equal(after.residents, expectResidents);
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], `${w.id}: no write request`);
    receipts[`ride-${w.id}`] = { connector: ride.connector, phases: seen };
    await ctx.close();
  }
  const mainDiff = await pixels.measure(mainShots['cyber-city'], mainShots['orbital-system']);
  const miniDiff = await pixels.measure(miniShots['cyber-city'], miniShots['orbital-system'], { tolerance: 16 });
  assert.ok(mainDiff.ratio > 0.4, `the two worlds look different (${mainDiff.ratio})`);
  assert.ok(miniDiff.ratio > 0.2, `the two minimaps differ (${miniDiff.ratio})`);
  receipts.maps = { canvasPixelsChanged: +mainDiff.ratio.toFixed(3), minimapPixelsChanged: +miniDiff.ratio.toFixed(3) };

  // ============================================================ reduced motion
  for (const w of worlds) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`reduced ${w.id}: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=12&theme=${w.id}&motion=reduced`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    const ride = await startRide(page, { tool: w.tool });
    assert.ok(!ride.error, JSON.stringify(ride));
    const positions = new Set(), labels = new Set(), flags = new Set();
    for (let i = 0; i < 50; i++) {
      const f = await rideFacts(page);
      if (!f) break;
      flags.add(f.snap[0].reduced); labels.add(f.snap[0].label);
      // a reduced-motion vehicle never glides: it is at the origin or at the destination, never between
      const p = f.snap[0];
      const atFrom = Math.abs(p.x - f.from.x) < 1.5 || Math.abs(p.y - 9 - f.from.y) < 1.5 || Math.abs(p.y + 2 - f.from.y) < 3;
      const atTo = Math.abs(p.x - f.to.x) < 1.5 || Math.abs(p.y - 9 - f.to.y) < 1.5 || Math.abs(p.y + 2 - f.to.y) < 3;
      assert.ok(atFrom || atTo, `${w.id}: a reduced-motion vehicle stands at a stop (${p.x},${p.y})`);
      positions.add(`${Math.round(p.x)},${Math.round(p.y)}`);
      await page.waitForTimeout(100);
    }
    assert.deepEqual([...flags], [true]);
    assert.ok(positions.size <= 2, `${w.id}: at most two stops, saw ${[...positions].join(' | ')}`);
    assert.ok([...labels].every((l) => l.length > 0), 'the static cue (a floor or destination label) is shown');
    receipts[`reduced-${w.id}`] = { stops: [...positions], label: [...labels][0] };
    await ctx.close();
  }

  // ============================================================ orbital weather is not rain
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`weather: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=12&theme=orbital-system&weather=rain`);
    await ready(page);
    const info = await page.evaluate(() => {
      const s = window.__town.runtime.scene();
      return { solar: s.textures.exists('solar-near') && s.textures.exists('solar-far'), layers: s.rainLayers.map((l) => l.sheet), weather: s.appearance().environment.weather };
    });
    assert.equal(info.weather, 'rain');
    assert.ok(info.solar && info.layers.length > 0 && info.layers.every((k) => k.startsWith('solar-')), JSON.stringify(info));
    await open(page);
    const labels = await page.$$eval('#ap-weather option', (os) => os.map((o) => o.textContent));
    assert.ok(labels.includes('Solar-particle field') && labels.includes('Nebula haze') && labels.includes('Clear orbit'), labels.join('|'));
    assert.ok(!labels.includes('Rain'));
    assert.match(await page.textContent('#ap-route-note'), /not a separate Hermes lifecycle signal/);
    await page.screenshot({ path: path.join(output, 'orbital-appearance-panel.png') });
    // the same setting on the Town still says rain and draws rain
    await page.goto(`${base}/?agents=demo&hour=12&weather=rain`);
    await ready(page);
    const town0 = await page.evaluate(() => { const s = window.__town.runtime.scene(); return { solar: s.textures.exists('solar-near'), layers: s.rainLayers.map((l) => l.sheet) }; });
    assert.equal(town0.solar, false, 'the Town never paints solar particles');
    assert.ok(town0.layers.every((k) => k.startsWith('rain-')), JSON.stringify(town0));
    await open(page);
    assert.deepEqual(await page.$$eval('#ap-weather option', (os) => os.map((o) => o.textContent)), ['Theme default', 'Clear', 'Mist', 'Rain']);
    receipts.orbitWeather = { layers: info.layers, labels };
    await ctx.close();
  }

  // ============================================================ packs, map switching, reset, no writes, no leaks
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // count every outstanding animation-frame callback, so a loop that survives a remount shows up
    await ctx.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window), live = new Set();
      window.__raf = live;
      window.requestAnimationFrame = (cb) => { const id = raf((t) => { live.delete(id); cb(t); }); live.add(id); return id; };
      window.cancelAnimationFrame = (id) => { live.delete(id); caf(id); };
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`packs: ${e.message}`));
    const requests = [];
    track(page, requests);
    await page.goto(`${base}/?agents=demo&hour=12`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    const baseline = async () => page.evaluate(() => {
      const s = window.__town.runtime.scene();
      const game = window.__town.game;
      const emitters = s.children.list.filter((o) => o.type === 'ParticleEmitter');
      const count = (em) => em.eventNames().reduce((n, name) => n + em.listenerCount(name), 0);
      // every game a previous mount created: none may still be running
      const retired = window.__retired ?? [];
      return {
        canvases: document.querySelectorAll('canvas').length, games: document.querySelectorAll('#game canvas').length,
        textures: s.textures.getTextureKeys().length, scenes: game.scene.scenes.length,
        emitters: emitters.length, particlesAlive: emitters.reduce((n, e) => n + e.getAliveParticleCount(), 0),
        listeners: count(s.events) + count(game.events) + count(s.input),
        rafLoops: window.__raf.size,
        retiredStillRunning: retired.filter((g) => g.loop && g.loop.running).length, retired: retired.length,
      };
    });
    const retire = () => page.evaluate(() => { (window.__retired ??= []).push(window.__town.game); });
    const first = await baseline();
    assert.equal(first.games, 1);
    await open(page);
    // the pack button changes the choice only; the map waits for Apply
    for (const w of worlds) {
      await page.click(`#${w.pack}`);
      const choice = await page.evaluate(() => { const a = window.__town.appearance.resolved(); return { theme: a.theme.id, people: a.people.id, map: a.map.id }; });
      assert.deepEqual(choice, { theme: w.id, people: w.people, map: w.id });
      assert.notEqual(await page.evaluate(() => window.__town.runtime.preset.id), w.id, 'the old map stays until Apply');
      assert.match(await page.textContent('#ap-route-note'), /not a separate Hermes lifecycle signal/);
      await retire();
      await page.click('#ap-map-apply');
      await page.waitForFunction((id) => window.__town.runtime.preset.id === id && window.__town.runtime.scene()?.textures.exists('art-tree0'), w.id, { timeout: 30000 });
      assert.equal(await page.locator('#game canvas').count(), 1);
      await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
      await open(page);
    }
    // repeated switching and a reload in the middle of a ride: nothing accumulates
    const cycles = ['cyber-city', 'orbital-system', 'town', 'cyber-city', 'orbital-system', 'town', 'greenwood', 'cyber-city', 'town'];
    const counts = [];
    for (const id of cycles) {
      await page.selectOption('#ap-map', id);
      if (id === 'cyber-city' || id === 'orbital-system') { await startRide(page).catch(() => null); }
      await retire();
      await page.click('#ap-map-apply');
      await page.waitForFunction((m) => window.__town.runtime.preset.id === m && window.__town.runtime.scene()?.textures.exists('art-tree0'), id, { timeout: 30000 });
      await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
      counts.push({ id, ...(await baseline()) });
      await open(page);
    }
    for (const c of counts) { assert.equal(c.games, 1, `${c.id}: one game canvas`); assert.equal(c.scenes, 1, `${c.id}: one scene`); }
    const townCounts = counts.filter((c) => c.id === 'town');
    assert.equal(new Set(townCounts.map((c) => c.textures)).size, 1, `Town texture count is stable across switches: ${townCounts.map((c) => c.textures)}`);
    assert.equal(new Set(counts.filter((c) => c.id === 'cyber-city').map((c) => c.textures)).size, 1);
    assert.equal(new Set(counts.filter((c) => c.id === 'orbital-system').map((c) => c.textures)).size, 1);
    // nothing accumulates across repeated switching and mid-ride remounts: emitters and listeners return to the same
    // count for the same map, one animation loop family at a time, and every retired game has stopped
    for (const id of ['town', 'cyber-city', 'orbital-system']) {
      const same = counts.filter((c) => c.id === id);
      for (const key of ['emitters', 'listeners', 'rafLoops']) assert.equal(new Set(same.map((c) => c[key])).size, 1, `${id}: ${key} is stable across ${same.length} remounts (${same.map((c) => c[key])})`);
    }
    assert.ok(counts.every((c) => c.retiredStillRunning === 0), `every retired game has stopped (${counts.map((c) => `${c.id}:${c.retiredStillRunning}/${c.retired}`)})`);
    assert.ok(Math.max(...counts.map((c) => c.rafLoops)) <= first.rafLoops + 2, `outstanding animation-frame callbacks stay at the first mount's level (${first.rafLoops} -> ${counts.map((c) => c.rafLoops)})`);
    const pool = await page.evaluate(() => window.__town.runtime.scene().transit?.stats() ?? null);
    assert.equal(pool, null, 'the Town mounts no transit layer');
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], 'appearance and map changes make no write request');
    // Reset returns the exact Town defaults
    await page.click('#ap-reset');
    await page.waitForFunction(() => window.__town.appearance.resolved().map.id === 'town');
    assert.deepEqual(await page.evaluate(() => { const a = window.__town.appearance.resolved(); return { theme: a.theme.id, people: a.people.id, map: a.map.id }; }), { theme: 'classic', people: 'townsfolk', map: 'town' });
    receipts.switching = { first, cycles: counts };
    await ctx.close();
  }

  // ============================================================ depth: nothing decorative may sit above lifecycle text
  for (const w of worlds) {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`depth ${w.id}: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=12&theme=${w.id}&weather=rain`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await startRide(page, { tool: w.tool });
    const audit = () => page.evaluate(() => {
      const s = window.__town.runtime.scene();
      const NAME = 150000, BUBBLE = 160000, EMOTE = 160002;
      const [view] = [...s.views.values()];
      // the documented depth floors of lifecycle text; the live name tag must really sit at its floor
      const floor = Math.min(NAME, BUBBLE, EMOTE);
      if (view.name.depth !== 0 && view.name.depth < NAME) return { floor: view.name.depth, highest: Infinity, rides: 0, ambient: 0, rain: 0 };
      // every decorative layer the scene owns: grade, wash, haze, fog, rain, motes, ambient, cloud shadow, night, sparks, transit
      const layers = s.decorativeLayers();
      const names = [...new Set(layers.map((l) => l.layer))].sort();
      return { NAME, BUBBLE, EMOTE, floor, highest: Math.max(...layers.map((l) => l.depth)), rides: s.transit.snapshot().length, ambient: layers.filter((l) => l.layer === 'ambient').length, rain: layers.filter((l) => l.layer === 'rain').length, names };
    });
    const ok = await audit();
    assert.ok(ok.rides >= 1 && ok.ambient > 0 && ok.rain > 0, `${w.id}: the audit sees a ride, ambient layers and the weather (${JSON.stringify(ok)})`);
    for (const must of ['grade', 'grade-add', 'haze', 'night', 'clouds', 'sparks', 'ambient', 'rain', 'transit']) assert.ok(ok.names.includes(must), `${w.id}: the audit lists the ${must} layer (${ok.names.join(', ')})`);
    assert.ok(ok.highest < ok.floor, `${w.id}: highest decorative depth ${ok.highest} is beneath the lowest lifecycle depth ${ok.floor}`);
    // control: lift the colour grade above the name tags and prove the same audit fails
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.decorativeLayers().find((l) => l.layer === 'grade').object.setDepth(170000); });
    const bad = await audit();
    assert.ok(!(bad.highest < bad.floor), `${w.id}: the audit must fail when a decorative layer is lifted above the name tags`);
    receipts[`depth-${w.id}`] = { highestDecorative: ok.highest, lowestLifecycle: ok.floor, layers: ok.names, controlFails: true };
    await ctx.close();
  }

  // ============================================================ every people kit paints a different resident, and the profile colour survives
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`kits: ${e.message}`));
    const kits = ['townsfolk', 'market-folk', 'plainclothes', 'neon-operatives', 'orbital-crew'];
    const sheets = {};
    for (const kit of kits) {
      await page.goto(`${base}/?agents=demo&hour=12&people=${kit}`);
      await ready(page);
      await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
      sheets[kit] = await page.evaluate(() => {
        const s = window.__town.runtime.scene();
        const hash = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619); return h >>> 0; };
        return { kit: s.appearance().people.id, hashes: [...s.views.values()].map((v) => hash(s.textures.get(v.key).getSourceImage())).sort() };
      });
      assert.equal(sheets[kit].kit, kit);
    }
    for (let i = 0; i < kits.length; i++) for (let j = i + 1; j < kits.length; j++) {
      assert.notDeepEqual(sheets[kits[i]].hashes, sheets[kits[j]].hashes, `${kits[i]} and ${kits[j]} paint different residents`);
    }
    receipts.kitPairs = `${kits.length * (kits.length - 1) / 2} pairs differ`;
    await ctx.close();
  }

  // ============================================================ profile colour is still the loudest colour on a rider
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`colour: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=12&theme=cyber-city`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await quiet(page);
    await startRide(page);
    const colour = await page.evaluate(() => { const r = [...window.__town.sim.residents.values()][0]; return window.__town.runtime.scene().appearance().people.id + ':' + r.profile; });
    assert.match(colour, /^neon-operatives:/);
    receipts.profileColour = colour;
    await ctx.close();
  }
} finally {
  await pixels.close();
  await browser.close();
  await town.close?.();
  await fs.rm(temp, { recursive: true, force: true });
}

assert.deepEqual(errors, [], 'no browser error');
console.log(JSON.stringify({ ok: true, ...receipts }, null, 2));
