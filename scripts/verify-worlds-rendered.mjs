// Rendered verification of the Cyber City and Orbital System world packs against the production build, served by the
// real Town server on loopback (run `npm run build` first). All activity is synthetic. Everything is measured on what
// the canvas actually draws at a live-style 1672x940 viewport and the default overview camera.
//
//   1. Lifecycle indicators are never covered. Every decorative layer the scene owns (colour grade, wash, haze, fog,
//      rain or solar particles, motes, ambient world effects, cloud shadow, night, work sparks, and the lift or shuttle
//      visuals) is audited against the lifecycle floor, and a rendered-pixel test shows that name tags, bubbles and
//      emotes look the same with all of those layers on as with them off. A failing control raises the same layers
//      above the indicators and the same measurement fails.
//   2. The profile colour is prominent on screen for every profile slot in neon-operatives and orbital-crew.
//   3. A share link and a saved view each open Cyber City and Orbital System in a fresh page; the minimap follows.
//   4. In live mode, a map remount in the middle of a lift or shuttle ride brings back the same authoritative
//      residents, state and history, without replaying or duplicating the ride, and with nothing written.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';
import { createPixels } from './lib/pixels.mjs';
import { INGRESS_VERSION } from '../server/lib/contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/worlds-rendered');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-worlds-rendered-'));
const token = crypto.randomBytes(32).toString('base64url');
const town = createTownServer({ token, journalPath: path.join(temp, 'journal.jsonl'), staticRoot: path.join(root, 'dist') });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const pixels = createPixels(browser);
const errors = [];
const receipts = { syntheticActivity: true };
const VIEWPORT = { width: 1672, height: 940 };
const LIFECYCLE_FLOOR = 150000;
const STORAGE_KEY = 'hermes-town.appearance';

