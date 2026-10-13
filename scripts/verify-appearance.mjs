// Appearance browser verification, against the production build served by the
// real Town server on loopback (run `npm run build` first). All events are
// synthetic fixtures.
//
// Exercises, in a real browser:
//   - the Appearance entry point: keyboard open/close, focus, no overlap with core controls;
//   - live preview of theme, people, time, weather and motion with the simulator,
//     the event source and the residents untouched (same objects, same ids);
//   - Save as my view, reload persistence, Reset;
//   - Copy share link, loading a link without persisting it, invalid-link fallback;
//   - prefers-reduced-motion by default, explicit override, and resident animation
//     still advancing under reduced motion;
//   - a map switch in demo mode: the notice, no change until asked, then a scene reload;
//   - live mode: a visual change makes no request and does not touch the bridge; a map
//     switch re-reads the snapshot, keeps the same residents, and sends nothing;
//   - disconnected live: appearance changes manufacture no residents and no delivery claim.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';
import { INGRESS_VERSION } from '../server/lib/contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/appearance');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-appearance-'));
const token = crypto.randomBytes(32).toString('base64url');
const town = createTownServer({ token, journalPath: path.join(temp, 'journal.jsonl'), staticRoot: path.join(root, 'dist') });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const receipts = { syntheticActivity: true };
const STORAGE_KEY = 'hermes-town.appearance';

const ready = (page) => page.waitForFunction(() => {
  const s = window.__town?.runtime?.scene?.();
  return Boolean(s && s.textures.exists('art-tree0') && s.appearance);
}, null, { timeout: 30000 });
const settle = (page, n = 3) => page.evaluate((frames) => new Promise((resolve) => {
  const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
  tick(frames);
}), n);
const open = async (page) => { await page.click('#appearance-toggle'); await page.waitForSelector('#appearance:not([hidden])'); };
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
const overlaps = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
const resolved = (page) => page.evaluate(() => {
  const a = window.__town.runtime.scene().appearance();
  return { theme: a.theme.id, people: a.people.id, map: a.map.id, reduced: a.environment.reducedMotion, rain: a.environment.rain, weather: a.environment.weather, hour: a.environment.hour, motes: a.environment.motes !== null, windSway: a.environment.windSway, particleRate: a.environment.particleRate };
});
const track = (page, log) => page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) log.push({ method: req.method(), path: u.pathname, full: u.pathname === '/api/town/snapshot' && !u.searchParams.has('since') }); });
const ingest = (base, events) => fetch(`${base}/api/town/ingest`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: INGRESS_VERSION, events }) });
let serial = 0;
const ev = (key, kind, extra = {}) => ({ id: `appearance_${String(++serial).padStart(6, '0')}`, key, kind, ...extra });

