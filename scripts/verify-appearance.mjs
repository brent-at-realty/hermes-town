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

// ---- rendered-difference helpers: these read what is actually drawn, not the resolved state.
let calc = null;
const imageDiff = async (a, b, tolerance = 24) => {
  calc ??= await browser.newPage();
  return calc.evaluate(async ([x, y, tol]) => {
    const load = (b64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); resolve(g.getImageData(0, 0, img.width, img.height)); };
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
    const A = await load(x), B = await load(y);
    if (A.width !== B.width || A.height !== B.height) return { ratio: 1, sameSize: false };
    let n = 0;
    for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) > tol || Math.abs(A.data[i + 1] - B.data[i + 1]) > tol || Math.abs(A.data[i + 2] - B.data[i + 2]) > tol) n += 1;
    return { ratio: n / (A.width * A.height), sameSize: true };
  }, [a.toString('base64'), b.toString('base64'), tolerance]);
};
/** What each rendered resident's sprite sheet actually contains, by resident id. */
const artState = (page) => page.evaluate(() => {
  const s = window.__town.runtime.scene();
  const hash = (data) => { let h = 2166136261; for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619); return h >>> 0; };
  const out = {};
  for (const [id, v] of s.views) {
    const img = s.textures.get(v.key).getSourceImage();
    const g = img.getContext('2d');
    const idle = g.getImageData(0, 80, 32, 40).data; // frame 32: idle, facing down
    const count = (r, gr, b) => { let n = 0; for (let i = 0; i < idle.length; i += 4) if (idle[i] === r && idle[i + 1] === gr && idle[i + 2] === b && idle[i + 3] === 255) n += 1; return n; };
    const profileBlue = count(46, 111, 208);
    // exact kit colours on the sprite: the plume and hat of Market folk, the linen collar of Plain clothes
    const marks = { plume: count(0xd6, 0x45, 0x6a), marketHat: count(0x3a, 0x25, 0x48), linen: count(0xe6, 0xdc, 0xc4), gold: count(0xd9, 0xb3, 0x4a) };
    out[id] = { key: v.key, sheet: hash(g.getImageData(0, 0, img.width, img.height).data), idle: hash(idle), profileBlue, marks };
  }
  return out;
});
/** The identity-and-history facts a theme must never change. */
const residentFacts = (page) => page.evaluate(() => [...window.__town.sim.residents.values()].map((r) => ({
  id: r.id, kind: r.kind, role: r.role, name: r.name, parentId: r.parentId, profile: r.profile, profileSlot: r.profileSlot,
  home: r.home.label, history: r.history.map((h) => h.text), lifecycleState: r.state === 'gone' ? 'gone' : 'present',
})).sort((a, b) => (a.id < b.id ? -1 : 1)));
/** A structural signature of the mounted map. */
const mapState = (page) => page.evaluate(() => {
  const t = window.__town, m = t.map, { w, h, cost } = m.grid;
  const hash = (list) => { let x = 2166136261; for (const n of list) x = Math.imul(x ^ n, 16777619); return x >>> 0; };
  const ground = hash(m.ground.flat());
  const props = hash(m.props.flatMap((p) => [p.x, p.y, p.variant ?? 0, p.kind.length]));
  const seen = new Uint8Array(w * h), queue = [m.entrance.y * w + m.entrance.x];
  seen[queue[0]] = 1;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i], x = c % w, y = Math.floor(c / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || cost[ny * w + nx] === 0) continue;
      seen[ny * w + nx] = 1; queue.push(ny * w + nx);
    }
  }
  const at = (p) => seen[p.y * w + p.x] === 1;
  const buildings = [...m.buildings, ...m.homes];
  return {
    preset: t.runtime.preset.id, ground, props, trees: m.props.filter((p) => p.kind === 'tree').length, hedges: m.props.filter((p) => p.kind === 'hedge').length,
    unreachable: [...m.stations.filter((s) => !at(s.tile)).map((s) => s.id), ...buildings.filter((b) => !at(b.door)).map((b) => b.id), ...buildings.flatMap((b) => b.porch.filter((p) => !at(p)).map(() => `${b.id}-porch`))],
    stations: m.stations.length, places: [...new Set(m.stations.map((s) => s.place))].sort(),
    layout: hash([...m.buildings, ...m.homes].flatMap((b) => [b.x, b.y, b.w, b.h, b.door.x, b.door.y]).concat(m.stations.flatMap((s) => [s.tile.x, s.tile.y]), [m.entrance.x, m.entrance.y])),
  };
});
const minimapPixels = (page) => page.evaluate(() => { const c = document.querySelector('#minimap'); return c.toDataURL('image/png').split(',')[1]; });
const canvasShot = (page) => bare(page, () => page.locator('#game canvas').screenshot());
/** Run a capture with every HUD element hidden, so the pixels are the Town canvas alone. */
const bare = async (page, fn) => {
  await page.evaluate(() => {
    if (!document.getElementById('bare-style')) { const s = document.createElement('style'); s.id = 'bare-style'; s.textContent = 'html.bare body > *:not(#game){visibility:hidden !important}'; document.head.append(s); }
    document.documentElement.classList.add('bare');
  });
  try { return await fn(); } finally { await page.evaluate(() => document.documentElement.classList.remove('bare')); }
};
const frozen = (page) => page.evaluate(() => { const t = window.__town; t.source.stop(); t.sim.update = () => {}; t.sim.push = () => {}; });
const hasKit = (page, tag) => page.waitForFunction((tg) => { const v = [...window.__town.runtime.scene().views.values()]; return v.length > 0 && v.every((x) => (tg === '' ? !/-(mf|pc)$/.test(x.key) : x.key.endsWith(`-${tg}`))); }, tag, { timeout: 30000 });

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

  // ============================================ rendered appearance, demo mode
  // What is drawn must change, not only what the resolver reports. The simulator is frozen
  // for the measurements so a resident does not walk out of the frame between captures.
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`rendered-demo: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=12&motion=reduced`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await page.evaluate(() => {
      const sim = window.__town.sim;
      const spawn = (n, role, extra = {}) => sim.push({ id: `render-${n}`, agentId: `h/main/renderprobe${String(n).padStart(2, '0')}`, seq: 1, at: sim.now(), type: 'agent.spawned', role, displayName: `probe ${n}`, ...extra });
      spawn(1, 'coordinator', { profile: 'work', paletteSlot: 1 });
      spawn(2, 'fabrication');
      spawn(3, 'research');
    });
    await page.waitForFunction(() => [...window.__town.sim.residents.values()].filter((r) => r.state !== 'gone' && r.x > 27 * 16 && r.x < 89 * 16 && r.y > 17 * 16 && r.y < 57 * 16).length >= 2, null, { timeout: 60000 });
    await frozen(page);
    await settle(page, 4);
    const factsBefore = await residentFacts(page);
    assert.ok(factsBefore.length >= 4, `enough residents to compare: ${factsBefore.length}`);
    assert.ok(factsBefore.some((f) => f.profile === 'work' && f.profileSlot === 1));
    await page.evaluate(() => { const t = window.__town; window.__ref = { sim: t.sim, source: t.source, runtime: t.runtime, residents: [...t.sim.residents.values()] }; });

    // the resident we photograph: the one standing furthest from everybody else
    const target = await page.evaluate(() => {
      const s = window.__town.runtime.scene(), cam = s.cameras.main, sim = window.__town.sim;
      s.setDirector(false);
      const rs = [...sim.residents.values()].filter((r) => r.state !== 'gone');
      // stand inside the town so the camera can centre on the resident, not clamp at the map edge
      const inside = rs.filter((r) => r.profile === null && r.x > 27 * 16 && r.x < 89 * 16 && r.y > 17 * 16 && r.y < 57 * 16);
      const pool = inside.length > 0 ? inside : rs;
      const far = (r) => Math.min(...rs.filter((o) => o !== r).map((o) => Math.hypot(o.x - r.x, o.y - r.y)), 1e9);
      const pick = [...pool].sort((a, b) => far(b) - far(a))[0];
      s.tweens.killTweensOf(cam); cam.panEffect.reset(); cam.stopFollow(); cam.setZoom(5); cam.centerOn(pick.x, pick.y - 8);
      return pick.id;
    });
    const clip = async () => page.evaluate((id) => {
      const s = window.__town.runtime.scene(), cam = s.cameras.main, r = window.__town.sim.residents.get(id);
      const rect = document.querySelector('#game canvas').getBoundingClientRect(), v = cam.worldView;
      const cx = rect.x + (r.x - v.x) * cam.zoom, cy = rect.y + (r.y - 8 - v.y) * cam.zoom;
      const x = Math.max(rect.x, Math.round(cx - 100)), y = Math.max(rect.y, Math.round(cy - 120));
      return { x, y, width: Math.min(200, Math.round(rect.right - x)), height: Math.min(240, Math.round(rect.bottom - y)) };
    }, target);
    const shots = {}, arts = {};
    await open(page);
    const sequence = ['theme', 'market-folk', 'plainclothes', 'theme'];
    const tags = { theme: '', 'market-folk': 'mf', plainclothes: 'pc' };
    const kitLabel = (kit, i) => (kit === 'theme' ? (i === 0 ? 'townsfolk' : 'townsfolk-again') : kit);
    for (const [i, kit] of sequence.entries()) {
      await page.selectOption('#ap-people', kit);
      await hasKit(page, tags[kit]);
      await settle(page, 6);
      const label = kitLabel(kit, i);
      arts[label] = await artState(page);
      shots[label] = await bare(page, async () => page.screenshot({ clip: await clip() }));
      if (i === 0) shots['townsfolk-repeat'] = await bare(page, async () => page.screenshot({ clip: await clip() }));
      await fs.writeFile(path.join(output, `people-${label}.png`), shots[label]);
    }
    // identities, state and history are untouched by three kit switches
    assert.deepEqual(await residentFacts(page), factsBefore, 'resident ids, names, roles, profiles, homes and history are unchanged');
    assert.equal(await page.evaluate(() => { const t = window.__town, r = window.__ref; return t.sim === r.sim && t.source === r.source && t.runtime === r.runtime && r.residents.every((x) => t.sim.residents.get(x.id) === x); }), true, 'the same simulator, source, runtime and resident objects');
    // every resident's art differs between kits, and returns exactly when the kit does
    const ids = Object.keys(arts.townsfolk).sort();
    assert.ok(ids.length >= 4);
    for (const label of Object.keys(arts)) assert.deepEqual(Object.keys(arts[label]).sort(), ids, `${label}: a sprite per resident, same ids`);
    for (const id of ids) {
      const sheets = [arts.townsfolk[id].sheet, arts['market-folk'][id].sheet, arts.plainclothes[id].sheet];
      assert.equal(new Set(sheets).size, 3, `${id}: three kits, three different sprite sheets`);
      const idles = [arts.townsfolk[id].idle, arts['market-folk'][id].idle, arts.plainclothes[id].idle];
      assert.equal(new Set(idles).size, 3, `${id}: three kits, three different idle poses`);
      assert.equal(arts['townsfolk-again'][id].sheet, arts.townsfolk[id].sheet, `${id}: returning to the theme kit restores the original art`);
      assert.match(arts['market-folk'][id].key, /-mf$/); assert.match(arts.plainclothes[id].key, /-pc$/);
    }
    // the plume, hat and gold edging are on every Market folk sprite; the linen collar is on every Plain clothes sprite; neither is on the originals
    for (const id of ids) {
      assert.deepEqual([arts.townsfolk[id].marks.plume, arts.townsfolk[id].marks.marketHat, arts.townsfolk[id].marks.linen], [0, 0, 0], `${id}: the original look carries no kit colours`);
      assert.ok(arts['market-folk'][id].marks.plume >= 3 && arts['market-folk'][id].marks.marketHat >= 20 && arts['market-folk'][id].marks.gold > arts.townsfolk[id].marks.gold, `${id}: Market folk wear the plume, plum hat and gold edging ${JSON.stringify(arts['market-folk'][id].marks)}`);
      assert.ok(arts.plainclothes[id].marks.linen >= 8 && arts.plainclothes[id].marks.plume === 0 && arts.plainclothes[id].marks.marketHat === 0, `${id}: Plain clothes wear a linen collar and hem ${JSON.stringify(arts.plainclothes[id].marks)}`);
    }
    // the profile colour stays authoritative and visible under every kit
    const profileId = 'h/main/renderprobe01';
    for (const label of ['townsfolk', 'market-folk', 'plainclothes']) assert.ok(arts[label][profileId].profileBlue >= 20, `${label}: profile blue is on the sprite (${arts[label][profileId].profileBlue}px)`);
    assert.match(arts.plainclothes[profileId].key, /-p1-pc$/);
    // controlled canvas pixels: a different kit is a different picture, the same kit is the same picture
    const same = await imageDiff(shots.townsfolk, shots['townsfolk-repeat']);
    const toMarket = await imageDiff(shots.townsfolk, shots['market-folk']);
    const toPlain = await imageDiff(shots.townsfolk, shots.plainclothes);
    const marketToPlain = await imageDiff(shots['market-folk'], shots.plainclothes);
    assert.ok(same.sameSize && same.ratio < 0.02, `an unchanged kit renders the same pixels (${same.ratio})`);
    for (const [name, d] of [['market-folk', toMarket], ['plainclothes', toPlain], ['market-folk vs plainclothes', marketToPlain]]) assert.ok(d.ratio > 0.03, `${name} visibly changes the rendered resident (${d.ratio})`);
    // Stacked residents may swap draw order after a rebuild, so the round trip is proved by the art itself (above), not by pixels.
    receipts.peopleRendered = { residents: ids.length, targetPixels: { sameKit: +same.ratio.toFixed(4), market: +toMarket.ratio.toFixed(4), plain: +toPlain.ratio.toFixed(4), marketVsPlain: +marketToPlain.ratio.toFixed(4) } };

    // ---- the map: Town to Greenwood is a different place with the same bones
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.setDirector(true); s.overview(); });
    await settle(page, 6);
    const townMap = await mapState(page), townMini = await minimapPixels(page), townShot = await canvasShot(page);
    assert.equal(townMap.preset, 'town'); assert.deepEqual(townMap.unreachable, []);
    await page.selectOption('#ap-map', 'greenwood');
    await page.click('#ap-map-apply');
    await page.waitForFunction(() => window.__town.runtime.preset.id === 'greenwood' && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await frozen(page);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.setDirector(true); s.overview(); });
    await settle(page, 8);
    const greenMap = await mapState(page), greenMini = await minimapPixels(page), greenShot = await canvasShot(page);
    await fs.writeFile(path.join(output, 'map-town.png'), townShot); await fs.writeFile(path.join(output, 'map-greenwood.png'), greenShot);
    assert.equal(greenMap.preset, 'greenwood');
    assert.deepEqual(greenMap.unreachable, [], 'every station, door and porch is reachable on Greenwood');
    assert.equal(greenMap.stations, townMap.stations); assert.deepEqual(greenMap.places, townMap.places);
    assert.equal(greenMap.layout, townMap.layout, 'buildings, doors, stations and the entrance are exactly where they were');
    assert.notEqual(greenMap.ground, townMap.ground); assert.notEqual(greenMap.props, townMap.props);
    assert.ok(greenMap.trees <= townMap.trees * 0.9 && greenMap.hedges > townMap.hedges, `open meadows with a hedgerow, not just more woods (${townMap.trees} -> ${greenMap.trees} trees)`);
    const miniDiff = await imageDiff(Buffer.from(townMini, 'base64'), Buffer.from(greenMini, 'base64'), 16);
    const shotDiff = await imageDiff(townShot, greenShot);
    assert.ok(miniDiff.ratio > 0.1, `the minimap draws the selected map (${miniDiff.ratio} of its pixels changed)`);
    assert.ok(shotDiff.sameSize && shotDiff.ratio > 0.3, `the canvas shows a different map (${shotDiff.ratio} of its pixels changed)`);
    receipts.mapRendered = { townTrees: townMap.trees, greenwoodTrees: greenMap.trees, minimapPixelsChanged: +miniDiff.ratio.toFixed(3), canvasPixelsChanged: +shotDiff.ratio.toFixed(3), unreachable: greenMap.unreachable };

    // a map switch keeps the chosen people kit, and Reset returns the default map and look
    await page.selectOption('#ap-people', 'plainclothes');
    await hasKit(page, 'pc');
    await page.click('#ap-reset');
    await page.waitForFunction(() => window.__town.runtime.preset.id === 'town' && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    assert.deepEqual(await resolved(page), { theme: 'classic', people: 'townsfolk', map: 'town', reduced: false, rain: false, weather: 'clear', hour: null, motes: false, windSway: 1, particleRate: 1 });
    assert.equal((await mapState(page)).ground, townMap.ground, 'Reset rebuilds the original map');
    assert.match(await page.textContent('#ap-status'), /rebuilt the Town map/);
    await page.waitForFunction(() => document.querySelectorAll('#game canvas').length === 1);

    // links and saved views carry both choices into a fresh page
    const linkPage = await ctx.newPage();
    linkPage.on('pageerror', (e) => errors.push(`rendered-link: ${e.message}`));
    await linkPage.goto(`${base}/?agents=demo&hour=12&people=plainclothes&map=greenwood`);
    await ready(linkPage);
    await linkPage.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    assert.equal((await mapState(linkPage)).preset, 'greenwood'); assert.equal((await mapState(linkPage)).ground, greenMap.ground, 'a link builds the same Greenwood');
    await hasKit(linkPage, 'pc');
    await open(linkPage);
    await linkPage.click('#ap-save');
    await linkPage.goto(`${base}/?agents=demo&hour=12`);
    await ready(linkPage);
    await linkPage.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    assert.equal((await mapState(linkPage)).preset, 'greenwood', 'the saved view restores the map');
    await hasKit(linkPage, 'pc');
    await linkPage.close();
    receipts.reset = 'Reset rebuilds the default map and look; a link and a saved view restore people and map in a fresh page';

    // reduced motion and the environment still render on top of the new look
    await page.goto(`${base}/?agents=demo&hour=12&map=greenwood&people=market-folk&weather=rain&motion=reduced`);
    await ready(page);
    let env = await resolved(page);
    assert.equal(env.reduced, true); assert.equal(env.rain, false); assert.equal(env.weather, 'rain');
    await page.goto(`${base}/?agents=demo&hour=12&map=greenwood&people=market-folk&weather=rain&motion=full`);
    await ready(page);
    env = await resolved(page);
    assert.equal(env.rain, true); assert.equal(env.map, 'greenwood'); assert.equal(env.people, 'market-folk');
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


  // ================================================ rendered appearance, live mode
  // The same real residents, their state and their history survive a people change and a map
  // rebuild, and what is drawn changes. Nothing is ingested, restarted or replayed.
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`rendered-live: ${e.message}`));
    const requests = [];
    track(page, requests);
    const C = 'h/main/cccccccccccccccc', D = 'h/main/dddddddddddddddd', E = 'h/main/eeeeeeeeeeeeeeee';
    for (const [key, role] of [[C, 'fabrication'], [D, 'coordinator'], [E, 'research']]) {
      assert.equal((await ingest(base, [ev(key, 'spawned', { role }), ev(key, 'assigned', { role })])).status, 202);
    }
    assert.equal((await ingest(base, [ev(C, 'tool_started', { role: 'fabrication', tool: 'terminal' })])).status, 202);
    await page.goto(`${base}/?hour=12&motion=reduced`);
    await ready(page);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Hermes events received'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__town.sim.residents.size >= 5, null, { timeout: 30000 });
    const bridgeCount = async () => (await (await fetch(`${base}/api/town/snapshot`)).json()).bridge.receivedEvents;
    const delivered = await bridgeCount();
    const liveState = () => page.evaluate(() => [...window.__town.sim.residents.values()].map((r) => ({ id: r.id, state: r.state, place: r.place, anim: r.anim, station: r.station?.id ?? null, bubble: r.bubble, emote: r.emote ?? null })).sort((a, b) => (a.id < b.id ? -1 : 1)));
    // hold the simulator still so state can be compared exactly across the kit switches (the source stays connected)
    await page.evaluate(() => { const t = window.__town; t.sim.update = () => {}; t.sim.push = () => {}; window.__ref = { sim: t.sim, source: t.source, runtime: t.runtime }; });
    await settle(page, 4);
    const idsBefore = await page.evaluate(() => [...window.__town.sim.residents.keys()].sort());
    assert.ok(['h/main/cccccccccccccccc', 'h/main/dddddddddddddddd', 'h/main/eeeeeeeeeeeeeeee'].every((id) => idsBefore.includes(id)), 'the live fixtures are in the Town');
    const factsBefore = await residentFacts(page), stateBefore = await liveState();
    const arts = {}, mark = requests.length;
    await open(page);
    for (const [label, kit, tag] of [['townsfolk', 'theme', ''], ['market-folk', 'market-folk', 'mf'], ['plainclothes', 'plainclothes', 'pc']]) {
      await page.selectOption('#ap-people', kit);
      await hasKit(page, tag);
      await settle(page, 6);
      arts[label] = await artState(page);
    }
    assert.deepEqual(await page.evaluate(() => [...window.__town.sim.residents.keys()].sort()), idsBefore, 'same resident ids after the people switches');
    assert.deepEqual(await residentFacts(page), factsBefore, 'names, roles, homes and lifecycle history are untouched');
    assert.deepEqual(await liveState(), stateBefore, 'state, place, animation and bubble are untouched');
    assert.equal(await page.evaluate(() => window.__town.sim === window.__ref.sim && window.__town.source === window.__ref.source && window.__town.runtime === window.__ref.runtime), true);
    assert.deepEqual(requests.slice(mark).filter((q) => q.method !== 'GET' || q.path === '/api/town/events' || q.full), [], 'people changes make no stream, snapshot or write request');
    assert.equal(await bridgeCount(), delivered, 'people changes send nothing to the bridge');
    for (const id of idsBefore) {
      assert.equal(new Set([arts.townsfolk[id].sheet, arts['market-folk'][id].sheet, arts.plainclothes[id].sheet]).size, 3, `${id}: live resident art differs between the three kits`);
    }
    // Plain clothes stays selected for the map rebuild: the same residents come back wearing it
    const plainSheets = Object.fromEntries(idsBefore.map((id) => [id, arts.plainclothes[id].sheet]));
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.setDirector(true); s.overview(); });
    await settle(page, 6);
    const townMap = await mapState(page), townMini = await minimapPixels(page), townShot = await canvasShot(page);
    assert.equal(townMap.preset, 'town'); assert.deepEqual(townMap.unreachable, []);
    await page.selectOption('#ap-map', 'greenwood');
    const reqMark = requests.length;
    await page.click('#ap-map-apply');
    await page.waitForFunction(() => window.__town.runtime !== window.__ref.runtime && window.__town.runtime.preset.id === 'greenwood' && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Hermes events received'), null, { timeout: 30000 });
    await page.waitForFunction((n) => window.__town.sim.residents.size >= n, idsBefore.length, { timeout: 30000 });
    await hasKit(page, 'pc');
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.setDirector(true); s.overview(); });
    await settle(page, 8);
    const after = requests.slice(reqMark);
    assert.ok(after.some((q) => q.full && q.method === 'GET'), 'the rebuilt scene re-reads the snapshot');
    assert.ok(after.every((q) => q.method === 'GET' && q.path !== '/api/town/ingest'), 'the rebuild only reads');
    assert.deepEqual(await page.evaluate(() => [...window.__town.sim.residents.keys()].sort()), idsBefore, 'the same real resident ids are rehydrated after the map apply');
    const factsAfter = await residentFacts(page);
    assert.deepEqual(factsAfter.map(({ id, kind, role, name, parentId, profile, profileSlot, home }) => ({ id, kind, role, name, parentId, profile, profileSlot, home })),
      factsBefore.map(({ id, kind, role, name, parentId, profile, profileSlot, home }) => ({ id, kind, role, name, parentId, profile, profileSlot, home })), 'identity, role, name and home are rehydrated unchanged');
    assert.equal(await bridgeCount(), delivered, 'the bridge delivery count is unchanged by the rebuild');
    const artsAfter = await artState(page);
    for (const id of idsBefore) assert.equal(artsAfter[id].sheet, plainSheets[id], `${id}: the same resident wears the same Plain clothes art on the new map`);
    const greenMap = await mapState(page), greenMini = await minimapPixels(page), greenShot = await canvasShot(page);
    await fs.writeFile(path.join(output, 'live-map-town.png'), townShot); await fs.writeFile(path.join(output, 'live-map-greenwood.png'), greenShot);
    assert.equal(greenMap.preset, 'greenwood'); assert.deepEqual(greenMap.unreachable, [], 'every station, door and porch is reachable on the live Greenwood');
    assert.equal(greenMap.layout, townMap.layout); assert.notEqual(greenMap.ground, townMap.ground);
    const miniDiff = await imageDiff(Buffer.from(townMini, 'base64'), Buffer.from(greenMini, 'base64'), 16), shotDiff = await imageDiff(townShot, greenShot);
    assert.ok(miniDiff.ratio > 0.1, `the live minimap draws the selected map (${miniDiff.ratio})`);
    assert.ok(shotDiff.ratio > 0.3, `the live canvas shows the selected map (${shotDiff.ratio})`);
    // a live Greenwood still shows the same residents' state honestly: nothing is fabricated
    assert.equal(await page.evaluate(() => [...window.__town.sim.residents.values()].some((r) => r.kind === 'runner' && !r.parentId)), false);
    receipts.liveRendered = { residents: idsBefore.length, delivered, minimapPixelsChanged: +miniDiff.ratio.toFixed(3), canvasPixelsChanged: +shotDiff.ratio.toFixed(3), artSheetsPerKit: 3 };
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

  // ============================== the minimap follows the mounted map, with frames paused
  // A background or occluded tab stops requestAnimationFrame while the Town renderer (timer driven) keeps
  // running. The minimap must still redraw from the mounted TownMap after every Apply, Reset, link and saved
  // view. Each capture is the full PNG data of #minimap with the residents removed and the camera at the
  // overview, so the only thing that can differ is the map; comparisons are exact, not a sampled hash.
  {
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
    const miniData = (page) => page.evaluate(() => document.querySelector('#minimap').toDataURL('image/png'));
    const pauseFrames = () => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__framesPaused = false;
      window.requestAnimationFrame = (cb) => (window.__framesPaused ? 0 : raf(cb));
    };
    const quiet = async (page, label, notEqual = null) => {
      await page.waitForFunction(() => window.__town.runtime.scene()?.textures.exists('art-tree0') && window.__town.sim.residents.size > 0, null, { timeout: 30000, polling: 100 });
      await frozen(page);
      await page.evaluate(() => { const t = window.__town; t.sim.residents.clear(); const s = t.runtime.scene(); s.setDirector(true); s.overview(); });
      let prev = null, same = 0;
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(300);
        const cur = await miniData(page);
        // a redraw is timer driven while frames are paused, so a read can land before the first one: it must hold for two further reads
        same = cur === prev ? same + 1 : 0;
        if (same >= 2 && (notEqual === null || cur !== notEqual)) return cur;
        prev = cur;
      }
      assert.fail(`${label}: the minimap never settled on a redraw of the mounted map`);
    };
    const mounted = (page) => page.evaluate(() => ({ map: window.__town.runtime.preset.id, trees: window.__town.map.props.filter((p) => p.kind === 'tree').length, framesPaused: window.__framesPaused }));
    const applyMap = async (page, id) => {
      await page.evaluate(() => { const p = document.querySelector('#appearance'); if (p.hidden) document.querySelector('#appearance-toggle').click(); });
      await page.selectOption('#ap-map', id);
      await page.click('#ap-map-apply');
      await page.waitForFunction((want) => window.__town.runtime.preset.id === want, id, { timeout: 30000, polling: 100 });
    };
    const resetView = async (page) => {
      await page.evaluate(() => { const p = document.querySelector('#appearance'); if (p.hidden) document.querySelector('#appearance-toggle').click(); });
      await page.click('#ap-reset');
      await page.waitForFunction(() => window.__town.runtime.preset.id === 'town', null, { timeout: 30000, polling: 100 });
    };
    const pixels = (a, b) => imageDiff(Buffer.from(a.split(',')[1], 'base64'), Buffer.from(b.split(',')[1], 'base64'), 16);
    receipts.minimapFollowsMount = {};

    for (const [mode, url] of [['demo', `${base}/?agents=demo&hour=12`], ['live', base]]) {
      const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
      await ctx.addInitScript(pauseFrames);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`minimap ${mode}: ${e.message}`));
      await page.goto(url);
      await page.evaluate(() => { window.__framesPaused = true; });
      const townState = await mounted(page);
      assert.equal(townState.map, 'town'); assert.equal(townState.framesPaused, true);
      const townMini = await quiet(page, `${mode} Town`);

      await applyMap(page, 'greenwood');
      const greenState = await mounted(page);
      assert.equal(greenState.map, 'greenwood'); assert.ok(greenState.trees !== townState.trees, 'the scene map is the Greenwood map');
      const greenMini = await quiet(page, `${mode} Greenwood apply`, townMini);
      assert.notEqual(greenMini, townMini, `${mode}: Apply changes the minimap data`);
      const diff = await pixels(townMini, greenMini);
      assert.ok(diff.sameSize && diff.ratio > 0.1, `${mode}: the Greenwood minimap is materially different (${diff.ratio})`);

      await resetView(page);
      const resetState = await mounted(page);
      assert.equal(resetState.map, 'town'); assert.equal(resetState.trees, townState.trees);
      const resetMini = await quiet(page, `${mode} Reset`, greenMini);
      assert.equal(resetMini, townMini, `${mode}: Reset restores the exact Town minimap`);

      // Greenwood again, then a saved view in a fresh page whose frames are paused from the first moment
      await applyMap(page, 'greenwood');
      assert.equal(await quiet(page, `${mode} Greenwood again`, townMini), greenMini, `${mode}: Greenwood draws the same minimap every time`);
      await page.evaluate(() => document.querySelector('#ap-save').click());
      for (const [how, address] of [['link', `${url}${url.includes('?') ? '&' : '?'}map=greenwood`], ['saved view', url]]) {
        const fresh = await ctx.newPage();
        await fresh.addInitScript(() => { window.__framesPaused = true; });
        fresh.on('pageerror', (e) => errors.push(`minimap ${mode} ${how}: ${e.message}`));
        await fresh.goto(address);
        const loaded = await mounted(fresh);
        assert.equal(loaded.map, 'greenwood'); assert.equal(loaded.framesPaused, true);
        assert.equal(await quiet(fresh, `${mode} ${how} load`), greenMini, `${mode}: a ${how} draws the mounted Greenwood minimap`);
        await fresh.close();
      }
      receipts.minimapFollowsMount[mode] = {
        town: { runtime: townState, bytes: townMini.length, sha256: sha(townMini) },
        greenwood: { runtime: greenState, bytes: greenMini.length, sha256: sha(greenMini), pixelsChangedFromTown: +diff.ratio.toFixed(3) },
        reset: { runtime: resetState, bytes: resetMini.length, sha256: sha(resetMini), identicalToTown: resetMini === townMini },
        loadPaths: ['apply', 'reset', 'link', 'saved view'],
      };
      await ctx.close();
    }
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