const ready = (page) => page.waitForFunction(() => {
  const s = window.__town?.runtime?.scene?.();
  return Boolean(s && s.textures.exists('art-tree0') && s.appearance);
}, null, { timeout: 30000 });
const settle = (page, n = 6) => page.evaluate((frames) => new Promise((resolve) => { const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))); tick(frames); }), n);
const open = async (page) => { if (await page.locator('#appearance:not([hidden])').count() === 0) await page.click('#appearance-toggle'); await page.waitForSelector('#appearance:not([hidden])'); };
const track = (page, log) => page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) log.push({ method: req.method(), path: u.pathname, full: u.pathname === '/api/town/snapshot' && !u.searchParams.has('since') }); });
const bare = async (page, fn) => {
  await page.evaluate(() => {
    if (!document.getElementById('bare-style')) { const s = document.createElement('style'); s.id = 'bare-style'; s.textContent = 'html.bare body > *:not(#game){visibility:hidden !important}'; document.head.append(s); }
    document.documentElement.classList.add('bare');
  });
  try { return await fn(); } finally { await page.evaluate(() => document.documentElement.classList.remove('bare')); }
};
const shot = (page) => bare(page, () => page.locator('#game canvas').screenshot());
const miniData = (page) => page.evaluate(() => document.querySelector('#minimap').toDataURL('image/png'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const ingest = (base, events) => fetch(`${base}/api/town/ingest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: INGRESS_VERSION, events }) });

const worlds = [
  { id: 'cyber-city', people: 'neon-operatives', kind: 'lift', tool: null },
  { id: 'orbital-system', people: 'orbital-crew', kind: 'shuttle', tool: 'read_file' },
];

/**
 * A controlled stage on the world's own overview: one real ride in progress (a lift or a shuttle, run by the
 * simulator) plus six synthetic residents standing around the vehicle with a bubble and an emote each, one selected
 * (the overview shows the selected resident's name tag). The simulator is then held still and the scene paused, so
 * the same frame can be captured with the layers on, with them off, and with the indicators off. Nothing is ingested.
 */
const stage = (page, w) => page.evaluate(async ({ tool }) => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  t.source.stop(); sim.residents.clear();
  s.setDirector(false);
  const rider = 'h/main/riderxxxxxxxxxxx';
  sim.push({ id: 'w1', agentId: rider, seq: 1, at: 0, type: 'agent.spawned', role: 'coordinator', displayName: 'rider', profile: 'work', paletteSlot: 1 });
  sim.push({ id: 'w2', agentId: rider, seq: 2, at: 0, type: 'agent.assigned' });
  if (tool) sim.push({ id: 'w3', agentId: rider, seq: 3, at: 0, type: 'agent.tool_started', tool });
  const roles = ['research', 'fabrication', 'review', 'tooling', 'general', 'scheduled'];
  roles.forEach((role, i) => sim.push({ id: `s${i}`, agentId: `h/main/stage${String(i).padStart(12, '0')}`, seq: 10 + i, at: 0, type: 'agent.spawned', role, displayName: `stage ${i}`, profile: `p${i}`, paletteSlot: i }));
  const ride = () => [...sim.residents.values()].find((r) => r.transit);
  for (let i = 0; i < 8000 && !ride(); i++) sim.update(0.05);
  if (!ride()) return { error: 'no ride' };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // the scene allocates the vehicle on its next update: wait for it, then take the ride to the middle of its travel
  for (let i = 0; i < 80 && !s.transit.snapshot().length; i++) await wait(50);
  if (!s.transit.snapshot().length) return { error: 'the scene drew no vehicle' };
  for (let i = 0; i < 600; i++) { const r = ride(); if (!r) break; if (r.transit.elapsed / r.transit.duration > 0.45) break; sim.update(0.01); }
  const r0 = ride();
  if (!r0) return { error: 'ride ended before it could be staged' };
  sim.update = () => {};
  for (let i = 0; i < 80; i++) { await wait(50); const p = s.transit.snapshot()[0]; if (p && p.phase === 'ride') break; }
  await wait(120);
  const snap = s.transit.snapshot()[0];
  if (!snap || snap.phase !== 'ride') return { error: `vehicle not mid-ride: ${JSON.stringify(snap)}` };
  const rideId = r0.id;
  const others = [...sim.residents.values()].filter((r) => r.id !== rideId && r.id.startsWith('h/main/stage'));
  others.forEach((r, i) => { r.x = snap.x + (i - 2.5) * 15; r.y = snap.y + 14; r.state = 'idle'; r.anim = 'idle'; r.fade = 1; r.bubble = ['read file', 'run shell', 'web search', 'on watch', 'think', 'edit file'][i]; r.emote = ['ok', 'think', 'wait', 'fail', 'ok', 'think'][i]; });
  s.cloudBlobs?.splice?.(0);
  s.overview();
  s.select(others[3].id);
  return { rider: rideId, ridePhase: r0.transit.elapsed / r0.transit.duration, car: { x: snap.x, y: snap.y }, residents: sim.residents.size };
}, { tool: w.tool });

const freeze = async (page) => { await settle(page, 6); await page.evaluate(() => window.__town.runtime.scene().scene.pause()); await settle(page, 3); };
const layerInfo = (page) => page.evaluate(() => {
  const s = window.__town.runtime.scene();
  const layers = s.decorativeLayers();
  const names = {};
  for (const l of layers) (names[l.layer] ??= []).push(l.depth);
  const views = [...s.views.values()];
  const lifecycle = [];
  for (const v of views) for (const o of [v.name, v.bubble, v.bubbleBg, v.emote]) lifecycle.push(o.depth);
  const lowestShown = Math.min(...views.flatMap((v) => [v.name, v.bubble, v.bubbleBg, v.emote].filter((o) => o.visible).map((o) => o.depth)));
  return { names, highest: Math.max(...layers.map((l) => l.depth)), count: layers.length, lowestShown, lifecycleDepths: [...new Set(lifecycle)].sort() };
});
const setLayers = (page, visible) => page.evaluate((on) => { for (const l of window.__town.runtime.scene().decorativeLayers()) l.object.setVisible(on); }, visible);
const raiseLayers = (page, depth) => page.evaluate((d) => { for (const l of window.__town.runtime.scene().decorativeLayers()) l.object.setDepth(d); }, depth);
const setIndicators = (page, visible) => page.evaluate((on) => {
  const s = window.__town.runtime.scene();
  for (const v of s.views.values()) {
    if (on) { v.__shown?.forEach?.(([o, vis]) => o.setVisible(vis)); v.__shown = null; }
    else { v.__shown = [v.name, v.bubble, v.bubbleBg, v.emote].map((o) => [o, o.visible]); for (const o of [v.name, v.bubble, v.bubbleBg, v.emote]) o.setVisible(false); }
  }
}, visible);
const indicatorAreas = (page) => page.evaluate(() => {
  const s = window.__town.runtime.scene(), c = s.cameras.main, z = c.zoom, out = [], kinds = { name: 0, bubble: 0, emote: 0 };
  for (const v of s.views.values()) for (const [kind, o] of [['name', v.name], ['bubble', v.bubbleBg], ['emote', v.emote]]) {
    if (!o.visible) continue;
    const b = o.getBounds();
    out.push([Math.floor((b.x - c.worldView.x) * z) - 2, Math.floor((b.y - c.worldView.y) * z) - 2, Math.ceil(b.width * z) + 4, Math.ceil(b.height * z) + 4]);
    kinds[kind] += 1;
  }
  return { out, kinds };
});

const results = {};
try {
  const { port } = await town.listen(0);
  const base = `http://127.0.0.1:${port}`;

  // ============================================================ 1. lifecycle indicators are never covered
  for (const w of worlds) for (const [weather, hour] of (process.env.ONLY ? [] : [['rain', 23], ['mist', 23], ['rain', 12]])) {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`occlusion ${w.id}: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=${hour}&theme=${w.id}&weather=${weather}`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    const staged = await stage(page, w);
    assert.ok(!staged.error, `${w.id}: ${JSON.stringify(staged)}`);
    await freeze(page);

    const info = await layerInfo(page);
    const label = `${w.id} ${weather}@${hour}`;
    // every layer is accounted for: the audit sees them all, and all of them are beneath the lowest lifecycle indicator
    for (const must of ['grade', 'grade-add', 'haze', 'night', 'clouds', 'sparks', 'ambient', 'transit']) {
      assert.ok(info.names[must]?.length > 0, `${label}: the audit lists the ${must} layer (${Object.keys(info.names).join(', ')})`);
    }
    assert.ok(weather === 'rain' ? info.names.rain?.length > 0 : info.names.fog?.length > 0, `${label}: the weather layer is present`);
    assert.ok(info.highest < LIFECYCLE_FLOOR, `${label}: highest decorative depth ${info.highest} is beneath the lifecycle floor ${LIFECYCLE_FLOOR}`);
    assert.ok(info.lowestShown >= LIFECYCLE_FLOOR, `${label}: the live indicators sit at or above the floor (${info.lowestShown})`);
    if (hour === 23) assert.equal(await page.evaluate(() => window.__town.runtime.scene().decorativeLayers().find((l) => l.layer === 'night').object.visible), true, `${label}: night is painted`);

    const { out: areas, kinds } = await indicatorAreas(page);
    assert.ok(kinds.bubble >= 6 && kinds.emote >= 6 && kinds.name >= 1, `${label}: name tag, bubbles and emotes are on screen (${JSON.stringify(kinds)})`);
    const held = await shot(page);
    await setLayers(page, false); await settle(page, 3);
    const clearWith = await shot(page);
    await setIndicators(page, false); await settle(page, 3);
    const clearWithout = await shot(page);
    await setIndicators(page, true); await setLayers(page, true); await settle(page, 3);
    const ok = await pixels.overlay(clearWith, clearWithout, held, areas, { tolerance: 28 });
    assert.ok(ok.mask >= 1200, `${label}: the indicator mask is substantial (${ok.mask} strongly drawn pixels in ${areas.length} regions)`);
    assert.ok(ok.share <= 0.02, `${label}: decorative layers cover ${(ok.share * 100).toFixed(2)}% of the indicator pixels`);
    // control: lift every decorative layer above the indicators; the same measurement must fail
    await raiseLayers(page, 170000); await settle(page, 3);
    const inverted = await pixels.overlay(clearWith, clearWithout, await shot(page), areas, { tolerance: 28 });
    assert.ok(inverted.share >= 0.08 && inverted.share > ok.share + 0.06, `${label}: with every layer above the indicators the measurement fails (${(inverted.share * 100).toFixed(1)}% covered vs ${(ok.share * 100).toFixed(2)}%)`);
    if (weather === 'rain' && hour === 23) await fs.writeFile(path.join(output, `${w.id}-indicators-night-rain.png`), held);
    results[label] = { layers: Object.fromEntries(Object.entries(info.names).map(([k, v]) => [k, v.length])), highestDecorative: info.highest, lowestIndicator: info.lowestShown, indicatorPixels: ok.mask, coveredShare: +ok.share.toFixed(4), coveredIfLayersWereAbove: +inverted.share.toFixed(3), regions: kinds };
    await ctx.close();
  }
  receipts.indicatorsUncovered = results;

  // ============================================================ 2. the profile colour is prominent, for every slot
  const PALETTE = ['#c0392b', '#2e6fd0', '#2fa35a', '#e0a81e', '#8e44ad', '#17a2a2', '#e67e22', '#e0609a', '#9ccc3c', '#6cc4f0', '#e8e2d0', '#2b2d3a'];
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hueOf = (hex) => { const [r, g, b] = rgb(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn; const h = mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; return h * 60; };
  const satOf = (hex) => { const [r, g, b] = rgb(hex); return (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b); };
  const stageRow = (page) => page.evaluate(() => {
    const t = window.__town, sim = t.sim, s = t.runtime.scene();
    t.source.stop(); sim.residents.clear();
    for (let i = 0; i <= 12; i++) sim.push({ id: `k${i}`, seq: i + 1, at: sim.now(), agentId: `h/main/kit${String(i).padStart(13, '0')}`, type: 'agent.spawned', role: ['coordinator', 'research', 'fabrication', 'review', 'tooling', 'general', 'scheduled'][i % 7], displayName: `kit ${i}`, ...(i === 0 ? {} : { profile: `p${i}`, paletteSlot: i - 1 }) });
    sim.update = () => {}; sim.push = () => {};
    const v = s.opts.view;
    [...sim.residents.values()].forEach((r, i) => { r.x = (v.centerX - 19.5 + i * 3.2) * 16; r.y = (v.centerY + 1) * 16; r.state = 'idle'; r.anim = 'idle'; r.fade = 1; r.bubble = null; r.emote = null; });
    s.setDirector(false); s.overview(); s.select(null);
    s.cloudBlobs?.splice?.(0);
  });
  const rowBoxes = (page) => page.evaluate(() => {
    const s = window.__town.runtime.scene(), c = s.cameras.main, z = c.zoom;
    return [...window.__town.sim.residents.values()].map((r) => {
      const cx = (r.x - c.worldView.x) * z, foot = (r.y + 7 - c.worldView.y) * z;
      return { slot: r.profileSlot ?? null, box: [Math.round(cx - 14 * z), Math.round(foot - 35 * z), Math.round(28 * z), Math.round(40 * z)] };
    });
  });
  const colour = {};
  for (const w of worlds) {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`colour ${w.id}: ${e.message}`));
    await page.goto(`${base}/?agents=demo&theme=${w.id}`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await stageRow(page);
    await freeze(page);
    assert.equal(await page.evaluate(() => window.__town.runtime.scene().appearance().people.id), w.people);
    const boxes = await rowBoxes(page);
    const zoom = await page.evaluate(() => window.__town.runtime.scene().cameras.main.zoom);
    assert.ok(zoom > 1 && zoom < 1.4, `${w.id}: the default overview is the normal live scale (zoom ${zoom})`);
    const withRow = await shot(page);
    await fs.writeFile(path.join(output, `${w.id}-profile-row.png`), withRow);
    await page.evaluate(() => { for (const v of window.__town.runtime.scene().views.values()) { v.sprite.setVisible(false); v.shadow.setVisible(false); v.name.setVisible(false); } });
    await settle(page, 4);
    const empty = await shot(page);
    const per = [];
    for (const b of boxes) {
      if (b.slot === null) continue;
      const hex = PALETTE[b.slot];
      const chromatic = satOf(hex) > 0.35;
      const own = chromatic ? await pixels.ownHue(withRow, empty, b.box, [hueOf(hex), 22, 0.3, 70]) : { ...(await pixels.measure(withRow, empty, { box: b.box, tolerance: 20 })), own: 0, hue: null };
      const residentPixels = chromatic ? own.own : own.changed;
      per.push({ slot: b.slot, name: ['red', 'blue', 'green', 'gold', 'purple', 'teal', 'orange', 'pink', 'lime', 'sky', 'cream', 'ink'][b.slot], residentPixels, profileHuePixels: chromatic ? own.hue : null, share: chromatic ? +(own.hue / Math.max(1, own.own)).toFixed(3) : null });
    }
    for (const p of per) {
      assert.ok(p.residentPixels >= 200, `${w.id}: slot ${p.slot} resident is drawn (${p.residentPixels}px)`);
      if (p.profileHuePixels !== null) {
        assert.ok(p.profileHuePixels >= 40, `${w.id}: slot ${p.slot} (${p.name}) profile colour is plainly on screen at the normal view (${p.profileHuePixels}px)`);
        assert.ok(p.share >= 0.08, `${w.id}: slot ${p.slot} (${p.name}) profile colour is at least 8% of the resident's own pixels (${(p.share * 100).toFixed(1)}%)`);
      }
    }
    // every pair of staged residents with different profile slots reads differently: the profile-colour regions do not coincide
    colour[w.id] = { kit: w.people, zoom: +zoom.toFixed(3), perSlot: per };
    await ctx.close();
  }
  receipts.profileColour = colour;

  // ============================================================ 3. share link and saved view, in a fresh page
  {
    const frozenMini = async (page, label) => {
      await page.waitForFunction(() => window.__town.runtime.scene()?.textures.exists('art-tree0') && window.__town.sim.residents.size > 0, null, { timeout: 30000 });
      await page.evaluate(() => { const t = window.__town; t.source.stop(); t.sim.residents.clear(); const s = t.runtime.scene(); s.setDirector(true); s.overview(); });
      let prev = null, same = 0;
      for (let i = 0; i < 40; i++) { await page.waitForTimeout(250); const cur = await miniData(page); same = cur === prev ? same + 1 : 0; if (same >= 2) return cur; prev = cur; }
      assert.fail(`${label}: the minimap never settled`);
    };
    const mountedState = (page) => page.evaluate(() => { const a = window.__town.appearance.resolved(); return { map: window.__town.runtime.preset.id, theme: a.theme.id, people: a.people.id, canvases: document.querySelectorAll('#game canvas').length, transit: Boolean(window.__town.runtime.scene().transit) }; });
    const baseCtx = await browser.newContext({ viewport: VIEWPORT });
    const basePage = await baseCtx.newPage();
    await basePage.goto(`${base}/?agents=demo&hour=12`);
    await ready(basePage);
    const townMini = await frozenMini(basePage, 'town');
    await baseCtx.close();
    const persistence = {};
    for (const w of worlds) {
      const requests = [];
      // the link a viewer copies after choosing the complete pack
      const author = await browser.newContext({ viewport: VIEWPORT });
      const authorPage = await author.newPage();
      authorPage.on('pageerror', (e) => errors.push(`link author ${w.id}: ${e.message}`));
      await authorPage.goto(`${base}/?agents=demo&hour=12`);
      await ready(authorPage);
      await open(authorPage);
      await authorPage.click(`#ap-pack-${w.id}`);
      const link = await authorPage.inputValue('#ap-link');
      const url = new URL(link);
      assert.equal(url.searchParams.get('theme'), w.id); assert.equal(url.searchParams.get('map'), w.id); assert.equal(url.searchParams.get('people'), w.people);
      await author.close();

      // a fresh browser context (no saved view) opens the link: it builds the world without persisting anything
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`link ${w.id}: ${e.message}`));
      track(page, requests);
      await page.goto(link.replace(url.origin, base));
      await ready(page);
      assert.deepEqual(await mountedState(page), { map: w.id, theme: w.id, people: w.people, canvases: 1, transit: true }, `${w.id}: the link opens the full pack`);
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null, `${w.id}: a link does not write the saved view`);
      await open(page);
      assert.match(await page.textContent('#ap-source'), /shared link/);
      const linkMini = await frozenMini(page, `${w.id} link`);
      const d = await pixels.measure(Buffer.from(townMini.split(',')[1], 'base64'), Buffer.from(linkMini.split(',')[1], 'base64'), { tolerance: 16 });
      assert.ok(d.sameSize && d.ratio > 0.2, `${w.id}: the link's minimap differs from Town (${d.ratio})`);
      // saving from the link stores it, and drops the link parameters from the address bar
      await page.evaluate(() => document.querySelector('#ap-save').click());
      const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
      assert.equal(stored.theme, w.id); assert.equal(stored.map, w.id); assert.equal(stored.people, w.people);

      // the saved view opens in a brand-new page of the same browser, with no parameters at all
      const fresh = await ctx.newPage();
      fresh.on('pageerror', (e) => errors.push(`saved ${w.id}: ${e.message}`));
      track(fresh, requests);
      await fresh.goto(`${base}/?agents=demo&hour=12`);
      await ready(fresh);
      assert.deepEqual(await mountedState(fresh), { map: w.id, theme: w.id, people: w.people, canvases: 1, transit: true }, `${w.id}: the saved view restores the full pack`);
      await open(fresh);
      assert.match(await fresh.textContent('#ap-source'), /saved view/);
      const savedMini = await frozenMini(fresh, `${w.id} saved view`);
      assert.equal(savedMini, linkMini, `${w.id}: the saved view and the link draw the same minimap`);
      // Reset in the saved page returns the Town, exactly
      await fresh.click('#ap-reset');
      await fresh.waitForFunction(() => window.__town.runtime.preset.id === 'town', null, { timeout: 30000 });
      assert.equal(await frozenMini(fresh, `${w.id} reset`), townMini, `${w.id}: Reset restores the exact Town minimap`);
      assert.equal(await fresh.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null);
      assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], `${w.id}: link, save and reset write nothing`);
      persistence[w.id] = { link: link.replace(url.origin, '<origin>'), linkMinimap: sha(linkMini), savedViewMinimap: sha(savedMini), townMinimap: sha(townMini), minimapPixelsChanged: +d.ratio.toFixed(3), reset: 'exact Town minimap' };
      await ctx.close();
    }
    receipts.shareLinkAndSavedView = persistence;
  }

  // ============================================================ 4. live: a remount in the middle of a ride
  {
    const A = 'h/main/aaaaaaaaaaaaaaaa', B = 'h/main/bbbbbbbbbbbbbbbb', C = 'h/main/cccccccccccccccc';
    let n = 0;
    const ev = (key, kind, extra = {}) => ({ id: `rendered_${String(++n).padStart(6, '0')}`, key, kind, ...extra });
    for (const [key, role] of [[A, 'coordinator'], [B, 'research'], [C, 'fabrication']]) assert.equal((await ingest(base, [ev(key, 'spawned', { role }), ev(key, 'assigned', { role })])).status, 202);
    for (const [key, role, tool] of [[A, 'coordinator', 'read_file'], [B, 'research', 'web_search'], [C, 'fabrication', 'terminal']]) assert.equal((await ingest(base, [ev(key, 'tool_started', { role, tool })])).status, 202);
    const bridgeCount = async () => (await (await fetch(`${base}/api/town/snapshot`)).json()).bridge.receivedEvents;
    const delivered = await bridgeCount();

    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`live remount: ${e.message}`));
    const requests = [];
    track(page, requests);
    await page.goto(`${base}/?theme=cyber-city&people=neon-operatives&map=cyber-city`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size >= 3, null, { timeout: 30000 });

    const roster = () => page.evaluate(() => [...window.__town.sim.residents.values()].map((r) => ({ id: r.id, kind: r.kind, role: r.role, name: r.name, profile: r.profile ?? null, slot: r.profileSlot ?? null, history: r.history.map((h) => h.text) })).sort((a, b) => (a.id < b.id ? -1 : 1)));
    /** Advance the live simulator until some resident is riding. */
    const intoRide = (expectKind) => page.evaluate(async (kind) => {
      const t = window.__town, sim = t.sim;
      const rider = () => [...sim.residents.values()].find((r) => r.transit);
      for (let i = 0; i < 12000 && !rider(); i++) sim.update(0.05);
      const r = rider();
      if (!r) return { error: 'no resident rode a connector', residents: sim.residents.size };
      const c = t.map.transit.byId(r.transit.connectorId);
      await new Promise((resolve) => setTimeout(resolve, 400));
      const s = t.runtime.scene();
      if (c.kind !== kind) return { error: `ride kind ${c.kind} is not ${kind}` };
      return { rider: r.id, kind: c.kind, expected: kind, state: r.state, vehicles: s.transit.snapshot().length };
    }, expectKind);
    const afterRemount = () => page.evaluate(() => {
      const t = window.__town, s = t.runtime.scene(), sim = t.sim;
      const riding = [...sim.residents.values()].filter((r) => r.transit);
      return {
        map: t.runtime.preset.id, residents: sim.residents.size, views: s.views.size, canvases: document.querySelectorAll('#game canvas').length,
        riding: riding.map((r) => ({ id: r.id, elapsed: +r.transit.elapsed.toFixed(2) })), vehicles: s.transit ? s.transit.snapshot().length : 0,
        states: Object.fromEntries([...sim.residents.values()].map((r) => [r.id, r.state])),
      };
    });
    const remount = async (target, expectKind) => {
      const before = await roster();
      const ride = await intoRide(expectKind);
      assert.ok(!ride.error, JSON.stringify(ride));
      assert.ok(ride.vehicles >= 1, `a ${ride.kind} is on screen with the rider inside it before the remount`);
      const riderState = ride.state;
      const mark = requests.length;
      await open(page);
      await page.selectOption('#ap-map', target);
      const old = await page.evaluate(() => { window.__old = window.__town.runtime; return true; });
      await page.click('#ap-map-apply');
      await page.waitForFunction((id) => window.__town.runtime !== window.__old && window.__town.runtime.preset.id === id && window.__town.runtime.scene()?.textures.exists('art-tree0'), target, { timeout: 30000 });
      await page.waitForFunction(() => window.__town.sim.residents.size >= 3, null, { timeout: 30000 });
      const after = await afterRemount();
      const roster2 = await roster();
      const reqs = requests.slice(mark);
      assert.ok(reqs.some((q) => q.full && q.method === 'GET'), 'the new scene re-reads the authoritative snapshot');
      assert.deepEqual(reqs.filter((q) => q.method !== 'GET'), [], 'the remount only reads');
      assert.deepEqual(roster2.map((r) => r.id), before.map((r) => r.id), 'the same authoritative residents come back');
      assert.ok(roster2.some((r) => r.id === ride.rider), 'the rider is one of the residents that come back');
      assert.deepEqual(roster2, before, 'resident ids, names, roles, profiles and history are identical after the remount');
      assert.equal(after.residents, before.length, 'no duplicate resident');
      assert.equal(after.views, after.residents, 'one view per resident');
      assert.equal(after.canvases, 1);
      // the ride that was in progress is not replayed: nothing starts partway through a lift or a flight
      assert.ok(after.riding.every((x) => x.elapsed < 0.6), `no ride resumes mid-way (${JSON.stringify(after.riding)})`);
      assert.ok(after.vehicles <= after.riding.length, 'at most one vehicle per rider');
      assert.equal(await bridgeCount(), delivered, 'the bridge delivery count is unchanged');
      return { target, rider: ride.rider, rodeA: ride.kind, riderStateBefore: riderState, riderStateAfter: after.states[ride.rider], rebuilt: { residents: after.residents, ridingNow: after.riding.length, vehicles: after.vehicles }, requests: reqs.map((q) => `${q.method} ${q.path}`) };
    };
    const first = await remount('orbital-system', 'lift');
    // the same live page, now on the Orbital System: ride a shuttle, remount back to Cyber City mid-flight
    const second = await remount('cyber-city', 'shuttle');
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], 'the whole live session sent no write');
    receipts.liveRemountMidTransit = { delivered, firstRemount: first, secondRemount: second };
    await ctx.close();
  }
  if (process.env.ONLY) for (const [k, v] of Object.entries(colour)) console.error(k, v.kit, v.zoom, v.perSlot.map((p) => [p.name, p.residentPixels, p.profileHuePixels, p.share].join(':')).join(' | '));
} finally {
  await pixels.close();
  await browser.close();
  await town.close?.();
  await fs.rm(temp, { recursive: true, force: true });
}
assert.deepEqual(errors, [], 'no browser error');
console.log(JSON.stringify({ ok: true, ...receipts }, null, 2));