try {
  const { port } = await town.listen(0);
  const base = `http://127.0.0.1:${port}`;

  // ============================================================ demo mode
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`demo: ${e.message}`));
    await page.goto(`${base}/?agents=demo`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });

    // --- entry point, keyboard, focus, overlap
    assert.equal(await page.locator('#appearance').isHidden(), true);
    await page.focus('#appearance-toggle');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#appearance:not([hidden])');
    assert.equal(await page.getAttribute('#appearance-toggle', 'aria-expanded'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'appearance-title', 'focus moves into the drawer');
    for (const viewport of [{ width: 1672, height: 940 }, { width: 1366, height: 768 }, { width: 1024, height: 700 }]) {
      await page.setViewportSize(viewport);
      await settle(page);
      const drawer = await rect(page, '#appearance');
      for (const sel of ['#controls', '#masthead', '#minimap']) assert.equal(overlaps(drawer, await rect(page, sel)), false, `drawer overlaps ${sel} at ${viewport.width}x${viewport.height}`);
      assert.ok(drawer.right <= viewport.width && drawer.y >= 0, 'drawer stays on screen');
    }
    await page.setViewportSize({ width: 1672, height: 940 });
    for (const name of ['Town view', 'Library', 'Follow: off', 'Director: on']) assert.equal(await page.getByRole('button', { name, exact: true }).isVisible(), true, `${name} still reachable`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#appearance', { state: 'hidden' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'appearance-toggle', 'focus returns to the entry point');
    receipts.entryPoint = 'keyboard open/close, focus, no overlap at 3 viewports';
    await open(page);

    // --- the default is Classic, unchanged
    assert.deepEqual(await resolved(page), { theme: 'classic', people: 'townsfolk', map: 'town', reduced: false, rain: false, weather: 'clear', hour: null, motes: false, windSway: 1, particleRate: 1 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ht-page').trim()), '#14111a');
    await page.screenshot({ path: path.join(output, 'classic.png') });

    // --- live preview leaves the simulator, source and residents alone
    await page.evaluate(() => {
      const t = window.__town;
      window.__ref = { sim: t.sim, source: t.source, game: t.game, map: t.map, runtime: t.runtime, ids: [...t.sim.residents.keys()], eventsSeen: t.sim.residents.size };
    });
    const still = () => page.evaluate(() => {
      const t = window.__town, r = window.__ref;
      return { sim: t.sim === r.sim, source: t.source === r.source, game: t.game === r.game, map: t.map === r.map, runtime: t.runtime === r.runtime, kept: r.ids.every((id) => t.sim.residents.has(id) || t.sim.residents.get(id)?.state === 'gone') };
    });
    // keyboard on the theme radios: arrow to the next card
    await page.focus('#ap-themes input[value="classic"]');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => window.__town.runtime.scene().appearance().theme.id === 'night-market');
    await settle(page, 6);
    assert.deepEqual(await resolved(page), { theme: 'night-market', people: 'market-folk', map: 'town', reduced: false, rain: false, weather: 'clear', hour: 23, motes: true, windSway: 0.7, particleRate: 1 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ht-page').trim()), '#0f0b1e');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(15, 11, 30)');
    assert.deepEqual(await still(), { sim: true, source: true, game: true, map: true, runtime: true, kept: true });
    await page.screenshot({ path: path.join(output, 'night-market.png') });
    receipts.themePreview = 'Night Market previews live; sim, source, game and map are the same objects';

    // people kit
    await page.selectOption('#ap-people', 'plainclothes');
    await settle(page, 6);
    const keys = await page.evaluate(() => [...window.__town.runtime.scene().views.values()].map((v) => v.key));
    assert.ok(keys.length > 0 && keys.every((k) => k.endsWith('-pc')), `sprites use the plain kit: ${keys.slice(0, 3)}`);
    assert.deepEqual(await still(), { sim: true, source: true, game: true, map: true, runtime: true, kept: true });
    // a profile resident keeps its profile colour slot and its legend chip under every kit
    await page.evaluate(() => {
      const sim = window.__town.sim;
      sim.push({ id: 'ap-profile-1', agentId: 'h/main/profiletest000001', seq: 1, at: sim.now(), type: 'agent.spawned', role: 'coordinator', displayName: 'profile probe', profile: 'work', paletteSlot: 1 });
    });
    await page.waitForFunction(() => document.querySelector('#legend .chip')?.textContent?.includes('work'));
    for (const kit of ['market-folk', 'plainclothes', 'townsfolk']) {
      await page.selectOption('#ap-people', kit);
      await page.waitForFunction(() => [...window.__town.runtime.scene().views.keys()].includes('h/main/profiletest000001'));
      const view = await page.evaluate(() => window.__town.runtime.scene().views.get('h/main/profiletest000001').key);
      assert.match(view, /-p1(-|$)/, `${kit}: profile slot survives in ${view}`);
      assert.match(await page.textContent('#legend'), /work · 1/);
    }
    await page.selectOption('#ap-people', 'theme');
    await page.evaluate(() => window.__town.sim.push({ id: 'ap-profile-2', agentId: 'h/main/profiletest000001', seq: 2, at: window.__town.sim.now(), type: 'agent.departed' }));

    // time and weather
    await page.selectOption('#ap-time', 'noon');
    assert.equal((await resolved(page)).hour, 13);
    await page.selectOption('#ap-weather', 'rain');
    assert.equal((await resolved(page)).rain, true);
    await settle(page, 6);
    await page.screenshot({ path: path.join(output, 'night-market-noon-rain.png') });
    receipts.visualPreview = 'people, time, weather previewed live; profile slot and legend survive every kit';

    // --- reduced motion: explicit choice, and decoration drops while rain streaks stop
    await page.selectOption('#ap-motion', 'reduced');
    let r = await resolved(page);
    assert.equal(r.reduced, true); assert.equal(r.rain, false); assert.equal(r.weather, 'rain'); assert.ok(r.windSway < 0.7); assert.ok(r.particleRate < 1); assert.equal(r.motes, false);
    assert.match(await page.textContent('#ap-motion-hint'), /Residents move normally/);
    await page.selectOption('#ap-motion', 'full');
    r = await resolved(page);
    assert.equal(r.reduced, false); assert.equal(r.rain, true);
    assert.deepEqual(await still(), { sim: true, source: true, game: true, map: true, runtime: true, kept: true });

    // --- save, reload, reset
    await page.selectOption('#ap-weather', 'mist');
    await page.click('#ap-save');
    assert.match(await page.textContent('#ap-status'), /Saved as your view/);
    const stored = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
    assert.deepEqual(stored, { v: 1, theme: 'night-market', people: 'theme', map: 'theme', time: 'noon', weather: 'mist', motion: 'full' });
    await page.reload();
    await ready(page);
    r = await resolved(page);
    assert.equal(r.theme, 'night-market'); assert.equal(r.weather, 'mist'); assert.equal(r.hour, 13);
    await open(page);
    assert.match(await page.textContent('#ap-source'), /saved view/);
    // the saved view is local to this browser context
    await page.click('#ap-reset');
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null);
    assert.deepEqual(await resolved(page), { theme: 'classic', people: 'townsfolk', map: 'town', reduced: false, rain: false, weather: 'clear', hour: null, motes: false, windSway: 1, particleRate: 1 });
    assert.match(await page.textContent('#ap-source'), /built-in default/);
    receipts.persistence = 'save, reload, and reset verified against localStorage';

    // --- share link round trip, loaded without being persisted
    await page.locator('#ap-themes label.card', { hasText: 'Night Market' }).click();
    await page.selectOption('#ap-weather', 'mist');
    await page.selectOption('#ap-motion', 'reduced');
    await page.selectOption('#ap-people', 'plainclothes');
    const link = await page.inputValue('#ap-link');
    assert.equal(link, `${base}/?agents=demo&theme=night-market&people=plainclothes&weather=mist&motion=reduced`);
    assert.equal(new URL(link).hostname, '127.0.0.1');
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.click('#ap-copy');
    await page.waitForFunction(() => /Share link copied/.test(document.querySelector('#ap-status').textContent));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link);
    const shared = await ctx.newPage();
    shared.on('pageerror', (e) => errors.push(`shared: ${e.message}`));
    await shared.goto(link);
    await ready(shared);
    assert.deepEqual(await resolved(shared), { theme: 'night-market', people: 'plainclothes', map: 'town', reduced: true, rain: false, weather: 'mist', hour: 23, motes: false, windSway: 0.7 * 0.15, particleRate: 0.3 });
    assert.equal(await shared.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null, 'a link does not write the viewer\'s saved view');
    await open(shared);
    assert.match(await shared.textContent('#ap-source'), /shared link/);
    // saving from a link persists it and drops the link parameters from the address bar
    await shared.click('#ap-save');
    assert.equal(new URL(shared.url()).searchParams.has('theme'), false);
    assert.equal(new URL(shared.url()).searchParams.get('agents'), 'demo');
    assert.equal(JSON.parse(await shared.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).theme, 'night-market');
    await shared.close();
    receipts.shareLink = link.replace(base, '<origin>');

    // --- invalid values fall back safely and visibly
    await page.evaluate((k) => localStorage.removeItem(k), STORAGE_KEY);
    const bad = await ctx.newPage();
    bad.on('pageerror', (e) => errors.push(`invalid: ${e.message}`));
    await bad.goto(`${base}/?agents=demo&theme=%3Cscript%3E&people=wizard&map=../../etc&time=25&weather=snow&motion=wild`);
    await ready(bad);
    assert.deepEqual(await resolved(bad), { theme: 'classic', people: 'townsfolk', map: 'town', reduced: false, rain: false, weather: 'clear', hour: null, motes: false, windSway: 1, particleRate: 1 });
    assert.equal(await bad.locator('#appearance-banner').isVisible(), true);
    assert.match(await bad.textContent('#appearance-banner'), /not supported \(theme, people, map, time, weather, motion\)/);
    await bad.screenshot({ path: path.join(output, 'invalid-link.png') });
    await bad.goto(`${base}/?agents=demo&theme=night-market&weather=hail`);
    await ready(bad);
    assert.equal((await resolved(bad)).theme, 'night-market');
    assert.equal((await resolved(bad)).weather, 'clear');
    await bad.close();
    receipts.invalidFallback = 'unknown values fall back per field with a visible notice and no page error';

    // --- map switch: notice first, nothing changes until asked, then the scene reloads
    await page.reload();
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await open(page);
    await page.selectOption('#ap-map', 'greenwood');
    assert.equal(await page.locator('#ap-map-note').isVisible(), true);
    assert.match(await page.textContent('#ap-map-note'), /reloads the renderer scene/);
    assert.match(await page.textContent('#ap-map-note'), /Hermes and its bridge keep running/);
    await page.evaluate(() => { window.__before = { map: window.__town.map, sim: window.__town.sim, runtime: window.__town.runtime }; });
    await settle(page, 4);
    assert.equal(await page.evaluate(() => window.__town.map === window.__before.map && window.__town.runtime === window.__before.runtime), true, 'choosing a map alone does not reload');
    await page.click('#ap-map-apply');
    await page.waitForFunction(() => window.__town.runtime !== window.__before.runtime && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__town.runtime.preset.id), 'greenwood');
    assert.equal(await page.evaluate(() => window.__town.map !== window.__before.map), true);
    await page.waitForFunction(() => document.querySelectorAll('#game canvas').length === 1);
    assert.equal(await page.locator('#ap-map-note').isVisible(), false);
    assert.match(await page.textContent('#status'), /scripted demo/);
    await settle(page, 6);
    await page.screenshot({ path: path.join(output, 'greenwood.png') });
    receipts.mapSwitchDemo = 'greenwood: notice, no reload until requested, one canvas after';
    await ctx.close();
  }

  // ===================================================== reduced-motion default
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`reduced: ${e.message}`));
    await page.goto(`${base}/?agents=demo`);
    await ready(page);
    let r = await resolved(page);
    assert.equal(r.reduced, true, 'prefers-reduced-motion is honoured by default');
    await open(page);
    assert.equal(await page.inputValue('#ap-motion'), 'system');
    await page.selectOption('#ap-motion', 'full');
    assert.equal((await resolved(page)).reduced, false, 'the in-panel choice overrides the system preference');
    await page.selectOption('#ap-motion', 'system');
    assert.equal((await resolved(page)).reduced, true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => window.__town.runtime.scene().appearance().environment.reducedMotion === false);
    receipts.reducedMotion = 'system default, explicit override, and live media-query change verified';
    await ctx.close();
  }

  // ================================================================ live mode
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`live: ${e.message}`));
    const requests = [];
    track(page, requests);
    const A = 'h/main/aaaaaaaaaaaaaaaa', B = 'h/main/bbbbbbbbbbbbbbbb';
    for (const [key, role] of [[A, 'coordinator'], [B, 'research']]) {
      assert.equal((await ingest(base, [ev(key, 'spawned', { role }), ev(key, 'assigned', { role })])).status, 202);
    }
    assert.equal((await ingest(base, [ev(A, 'tool_started', { role: 'coordinator', tool: 'read_file' })])).status, 202);
    await page.goto(base);
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Hermes events received'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__town.sim.residents.size >= 2);
    const bridgeCount = async () => (await (await fetch(`${base}/api/town/snapshot`)).json()).bridge.receivedEvents;
    const delivered = await bridgeCount();
    assert.ok(delivered >= 5);
    const idsBefore = await page.evaluate(() => [...window.__town.sim.residents.keys()].sort());
    await page.evaluate(() => { const t = window.__town; window.__live = { sim: t.sim, source: t.source, runtime: t.runtime }; });
    const statusBefore = await page.textContent('#status');

    // resident animation continues under reduced motion: a working runner keeps changing frames
    const frames = new Set();
    for (let i = 0; i < 24; i++) {
      frames.add(await page.evaluate(() => { const s = window.__town.runtime.scene(); return [...s.views.values()].map((v) => v.sprite.frame.name).join(','); }));
      await page.waitForTimeout(150);
    }
    assert.ok(frames.size > 1, 'resident animation still advances with reduced motion on');
    assert.equal((await resolved(page)).reduced, true);

    // visual change: no network, same simulator and source, same delivery count
    const mark = requests.length;
    await open(page);
    await page.locator('#ap-themes label.card', { hasText: 'Night Market' }).click();
    await page.selectOption('#ap-weather', 'mist');
    await page.selectOption('#ap-people', 'market-folk');
    await settle(page, 8);
    // The source's own stall watch may poll incrementally on its timer; an appearance change must not
    // open a stream, re-read a full snapshot, or write anything.
    assert.deepEqual(requests.slice(mark).filter((q) => q.method !== 'GET' || q.path === '/api/town/events' || q.full), [], 'a visual change makes no stream, full-snapshot or write request');
    assert.equal(await page.evaluate(() => window.__town.sim === window.__live.sim && window.__town.source === window.__live.source && window.__town.runtime === window.__live.runtime), true);
    assert.deepEqual(await page.evaluate(() => [...window.__town.sim.residents.keys()].sort()), idsBefore);
    assert.equal(await bridgeCount(), delivered, 'appearance changes send nothing to the bridge');
    assert.equal(await page.textContent('#status').then((t) => t.replace(/last event \S+ ago/, '')), statusBefore.replace(/last event \S+ ago/, ''), 'status copy is unchanged');
    await page.screenshot({ path: path.join(output, 'live-night-market.png') });

    // map switch: re-read the snapshot, same residents, nothing sent, bridge untouched
    await page.selectOption('#ap-map', 'greenwood');
    const before = requests.length;
    await page.click('#ap-map-apply');
    await page.waitForFunction(() => window.__town.runtime !== window.__live.runtime && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Hermes events received'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__town.sim.residents.size >= 2);
    const after = requests.slice(before);
    assert.ok(after.some((q) => q.full && q.method === 'GET'), 'the new scene re-reads the full snapshot');
    assert.ok(after.every((q) => q.method === 'GET'), 'a scene reload only reads');
    assert.ok(after.every((q) => q.path !== '/api/town/ingest'));
    assert.deepEqual(await page.evaluate(() => [...window.__town.sim.residents.keys()].sort()), idsBefore, 'the same residents are back');
    assert.equal(await page.evaluate(() => window.__town.sim !== window.__live.sim && window.__town.source !== window.__live.source), true, 'a new simulator is built on the new grid');
    assert.equal(await bridgeCount(), delivered, 'the bridge delivery count is unchanged by the reload');
    assert.equal(await page.evaluate(() => window.__town.source.bridge().receivedEvents), delivered);
    assert.equal(await page.evaluate(() => window.__town.runtime.preset.id), 'greenwood');
    assert.equal((await page.evaluate(() => window.__town.runtime.scene().appearance().theme.id)), 'night-market');
    await settle(page, 6);
    await page.screenshot({ path: path.join(output, 'live-greenwood.png') });
    receipts.liveContinuity = { delivered, residents: idsBefore.length, reloadRequests: after.map((q) => `${q.method} ${q.path}`) };
    await ctx.close();
  }


  // ===================================================== operator build default
  {
    // The only Town-wide default is a build-time setting. Build a second copy with one and serve it.
    const { build } = await import('vite');
    const outDir = path.join(temp, 'dist-host-default');
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true, sourcemap: false }, define: { 'import.meta.env.VITE_DEFAULT_APPEARANCE': JSON.stringify('theme=night-market&weather=mist') } });
    const hostTown = createTownServer({ token, journalPath: path.join(temp, 'host-journal.jsonl'), staticRoot: outDir });
    try {
      const { port: hostPort } = await hostTown.listen(0);
      const hostBase = `http://127.0.0.1:${hostPort}`;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`host: ${e.message}`));
      await page.goto(`${hostBase}/?agents=demo`);
      await ready(page);
      let r = await resolved(page);
      assert.equal(r.theme, 'night-market'); assert.equal(r.weather, 'mist');
      await open(page);
      assert.match(await page.textContent('#ap-source'), /Town.s default look/);
      // a viewer's saved view beats the host default, and reset returns to it
      await page.locator('#ap-themes label.card', { hasText: 'Classic' }).click();
      await page.click('#ap-save');
      await page.reload();
      await ready(page);
      assert.equal((await resolved(page)).theme, 'classic');
      await open(page);
      await page.click('#ap-reset');
      assert.equal((await resolved(page)).theme, 'night-market');
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY), null);
      // an ordinary viewer cannot change the host default: nothing was written to the server
      assert.deepEqual((await (await fetch(`${hostBase}/api/town/health`)).json()).appearance, undefined);
      receipts.hostDefault = 'build-time default applies, saved view overrides it, reset returns to it';
      await ctx.close();
    } finally { await hostTown.close(); }
  }

  // ====================================================== disconnected live
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push(`offline: ${e.message}`));
    await page.route('**/api/**', (route) => route.abort());
    await page.goto(base);
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('disconnected'), null, { timeout: 30000 });
    await open(page);
    await page.locator('#ap-themes label.card', { hasText: 'Night Market' }).click();
    await page.selectOption('#ap-weather', 'rain');
    await page.selectOption('#ap-map', 'greenwood');
    await page.click('#ap-map-apply');
    await page.waitForFunction(() => window.__town.runtime.preset.id === 'greenwood' && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('disconnected'), null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__town.sim.residents.size), 0, 'no residents are manufactured');
    assert.match(await page.textContent('#status'), /disconnected/);
    assert.doesNotMatch(await page.textContent('#status'), /Hermes events received/);
    assert.equal(await page.locator('#connection-help').isVisible(), true);
    await page.screenshot({ path: path.join(output, 'disconnected.png') });
    receipts.disconnected = 'appearance and map changes keep zero residents and a disconnected status';
    await page.close();
  }

  assert.deepEqual(errors, []);
  receipts.browserErrors = errors;
  receipts.ok = true;
  await fs.writeFile(path.join(output, 'results.json'), `${JSON.stringify(receipts, null, 2)}\n`);
  console.log(JSON.stringify(receipts, null, 2));
} finally {
  await browser.close();
  await town.close();
  await fs.rm(temp, { recursive: true, force: true });
}
