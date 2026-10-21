// Cyber City refinements, verified in a real browser against the production build served by the real Town server on
// loopback (run `npm run build` first). All activity is synthetic and nothing is ever written to the server.
//
//   1. Watch posts: every authored post is walkable, outside every building, workstation, lift shaft, lift landing and
//      approach and car stop, and reachable from the entrance; a forced invalid post fails the same validation. Keepers
//      (the "watches") really stand at those posts, and their "on watch" bubble is drawn.
//   2. Traffic: cars are materially larger than the earlier ones (rendered pixels against the earlier art, with a control),
//      materially faster, keep to one directional lane each side of a bold dashed divider (a car moved onto the divider
//      fails the lane check), and under reduced motion stop moving while staying on the street.
//   3. Car transit: a resident whose route goes beyond the next district walks, rides a car in the correct lane and walks
//      again (exactly walk, car, walk), as one resident with no event, history or write; a trip to the same or a
//      neighbouring district never takes a car. Reduced motion stands the car at the two stops.
//   4. Camera: on every map (Town, Greenwood, Cyber City, Orbital System) and several window sizes, the camera never goes
//      below the dynamic zoom floor (wheel, the HUD buttons, follow, programmatic zoom and tweens, resizing, map changes,
//      a two-finger gesture); zooming in is unaffected; a camera deliberately lowered with the guard off is caught.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';
import { createPixels } from './lib/pixels.mjs';
import { loadTs } from './lib/load-ts.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/cyber-city-refinements');
await fs.mkdir(output, { recursive: true });
const C = await loadTs(`
  export { ROAD, CAR_SIZE, PRIOR_CAR_SIZE, TRAFFIC_SPEED, CYBER_POSTS, CYBER_TOWERS, CYBER_W, STREET_YB, vestibule, carStop, cyberDistrictOf, cyberDistrictsAdjacent } from './src/world/cyberCity.ts';
  export { zoomFloor, viewInsideWorld } from './src/world/zoomFloor.ts';
  export { ROAD_RIDE_DEPTHS } from './src/scenes/depthBands.ts';
`, root);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-cyber-refine-'));
const token = crypto.randomBytes(32).toString('base64url');
const town = createTownServer({ token, journalPath: path.join(temp, 'journal.jsonl'), staticRoot: path.join(root, 'dist') });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const pixels = createPixels(browser);
const calc = await browser.newPage();
const errors = [];
const receipts = { syntheticActivity: true };
const TILE = 16;
const R = C.ROAD, CAR = C.CAR_SIZE;

const ready = (page) => page.waitForFunction(() => {
  const s = window.__town?.runtime?.scene?.();
  return Boolean(s && s.textures.exists('art-tree0') && s.appearance);
}, null, { timeout: 30000 });
const settle = (page, n = 4) => page.evaluate((frames) => new Promise((resolve) => { const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))); tick(frames); }), n);
const shot = (page) => page.locator('#game canvas').screenshot();
const track = (page, log) => page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) log.push({ method: req.method(), path: u.pathname }); });
const open = async (page) => { if (await page.locator('#appearance:not([hidden])').count() === 0) await page.click('#appearance-toggle'); await page.waitForSelector('#appearance:not([hidden])'); };
const toBox = (page, [wx, wy, ww, wh]) => page.evaluate(([x, y, w, h]) => {
  const s = window.__town.runtime.scene(), cam = s.cameras.main, canvas = document.querySelector('#game canvas');
  const f = canvas.getBoundingClientRect().width / cam.width, k = cam.zoom * f;
  return [Math.round((x - cam.worldView.x) * k), Math.round((y - cam.worldView.y) * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}, [wx, wy, ww, wh]);
const focus = (page, wx, wy, zoom = 3) => page.evaluate(([x, y, z]) => { const s = window.__town.runtime.scene(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, [wx, wy, zoom]);
const changedPixels = async (a, b, box) => (await pixels.measure(a, b, { box, tolerance: 10 })).changed;
const changedRatio = async (a, b, box) => (await pixels.measure(a, b, { box, tolerance: 10 })).ratio;

async function openCyber(page, { reduced = false, base } = {}) {
  await page.goto(`${base}/?agents=demo&hour=12&theme=cyber-city${reduced ? '&motion=reduced' : ''}`);
  await ready(page);
  assert.equal(await page.locator('#game canvas').count(), 1, 'one game canvas');
  await page.evaluate(() => { const t = window.__town, s = t.runtime.scene(); t.source.stop(); t.sim.residents.clear(); s.setDirector(false); s.cameras.main.stopFollow(); });
}
const freeze = (page, { hideTraffic = false } = {}) => page.evaluate((hide) => {
  const s = window.__town.runtime.scene(); s.scene.pause();
  if (hide) for (const o of s.ambient.objects) if (o.texture?.key === 'cy-car') o.setVisible(false);
}, hideTraffic);
const showTransit = (page, on) => page.evaluate((visible) => { const s = window.__town.runtime.scene(); if (visible) s.update(0, 0); else for (const o of s.transit.objects()) o.setVisible(false); }, on);
const traffic = (page) => page.evaluate(() => window.__town.runtime.scene().ambient.traffic());

/** Runs of "amber divider" pixels along the middle row of a box: [{start, length}], measured on the rendered PNG. */
const dashRuns = (png, box, baselineBox) => calc.evaluate(async ([b64, [x0, y0, w, h], [bx, by, bw, bh]]) => {
  const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = `data:image/png;base64,${b64}`; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const amberness = (d, k) => (d[k] + d[k + 1]) / 2 - d[k + 2];
  const base = g.getImageData(bx, by, bw, bh).data; let mean = 0; for (let k = 0; k < base.length; k += 4) mean += amberness(base, k); mean /= base.length / 4;
  const d = g.getImageData(x0, y0, w, h).data;
  const hot = new Array(w).fill(false);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (amberness(d, (y * w + x) * 4) > mean + 40) hot[x] = true;
  const runs = []; let start = -1;
  for (let x = 0; x <= w; x++) { if (x < w && hot[x]) { if (start < 0) start = x; } else if (start >= 0) { runs.push({ start, length: x - start }); start = -1; } }
  return runs.filter((r) => r.length >= 24); // a dash is 16 world px: 48 px on screen at 3x; a speck of neon glow is not a dash
}, [png.toString('base64'), box, baselineBox]);

const { port } = await town.listen(0);
const base = `http://127.0.0.1:${port}`;

try {
  // ====================================================================== 1. watch posts
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`posts: ${e.message}`));
    const requests = []; track(page, requests);
    await openCyber(page, { base });
    /** The map's own facts, then an independent validation of any list of candidate posts, run in the page against the live map. */
    const validate = (posts) => page.evaluate((candidates) => {
      const m = window.__town.map, { w, h, cost } = m.grid;
      const inRect = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
      const bld = [...m.buildings, ...m.homes], conn = m.transit.connectors.flatMap((c) => [c.boarding, c.exit]);
      const out = [];
      candidates.forEach((p, i) => {
        const n = `#${i} (${p.x},${p.y})`;
        if (!(Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < w && p.y < h && cost[p.y * w + p.x] !== 0)) { out.push(`${n} is not walkable`); return; }
        for (const b of bld) if (inRect(p, b)) out.push(`${n} is inside ${b.id}`);
        if (m.stations.some((s) => s.tile.x === p.x && s.tile.y === p.y)) out.push(`${n} is on a workstation`);
        if (conn.some((t) => t.x === p.x && t.y === p.y)) out.push(`${n} is on a lift or car boarding tile`);
        for (const r of m.postExclusions) if (inRect(p, r)) out.push(`${n} is inside ${r.kind} ${r.id}`);
        if (!m.transit.route(m.entrance, p)) out.push(`${n} is not reachable from the entrance`);
      });
      return out;
    }, posts);
    const posts = await page.evaluate(() => window.__town.map.posts);
    assert.deepEqual(posts, C.CYBER_POSTS.map((p) => p.tile));
    assert.ok(posts.length >= 8);
    assert.deepEqual(await validate(posts), [], 'every configured post is valid and reachable');
    for (const p of posts) {
      for (const t of C.CYBER_TOWERS) {
        assert.ok(Math.abs(p.x - C.vestibule(t, 0).x) >= 4, `post ${p.x},${p.y} is at least four tiles from the ${t.id} lift`);
        assert.ok(Math.abs(p.x - C.carStop(t).x) >= 3, `post ${p.x},${p.y} is clear of the ${t.id} car stop`);
      }
    }
    // forced invalid posts fail the same validation: in front of a lift, on its threshold, in a car stop, in a room, in the void
    const v = C.vestibule(C.CYBER_TOWERS[2], 0), stop = C.carStop(C.CYBER_TOWERS[1]);
    const invalid = { inFrontOfLift: { x: v.x + 2, y: v.y }, onThreshold: { x: v.x, y: v.y }, inCarStop: { x: stop.x, y: stop.y }, aboveStopRow: { x: stop.x - 1, y: stop.y - 2 }, onUpperDeckApproach: { x: v.x + 1, y: 35 }, inVoid: { x: 0, y: 0 } };
    const forced = {};
    for (const [name, p] of Object.entries(invalid)) { forced[name] = await validate([p]); assert.ok(forced[name].length > 0, `a forced invalid post (${name}) fails validation`); }
    assert.ok(await page.evaluate(() => { const m = window.__town.map; const room = m.buildings[0]; return m.grid.cost[(room.y + 1) * m.grid.w + room.x + 1] === 0; }), 'a tile inside a room is not walkable, so a post there is rejected');

    // keepers really stand there: one resident per post, run by the simulator with a frozen, still-rendering scene
    await freeze(page);
    const standing = await page.evaluate((count) => {
      const t = window.__town, sim = t.sim, s = t.runtime.scene();
      for (let i = 0; i < count; i++) sim.push({ id: `k${i}`, agentId: `h/cron/${String(i).padStart(16, 'k')}`, seq: 1, at: 0, type: 'agent.spawned', role: 'scheduled', displayName: `job ${i}` });
      for (let i = 0; i < 1800; i++) s.update(0, 50);
      return [...sim.residents.values()].map((r) => ({ id: r.id, state: r.state, bubble: r.bubble, x: Math.floor(r.x / 16), y: Math.floor(r.y / 16), history: r.history.map((h) => h.text) }));
    }, posts.length);
    assert.equal(standing.length, posts.length, 'one resident per keeper');
    const key = (p) => `${p.x},${p.y}`, postKeys = new Set(posts.map(key));
    assert.equal(new Set(standing.map(key)).size, posts.length, 'every post has its keeper');
    for (const r of standing) {
      assert.equal(r.state, 'posted'); assert.equal(r.bubble, 'on watch');
      assert.ok(postKeys.has(key(r)), `${r.id} stands at an authored post`);
      assert.ok(!r.history.some((h) => /car|lift|ride|transit/i.test(h)), 'no invented activity');
      assert.deepEqual(await validate([{ x: r.x, y: r.y }]), [], `${r.id} stands somewhere valid`);
    }
    // rendered: the "on watch" bubble is drawn over a keeper beside a street lamp, and a keeper is not in front of any lift
    const lampKeeper = standing.find((r) => r.x === 17);
    assert.ok(lampKeeper, 'a keeper stands beside the Archive street lamp');
    await page.evaluate((id) => { const s = window.__town.runtime.scene(); const r = window.__town.sim.residents.get(id); s.cameras.main.setZoom(3); s.cameras.main.centerOn(r.x, r.y - 10); s.update(0, 0); }, lampKeeper.id);
    await settle(page);
    const watchOn = await shot(page);
    const bub = await page.evaluate((id) => { const view = window.__town.runtime.scene().views.get(id); const b = view.bubbleBg.getBounds(); view.bubble.setVisible(false); view.bubbleBg.setVisible(false); return { visible: true, box: [b.x, b.y, b.width, b.height] }; }, lampKeeper.id);
    await settle(page);
    const watchOff = await shot(page);
    const bubbleRatio = await changedRatio(watchOn, watchOff, await toBox(page, bub.box));
    assert.ok(bubbleRatio > 0.3, `the "on watch" bubble is drawn beside the lamp (${bubbleRatio.toFixed(2)})`);
    await fs.writeFile(path.join(output, 'posts-keeper-by-lamp.png'), watchOn);
    // the whole street, each lift landing and its approach clear
    await page.evaluate(() => { const s = window.__town.runtime.scene(); for (const view of s.views.values()) { view.bubble.setVisible(true); view.bubbleBg.setVisible(true); } s.cameras.main.setZoom(1.4); s.cameras.main.centerOn(672, 700); s.update(0, 0); });
    await settle(page);
    await fs.writeFile(path.join(output, 'posts-street.png'), await shot(page));
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], 'no write request');
    receipts.posts = { configured: posts.length, valid: true, forcedInvalid: Object.fromEntries(Object.entries(forced).map(([k, e]) => [k, e[0]])), keepersOnPosts: standing.length, bubbleRatio: +bubbleRatio.toFixed(2) };
    await ctx.close();
  }

  // ====================================================================== 2. traffic
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`traffic: ${e.message}`));
    await openCyber(page, { base });
    await freeze(page);
    const half = CAR.h / 2;
    /** Lane violations in a snapshot of the traffic: wrong side of the divider, off the lane line, wrong direction. */
    const laneViolations = (cars) => {
      const out = [];
      for (const c of cars) {
        const line = c.lane === 'east' ? R.eastLaneY : R.westLaneY;
        if (Math.abs(c.y - line) > 0.01) out.push(`${c.lane} car at y ${c.y} is off its lane line ${line}`);
        if (c.lane === 'east' && !(c.y + half < R.divider - R.dividerThickness / 2)) out.push('an eastbound car reaches the divider');
        if (c.lane === 'west' && !(c.y - half > R.divider + R.dividerThickness / 2)) out.push('a westbound car reaches the divider');
        if ((c.lane === 'east') !== (c.dir === 1)) out.push(`a ${c.lane}bound lane car travels ${c.dir === 1 ? 'east' : 'west'}`);
      }
      return out;
    };
    const start = await traffic(page);
    assert.ok(start.length >= 8, `traffic: ${start.length} cars`);
    assert.ok(start.filter((c) => c.lane === 'east').length >= 3 && start.filter((c) => c.lane === 'west').length >= 3, 'cars in both lanes');
    assert.deepEqual(laneViolations(start), [], 'every car is on its own side of the divider');
    // the lane check has teeth: a car pushed onto the divider, or into the wrong lane, is reported
    assert.ok(laneViolations([{ ...start[0], y: R.divider }]).length > 0, 'control: a car on the divider fails');
    assert.ok(laneViolations([{ ...start[0], y: R.westLaneY }]).length > 0, 'control: an eastbound car in the westbound lane fails');
    assert.ok(laneViolations([{ ...start[0], dir: -1 }]).length > 0, 'control: a car going against its lane fails');
    // size, as drawn: against the earlier car (22 by 8) painted in the same place
    assert.ok(start.every((c) => c.w === CAR.w && c.h === CAR.h), 'every car is the new size');
    assert.ok(CAR.w >= C.PRIOR_CAR_SIZE.w * 1.5 && CAR.h >= C.PRIOR_CAR_SIZE.h * 1.5);

    // speed: a hundred 0.1 s steps of the scene, measured on the cars themselves
    const before = await traffic(page);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); for (let i = 0; i < 10; i++) s.update(0, 100); });
    const after = await traffic(page);
    const speeds = before.map((b, i) => { const dx = after[i].x - b.x; return Math.abs(dx) > 600 ? null : dx; }).map((dx, i) => (dx === null ? null : { lane: before[i].lane, dir: before[i].dir, speed: Math.abs(dx) / 1.0, signed: dx }));
    const measured = speeds.filter(Boolean);
    assert.ok(measured.length >= 6);
    for (const m of measured) { assert.ok(m.speed >= C.TRAFFIC_SPEED.min - 1, `a car moves ${m.speed.toFixed(0)} px/s (earlier cars: 26 to 50)`); assert.ok(Math.sign(m.signed) === m.dir, 'each car moves the way its lane runs'); }
    assert.ok(Math.min(...measured.map((m) => m.speed)) > 50 && Math.max(...measured.map((m) => m.speed)) < 140, 'faster than before, still readable');
    // lane discipline over time: a long run of steps, the cars never leave their lane lines
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => { const s = window.__town.runtime.scene(); for (let k = 0; k < 10; k++) s.update(0, 100); });
      const now = await traffic(page); const v = laneViolations(now); worst += v.length; assert.deepEqual(v, [], `traffic frame ${i}`);
    }

    // rendered size: one car shown in place at the new art, then swapped for the earlier art, then hidden
    const car = await page.evaluate(() => {
      const s = window.__town.runtime.scene();
      const imgs = s.ambient.objects.filter((o) => o.texture?.key === 'cy-car');
      for (const o of imgs) o.setVisible(false);
      const c = document.createElement('canvas'); c.width = 44; c.height = 16; const g = c.getContext('2d'); g.scale(2, 2);
      const fill = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
      fill(1, 2, 20, 5, '#e8f6ff'); fill(5, 0, 11, 3, '#9fd8ff'); fill(0, 4, 2, 2, '#ffd36b'); fill(20, 4, 2, 2, '#ff3a5a'); fill(2, 7, 18, 1, 'rgba(255,255,255,0.6)');
      if (!s.textures.exists('cy-car-earlier')) s.textures.addCanvas('cy-car-earlier', c);
      const o = imgs[0]; o.setPosition(560, 746 + 7.5).setVisible(true);
      return { key: o.texture.key, x: o.x, y: o.y };
    });
    await focus(page, car.x, car.y - 6, 4); await settle(page);
    const box = await toBox(page, [car.x - 30, car.y - 22, 60, 30]);
    const withNew = await shot(page);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.ambient.objects.filter((o) => o.texture?.key === 'cy-car' || o.texture?.key === 'cy-car-earlier')[0].setVisible(false); }); await settle(page);
    const withoutCar = await shot(page);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); const o = s.ambient.objects.filter((x) => x.texture?.key === 'cy-car')[0]; o.setTexture('cy-car-earlier').setVisible(true); }); await settle(page);
    const withEarlier = await shot(page);
    const pxNew = await changedPixels(withNew, withoutCar, box), pxEarlier = await changedPixels(withEarlier, withoutCar, box);
    const larger = (n, ref) => n >= 2.5 * ref;
    assert.ok(larger(pxNew, pxEarlier), `a car covers ${pxNew} px against ${pxEarlier} px for the earlier car`);
    assert.ok(!larger(pxEarlier, pxEarlier), 'control: the earlier car is not larger than itself, so the check can fail');
    await fs.writeFile(path.join(output, 'traffic-car-new.png'), withNew); await fs.writeFile(path.join(output, 'traffic-car-earlier.png'), withEarlier);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); const o = s.ambient.objects.filter((x) => x.texture?.key === 'cy-car-earlier')[0]; o.setTexture('cy-car'); for (const c of s.ambient.objects.filter((x) => x.texture?.key === 'cy-car')) c.setVisible(true); s.update(0, 0); });

    // the divider: a bold dashed line down the middle of the road, between the lanes
    await focus(page, 860, R.divider - 8, 3); await settle(page);
    const roadShot = await shot(page);
    const dBox = await toBox(page, [680, R.divider - 1, 360, 2]);
    const aBox = await toBox(page, [680, R.divider + 7, 360, 2]);
    const runs = await dashRuns(roadShot, dBox, aBox);
    assert.ok(runs.length >= 8, `a dashed centre line: ${runs.length} dashes in 360 px of road`);
    const gaps = runs.slice(1).map((r, i) => r.start - (runs[i].start + runs[i].length));
    assert.ok(gaps.every((g) => g >= 4) && Math.min(...runs.map((r) => r.length)) >= 24, 'dashes with clear gaps between them');
    const offRuns = await dashRuns(roadShot, aBox, aBox);
    assert.equal(offRuns.length, 0, `control: the same measurement on plain asphalt finds no dashes ${JSON.stringify({ offRuns, runs: runs.slice(0, 4), dBox, aBox })}`);
    await fs.writeFile(path.join(output, 'traffic-divider.png'), roadShot);
    // both lanes with traffic, either side of the line, at the normal overview
    await page.evaluate(() => { const s = window.__town.runtime.scene(); s.overview(); s.update(0, 0); }); await settle(page);
    await fs.writeFile(path.join(output, 'traffic-overview.png'), await shot(page));
    receipts.traffic = { cars: start.length, carSize: `${CAR.w}x${CAR.h}`, earlier: `${C.PRIOR_CAR_SIZE.w}x${C.PRIOR_CAR_SIZE.h}`, renderedPixels: { now: pxNew, earlier: pxEarlier }, speeds: { min: +Math.min(...measured.map((m) => m.speed)).toFixed(0), max: +Math.max(...measured.map((m) => m.speed)).toFixed(0), earlier: '26-50' }, laneViolations: worst, dividerDashes: runs.length };
    await ctx.close();
  }

  // ---------------------------------------------------------- 2b. reduced motion: no continuous car movement, a static street cue stays
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`traffic reduced: ${e.message}`));
    await openCyber(page, { reduced: true, base });
    await freeze(page);
    const a = await traffic(page);
    assert.ok(a.every((c) => c.moving === false), 'no car is moving');
    await page.evaluate(() => { const s = window.__town.runtime.scene(); for (let i = 0; i < 80; i++) s.update(0, 100); });
    const b = await traffic(page);
    assert.deepEqual(b.map((c) => [c.x, c.y]), a.map((c) => [c.x, c.y]), 'eight seconds of scene time later every car is where it was');
    // and the traffic is still there to see: parked cars drawn on the road, the divider drawn between the lanes
    const visible = await page.evaluate(() => window.__town.runtime.scene().ambient.objects.filter((o) => o.texture?.key === 'cy-car').map((o) => o.visible && o.alpha > 0.5));
    assert.ok(visible.length >= 8 && visible.every(Boolean));
    const parked = a.find((c) => c.x > 120 && c.x < 1200) ?? a[0];
    await focus(page, parked.x, parked.y, 4); await settle(page);
    const withCars = await shot(page);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); for (const o of s.ambient.objects.filter((x) => x.texture?.key === 'cy-car')) o.setVisible(false); }); await settle(page);
    const noCars = await shot(page);
    const parkedRatio = await changedRatio(withCars, noCars, await toBox(page, [parked.x - CAR.w / 2, parked.y - CAR.h / 2, CAR.w, CAR.h]));
    assert.ok(parkedRatio > 0.3, `a parked car is plainly drawn (${parkedRatio.toFixed(2)})`);
    await page.evaluate(() => { const s = window.__town.runtime.scene(); for (const o of s.ambient.objects.filter((x) => x.texture?.key === 'cy-car')) o.setVisible(true); }); await focus(page, 860, R.divider - 8, 3); await settle(page);
    const runs = await dashRuns(await shot(page), await toBox(page, [680, R.divider - 1, 360, 2]), await toBox(page, [680, R.divider + 7, 360, 2]));
    assert.ok(runs.length >= 8, 'the divider is still drawn under reduced motion');
    await fs.writeFile(path.join(output, 'traffic-reduced-motion.png'), withCars);
    receipts.trafficReduced = { cars: a.length, moved: false, parkedRatio: +parkedRatio.toFixed(2), dividerDashes: runs.length };
    await ctx.close();
  }

  // ====================================================================== 3. car transit
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`car transit: ${e.message}`));
    const requests = []; track(page, requests);
    await openCyber(page, { base });
    await freeze(page, { hideTraffic: true });
    const archive = 'archive';
    // every post, as a keeper's walk from the gate: a car exactly when the district is further than the next
    const plans = await page.evaluate((count) => {
      const t = window.__town, sim = t.sim, s = t.runtime.scene();
      for (let i = 0; i < count; i++) sim.push({ id: `k${i}`, agentId: `h/cron/${String(i).padStart(16, 'k')}`, seq: 1, at: 0, type: 'agent.spawned', role: 'scheduled', displayName: `job ${i}` });
      s.update(0, 50);
      const out = [...sim.residents.values()].map((r) => ({ id: r.id, post: r.post, kinds: r.legs.map((l) => (l.kind === 'walk' ? 'walk' : l.connectorId)), residents: sim.residents.size }));
      return out;
    }, C.CYBER_POSTS.length);
    const districtOf = (p) => C.cyberDistrictOf({ x: p.x, y: p.y });
    let carTrips = 0, walkTrips = 0;
    for (const p of plans) {
      const dest = districtOf(p.post), apart = !C.cyberDistrictsAdjacent(archive, dest);
      if (apart) { assert.deepEqual(p.kinds.map((k) => (k === 'walk' ? 'walk' : k.split('-')[0])), ['walk', 'car', 'walk'], `${p.id} to ${dest}: exactly walk, car, walk (${p.kinds})`); assert.equal(p.kinds[1], `car-${archive}-${dest}`); carTrips += 1; }
      else { assert.deepEqual(p.kinds, ['walk'], `${p.id} to ${dest}: walking only`); walkTrips += 1; }
      assert.equal(p.residents, C.CYBER_POSTS.length, 'no duplicates');
    }
    assert.ok(carTrips >= 4 && walkTrips >= 4, `both kinds of trip are covered (${carTrips} car, ${walkTrips} walking)`);

    // an eastbound ride in the rendered scene: the keeper bound for the far east curb
    const far = plans.find((p) => p.post.x === 80);
    const park = await page.evaluate((id) => {
      const t = window.__town, sim = t.sim, s = t.runtime.scene();
      for (const r of [...sim.residents.values()]) if (r.id !== id) sim.residents.delete(r.id);
      const r = sim.residents.get(id);
      const hist0 = r.history.map((h) => h.text), log0 = sim.log.length;
      let steps = 0; const walkPositions = [];
      while (!r.transit && steps < 4000) { s.update(0, 50); steps += 1; if (!r.transit) walkPositions.push({ x: r.x, y: r.y }); }
      return { legs: r.legs.map((l) => (l.kind === 'walk' ? 'walk' : l.connectorId)), legIndex: r.legIndex, hist0, log0, connector: r.transit?.connectorId, from: r.transit?.from, to: r.transit?.to, duration: r.transit?.duration, walked: walkPositions.length, state: r.state };
    }, far.id);
    assert.equal(park.connector, `car-${archive}-residential`);
    assert.equal(park.legIndex, 1, 'the walk to the curb stop came first');
    assert.ok(park.walked > 60, `the resident walked to the pickup point (${park.walked} steps)`);
    const stopA = C.carStop(C.CYBER_TOWERS[0]), stopD = C.carStop(C.CYBER_TOWERS[3]);
    assert.deepEqual({ x: park.from.x, y: park.from.y }, { x: stopA.x * TILE + 8, y: stopA.y * TILE + 8 }, 'it boards at the Archive curb stop');
    assert.deepEqual({ x: park.to.x, y: park.to.y }, { x: stopD.x * TILE + 8, y: stopD.y * TILE + 8 }, 'and steps out at the Residential curb stop');
    const setRide = (frac) => page.evaluate((f) => {
      const t = window.__town, s = t.runtime.scene(), r = [...t.sim.residents.values()].find((x) => x.transit), ride = r.transit;
      const d = ride.duration, door = Math.min(0.55, Math.max(0.2, d * 0.2));
      ride.elapsed = f === 'board' ? door * 0.25 : f === 'exit' ? d - door * 0.25 : door + (d - 2 * door) * f; s.update(0, 0);
      const snap = s.transit.snapshot()[0], view = s.views.get(r.id);
      return { snap, x: r.x, y: r.y, spriteVisible: view.sprite.visible, residents: t.sim.residents.size, state: r.state, name: { visible: view.name.visible, overlayHidden: view.overlayHidden } };
    }, frac);
    const lane = R.eastLaneY, carBottom = lane + CAR.h / 2;
    // boarding: the resident is on the curb, the car waits in the lane beside it
    let f = await setRide('board');
    assert.equal(f.snap.kind, 'car'); assert.equal(f.snap.lane, 'east'); assert.equal(f.snap.phase, 'board');
    assert.equal(f.snap.y, carBottom, 'the car stands on the eastbound lane line');
    assert.ok(Math.abs(f.snap.x - park.from.x) < 0.5 && f.spriteVisible, 'the resident is still on the curb at the car door');
    assert.ok(f.snap.y - CAR.h >= f.y, 'the car is on the road, beyond the curb the resident stands on');
    await focus(page, f.snap.x, lane - 6, 3); await settle(page);
    const boardWith = await shot(page); await showTransit(page, false); await settle(page); const boardWithout = await shot(page); await showTransit(page, true);
    const boardRatio = await changedRatio(boardWith, boardWithout, await toBox(page, [f.snap.x - CAR.w / 2, lane - CAR.h / 2, CAR.w, CAR.h]));
    assert.ok(boardRatio > 0.4, `the car is drawn at the pickup point (${boardRatio.toFixed(2)})`);
    await fs.writeFile(path.join(output, 'car-1-boarding.png'), boardWith);
    // the whole ride, frame by frame: one car, in one lane, east of where it started, never across the divider
    const samples = [];
    for (let i = 0; i <= 60; i++) { const g = await setRide(i / 60); samples.push(g); }
    for (const g of samples) {
      assert.equal(g.snap.kind, 'car'); assert.equal(g.snap.lane, 'east'); assert.equal(g.residents, 1, 'one resident, no clone');
      assert.equal(g.snap.y, carBottom, 'the car never leaves its lane line');
      assert.ok(g.snap.y <= R.divider - R.dividerThickness / 2, 'its lower edge stays above the divider');
      assert.equal(g.spriteVisible, false, 'the rider sprite is hidden while it is inside the car');
      assert.ok(g.snap.depth < 0 && g.snap.depth > -11 && g.snap.depth === C.ROAD_RIDE_DEPTHS.car, 'in the road depth band, below every resident');
    }
    const xs = samples.map((g) => g.snap.x); assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-6) && xs[xs.length - 1] - xs[0] > 500, 'the car drives east along the lane');
    assert.match(samples[10].snap.label, /Residential Tower/, 'the car names its destination');
    f = await setRide(0.5);
    await focus(page, f.snap.x, lane - 6, 3); await settle(page);
    const midWith = await shot(page); await showTransit(page, false); await settle(page); const midWithout = await shot(page); await showTransit(page, true);
    const midBox = await toBox(page, [f.snap.x - CAR.w / 2, lane - CAR.h / 2, CAR.w, CAR.h]);
    const midRatio = await changedRatio(midWith, midWithout, midBox);
    assert.ok(midRatio > 0.4, `the car is drawn on the road mid-ride (${midRatio.toFixed(2)})`);
    // it is on the correct side of the divider in pixels: the divider row has no car in it
    const dividerRatio = await changedRatio(midWith, midWithout, await toBox(page, [f.snap.x - 60, R.divider - 1, 120, 2]));
    assert.ok(dividerRatio < 0.03, `the car does not touch the divider (${dividerRatio.toFixed(3)})`);
    await fs.writeFile(path.join(output, 'car-2-east-lane.png'), midWith);
    // exit
    f = await setRide('exit'); await focus(page, f.snap.x, lane - 6, 3); await settle(page); f = await setRide('exit'); await settle(page);
    assert.equal(f.snap.phase, 'exit'); assert.ok(f.spriteVisible, 'the resident steps out'); assert.ok(Math.abs(f.snap.x - park.to.x) < 0.5);
    await fs.writeFile(path.join(output, 'car-3-exit.png'), await shot(page));
    // then it walks the last leg to its post, one resident, no history, no log line, no write
    const done = await page.evaluate((hist0) => {
      const t = window.__town, s = t.runtime.scene(), r = [...t.sim.residents.values()][0];
      for (let i = 0; i < 4000 && (r.transit || r.state === 'moving'); i++) s.update(0, 50);
      for (let i = 0; i < 4; i++) s.update(0, 50);
      return { state: r.state, residents: t.sim.residents.size, history: r.history.map((h) => h.text), hist0, stats: s.transit.stats(), snap: s.transit.snapshot().length, x: Math.floor(r.x / 16), y: Math.floor(r.y / 16), bubble: r.bubble };
    }, park.hist0);
    assert.equal(done.state, 'posted'); assert.equal(done.residents, 1); assert.deepEqual({ x: done.x, y: done.y }, far.post);
    assert.deepEqual(done.history, done.hist0, 'the ride added nothing to the history');
    assert.equal(done.stats.active, 0, 'the ride visual went back to the pool'); assert.equal(done.snap, 0);
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], 'no write request');
    receipts.carEast = { legs: park.legs, connector: park.connector, durationSeconds: +park.duration.toFixed(2), boardRatio: +boardRatio.toFixed(2), midRatio: +midRatio.toFixed(2), dividerRatio: +dividerRatio.toFixed(3), carTrips, walkTrips };

    // a westbound ride: from the Residential district to the Library, then the Archive Tower lift (a car, then a lift)
    await openCyber(page, { base }); await freeze(page, { hideTraffic: true });
    const west = await page.evaluate(() => {
      const t = window.__town, sim = t.sim, s = t.runtime.scene();
      const id = 'h/main/westboundxxxxxxx';
      sim.push({ id: 'a1', agentId: id, seq: 1, at: 0, type: 'agent.spawned', role: 'coordinator', displayName: 'west', profile: 'work', paletteSlot: 1 });
      sim.push({ id: 'a2', agentId: id, seq: 2, at: 0, type: 'agent.assigned' });
      const boss = sim.residents.get(id);
      boss.x = 75 * 16 + 8; boss.y = 44 * 16 + 8; boss.queue.length = 0; boss.state = 'working'; boss.place = 'hall'; boss.hold = 0; boss.anim = 'stand';
      sim.push({ id: 'a3', agentId: id, seq: 3, at: 0, type: 'agent.tool_started', tool: 'read_file' });
      const runner = [...sim.residents.values()].find((r) => r.kind === 'runner');
      const legs = runner.legs.map((l) => (l.kind === 'walk' ? 'walk' : l.connectorId));
      let steps = 0; while (!runner.transit && steps < 4000) { s.update(0, 50); steps += 1; }
      return { id: runner.id, legs, connector: runner.transit?.connectorId, residents: sim.residents.size };
    });
    assert.deepEqual(west.legs.slice(0, 3), ['walk', 'car-residential-archive', 'walk'], `a westbound car along the street (${west.legs})`);
    assert.equal(west.connector, 'car-residential-archive'); assert.equal(west.residents, 2, 'the coordinator and its runner');
    const westLane = R.westLaneY, westBottom = westLane + CAR.h / 2;
    const setRideW = (frac) => page.evaluate((f) => {
      const t = window.__town, s = t.runtime.scene(), r = [...t.sim.residents.values()].find((x) => x.transit), ride = r.transit;
      const d = ride.duration, door = Math.min(0.55, Math.max(0.2, d * 0.2));
      ride.elapsed = door + (d - 2 * door) * f; s.update(0, 0);
      return { snap: s.transit.snapshot()[0], residents: t.sim.residents.size };
    }, frac);
    const wsamples = []; for (let i = 0; i <= 60; i++) wsamples.push(await setRideW(i / 60));
    for (const g of wsamples) { assert.equal(g.snap.lane, 'west'); assert.equal(g.snap.y, westBottom, 'the westbound car holds its lane line'); assert.ok(g.snap.y - CAR.h > R.divider + R.dividerThickness / 2, 'wholly on the far side of the divider'); assert.equal(g.residents, 2); }
    const wxs = wsamples.map((g) => g.snap.x); assert.ok(wxs.every((x, i) => i === 0 || x <= wxs[i - 1] + 1e-6) && wxs[0] - wxs[wxs.length - 1] > 500, 'the car drives west');
    const wmid = await setRideW(0.5);
    await focus(page, wmid.snap.x, westLane - 6, 3); await settle(page);
    const wWith = await shot(page); await showTransit(page, false); await settle(page); const wWithout = await shot(page); await showTransit(page, true);
    const wRatio = await changedRatio(wWith, wWithout, await toBox(page, [wmid.snap.x - CAR.w / 2, westLane - CAR.h / 2, CAR.w, CAR.h]));
    assert.ok(wRatio > 0.4, `the westbound car is drawn on the far lane (${wRatio.toFixed(2)})`);
    await fs.writeFile(path.join(output, 'car-4-west-lane.png'), wWith);
    receipts.carWest = { legs: west.legs, lane: 'west', ratio: +wRatio.toFixed(2) };

    // trips to the same or a neighbouring district never take a car: watched through whole rides in the rendered scene
    const neighbours = [];
    for (const [fromX, tool] of [[30, 'read_file'], [50, 'write_file'], [10, 'web_search']]) {
      await openCyber(page, { base }); await freeze(page, { hideTraffic: true });
      const out = await page.evaluate(({ fromX: fx, tool: tl }) => {
        const t = window.__town, sim = t.sim, s = t.runtime.scene();
        const id = 'h/main/neighbourxxxxxxx';
        sim.push({ id: 'n1', agentId: id, seq: 1, at: 0, type: 'agent.spawned', role: 'coordinator', displayName: 'near', profile: 'work', paletteSlot: 1 });
        sim.push({ id: 'n2', agentId: id, seq: 2, at: 0, type: 'agent.assigned' });
        const boss = sim.residents.get(id);
        boss.x = fx * 16 + 8; boss.y = 44 * 16 + 8; boss.queue.length = 0; boss.state = 'working'; boss.place = 'hall'; boss.hold = 0;
        sim.push({ id: 'n3', agentId: id, seq: 3, at: 0, type: 'agent.tool_started', tool: tl });
        const runner = [...sim.residents.values()].find((r) => r.kind === 'runner');
        const kinds = new Set(); const first = runner.legs.map((l) => (l.kind === 'walk' ? 'walk' : l.connectorId));
        for (let i = 0; i < 1200; i++) { s.update(0, 50); for (const sn of s.transit.snapshot()) kinds.add(sn.kind); }
        return { fromX: fx, tool: tl, first, kinds: [...kinds], place: runner.place };
      }, { fromX, tool });
      assert.ok(!out.first.some((k) => k.startsWith('car-')) && !out.kinds.includes('car'), `a trip from tile ${fromX} for ${tool} takes no car (${out.first})`);
      neighbours.push(out);
    }
    receipts.noCar = neighbours.map((n) => ({ from: n.fromX, tool: n.tool, legs: n.first }));
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], 'no write request');
    await ctx.close();
  }

  // ---------------------------------------------------------- 3b. reduced motion: the car stands at the stops, never glides
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`car reduced: ${e.message}`));
    await openCyber(page, { reduced: true, base }); await freeze(page, { hideTraffic: true });
    const out = await page.evaluate(() => {
      const t = window.__town, sim = t.sim, s = t.runtime.scene();
      for (let i = 0; i < 10; i++) sim.push({ id: `k${i}`, agentId: `h/cron/${String(i).padStart(16, 'k')}`, seq: 1, at: 0, type: 'agent.spawned', role: 'scheduled', displayName: `job ${i}` });
      s.update(0, 50);
      const carRes = [...sim.residents.values()].find((x) => x.legs.some((l) => l.kind !== 'walk'));
      for (const r of [...sim.residents.values()]) if (r !== carRes) sim.residents.delete(r.id);
      const r = [...sim.residents.values()][0];
      let steps = 0; while (!r.transit && steps < 4000) { s.update(0, 50); steps += 1; }
      const ride = r.transit, d = ride.duration; const xs = new Set(), labels = new Set(), reduced = new Set();
      for (let i = 0; i <= 40; i++) { ride.elapsed = (d * i) / 40 - (i === 40 ? 0.01 : 0); s.update(0, 0); const sn = s.transit.snapshot()[0]; xs.add(Math.round(sn.x)); labels.add(sn.label); reduced.add(sn.reduced); }
      return { xs: [...xs], labels: [...labels], reduced: [...reduced], from: ride.from.x, to: ride.to.x };
    });
    assert.deepEqual([...out.reduced], [true]);
    assert.equal(out.xs.length, 2, `reduced motion: exactly two stops (${out.xs})`);
    assert.deepEqual(out.xs.sort((a, b) => a - b), [Math.round(out.from), Math.round(out.to)].sort((a, b) => a - b), 'the pickup stop and the drop-off stop');
    assert.ok(out.labels.every((l) => /^Car → \S/.test(l)), 'a static destination cue is shown');
    receipts.carReduced = { stops: out.xs, label: out.labels[0] };
    await ctx.close();
  }

  // ====================================================================== 4. camera floor
  {
    const maps = ['town', 'greenwood', 'cyber-city', 'orbital-system'];
    const viewports = [[1672, 940], [1280, 720], [900, 1100]];
    const camState = (page) => page.evaluate(() => {
      const s = window.__town.runtime.scene(), cam = s.cameras.main, v = cam.worldView, m = window.__town.map;
      return { zoom: cam.zoom, floor: s.zoomFloor(), vw: s.scale.width, vh: s.scale.height, W: m.grid.w * 16, H: m.grid.h * 16, view: { x: v.x, y: v.y, r: v.right, b: v.bottom }, centre: { x: cam.midPoint.x, y: cam.midPoint.y }, map: window.__town.runtime.preset.id };
    });
    /** The invariant: at or above the floor the page computed, the floor equals the independent formula, and the window is inside the world. */
    const cameraFault = (st) => {
      const expected = C.zoomFloor(st.vw, st.vh, st.W, st.H);
      if (Math.abs(st.floor - expected) > 1e-6) return `the scene's floor ${st.floor} differs from the formula ${expected}`;
      if (st.zoom < expected - 1e-4) return `zoom ${st.zoom.toFixed(3)} is below the floor ${expected.toFixed(3)}`;
      if (st.view.x < -0.6 || st.view.y < -0.6 || st.view.r > st.W + 0.6 || st.view.b > st.H + 0.6) return `the view ${JSON.stringify(st.view)} shows space beyond the world ${st.W}x${st.H}`;
      return null;
    };
    const mustHold = async (page, label) => { await settle(page, 3); const st = await camState(page); assert.equal(cameraFault(st), null, `${label}: ${cameraFault(st)}`); return st; };
    const results = {};
    for (const mapId of maps) for (const [vi, [vw, vh]] of viewports.entries()) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`camera ${mapId}: ${e.message}`));
      await page.goto(`${base}/?agents=demo&hour=12&map=${mapId}`); await ready(page);
      await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
      const tag = `${mapId} ${vw}x${vh}`;
      const first = await mustHold(page, `${tag} opening overview`);
      assert.equal(first.map, mapId);
      await page.evaluate(() => { const s = window.__town.runtime.scene(); s.setDirector(false); });
      // wheel: out, many times, then in
      await page.mouse.move(vw / 2, vh / 2);
      for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(450); const st = await camState(page); assert.equal(cameraFault(st), null, `${tag} wheel out #${i}: ${cameraFault(st)}`); }
      const out = await mustHold(page, `${tag} after wheel out`);
      assert.ok(out.zoom <= out.floor + 1e-3, `${tag}: the wheel reaches the floor and stops there (${out.zoom.toFixed(3)} vs ${out.floor.toFixed(3)})`);
      for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(450); }
      const inn = await mustHold(page, `${tag} after wheel in`);
      assert.ok(inn.zoom >= 4.99 && inn.zoom <= 5.01, `${tag}: zooming in still reaches 5x (${inn.zoom.toFixed(2)})`);
      // the HUD buttons
      await page.click('#overview'); await page.waitForTimeout(150); await mustHold(page, `${tag} overview button`);
      for (const place of ['library', 'tavern', 'hall']) { await page.click(`[data-goto="${place}"]`).catch(() => null); await page.waitForTimeout(650); await mustHold(page, `${tag} go to ${place}`); }
      // follow: select a resident and follow it, at 3x or the floor, whichever is closer in
      const follow = await page.evaluate(() => { const t = window.__town, s = t.runtime.scene(); const r = t.sim.active()[0] ?? [...t.sim.residents.values()][0]; s.select(r.id); return Boolean(r); });
      assert.ok(follow);
      await page.click('#follow'); await page.waitForTimeout(400); const fst = await mustHold(page, `${tag} follow`);
      assert.ok(fst.zoom >= Math.min(3, fst.floor) - 1e-3);
      await page.click('#follow'); await page.waitForTimeout(100);
      // programmatic: overview, a lowered camera, and a tween aimed below the floor
      await page.evaluate(() => { const s = window.__town.runtime.scene(); s.overview(); }); await mustHold(page, `${tag} programmatic overview`);
      await page.evaluate(() => { const s = window.__town.runtime.scene(); s.cameras.main.setZoom(0.15); }); await mustHold(page, `${tag} camera set to 0.15`);
      await page.evaluate(() => { const s = window.__town.runtime.scene(); s.tweens.add({ targets: s.cameras.main, zoom: 0.1, duration: 120 }); }); await page.waitForTimeout(350); await mustHold(page, `${tag} tween to 0.1`);
      // resize: smaller, larger, odd; the camera is raised to the new floor and never shows beyond the world (on the first window size of each map)
      const resized = []; let jump = 0;
      if (vi === 0) {
      for (const [rw, rh] of [[Math.round(vw * 0.6), Math.round(vh * 0.7)], [Math.round(vw * 1.5), Math.round(vh * 1.4)], [1000, 1000], [vw, vh]]) {
        await page.setViewportSize({ width: Math.max(700, rw), height: Math.max(400, rh) }); await page.waitForTimeout(1250);
        const st = await mustHold(page, `${tag} resized to ${rw}x${rh}`); resized.push({ size: `${st.vw}x${st.vh}`, zoom: +st.zoom.toFixed(3), floor: +st.floor.toFixed(3) });
      }
      // no jump on resize for a camera the viewer has placed: zoomed in, moved, then a modest resize
      await page.evaluate(() => { const s = window.__town.runtime.scene(); s.cameras.main.setZoom(3); s.cameras.main.centerOn(s.cameras.main.midPoint.x, s.cameras.main.midPoint.y); });
      await page.mouse.move(vw / 2, vh / 2); await page.mouse.down(); await page.mouse.move(vw / 2 + 30, vh / 2 + 20, { steps: 4 }); await page.mouse.up();
      const placed = await mustHold(page, `${tag} placed camera`);
      await page.setViewportSize({ width: Math.max(700, vw - 120), height: Math.max(400, vh - 80) }); await page.waitForTimeout(1250);
      const afterResize = await mustHold(page, `${tag} resize with a placed camera`);
      jump = Math.hypot(afterResize.centre.x - placed.centre.x, afterResize.centre.y - placed.centre.y);
      assert.ok(Math.abs(afterResize.zoom - Math.max(placed.zoom, afterResize.floor)) < 0.02, `${tag}: a placed camera keeps its zoom through a resize (${placed.zoom.toFixed(2)} -> ${afterResize.zoom.toFixed(2)})`);
      assert.ok(jump < (120 + 80) / placed.zoom + 20, `${tag}: the camera centre moves by half the size change, no more (${jump.toFixed(1)} px)`);
      }
      results[tag] = { floor: +first.floor.toFixed(3), openingZoom: +first.zoom.toFixed(3), wheelOutZoom: +out.zoom.toFixed(3), wheelInZoom: +inn.zoom.toFixed(2), resized, jumpOnResize: +jump.toFixed(1) };
      await ctx.close();
    }
    receipts.camera = results;

    // the check has teeth: with the guard off, a lowered camera is caught by the same invariant; with it on, it is raised again
    {
      const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
      const page = await ctx.newPage();
      await page.goto(`${base}/?agents=demo&hour=12&theme=cyber-city`); await ready(page); await page.evaluate(() => window.__town.runtime.scene().setDirector(false));
      await page.evaluate(() => { const s = window.__town.runtime.scene(); s.enforceZoomFloor = false; s.cameras.main.setZoom(0.2); });
      await settle(page, 4);
      const lowered = await camState(page);
      assert.ok(cameraFault(lowered) !== null, `control: a camera lowered with the guard off is caught (${cameraFault(lowered)})`);
      await fs.writeFile(path.join(output, 'camera-control-lowered.png'), await shot(page));
      await page.evaluate(() => { window.__town.runtime.scene().enforceZoomFloor = true; });
      const restored = await mustHold(page, 'guard back on');
      assert.ok(restored.zoom >= restored.floor - 1e-4, 'the guard raises the camera back to the floor');
      receipts.cameraControl = { loweredFault: cameraFault(lowered), restoredZoom: +restored.zoom.toFixed(3) };
      await fs.writeFile(path.join(output, 'camera-floor-cyber-city.png'), await shot(page));
      await ctx.close();
    }

    // changing maps through the Appearance panel: every new scene starts at a valid framing, and no camera jumps
    {
      const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`camera map change: ${e.message}`));
      await page.goto(`${base}/?agents=demo&hour=12`); await ready(page);
      const seen = [];
      for (const id of ['cyber-city', 'orbital-system', 'greenwood', 'town', 'cyber-city']) {
        await open(page); await page.selectOption('#ap-map', id); await page.click('#ap-map-apply');
        await page.waitForFunction((m) => window.__town.runtime.preset.id === m && window.__town.runtime.scene()?.textures.exists('art-tree0'), id, { timeout: 30000 });
        await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
        await page.evaluate(() => window.__town.runtime.scene().setDirector(false));
        const st = await mustHold(page, `map change to ${id}`);
        const v = await page.evaluate(() => window.__town.runtime.preset.view);
        const expectedCentre = { x: Math.min(Math.max(v.centerX * 16, st.vw / st.zoom / 2), st.W - st.vw / st.zoom / 2), y: Math.min(Math.max(v.centerY * 16, st.vh / st.zoom / 2), st.H - st.vh / st.zoom / 2) };
        assert.ok(Math.hypot(st.centre.x - expectedCentre.x, st.centre.y - expectedCentre.y) < 8, `${id}: the camera opens on the map's own overview (${JSON.stringify(st.centre)} vs ${JSON.stringify(expectedCentre)})`);
        seen.push({ id, zoom: +st.zoom.toFixed(3), floor: +st.floor.toFixed(3) });
      }
      receipts.cameraMapChanges = seen;
      await ctx.close();
    }

    // a two-finger gesture (the scene has no pinch zoom): it cannot take the camera below the floor either
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
      const page = await ctx.newPage();
      await page.goto(`${base}/?agents=demo&hour=12&theme=cyber-city`); await ready(page); await page.evaluate(() => window.__town.runtime.scene().setDirector(false));
      const cdp = await ctx.newCDPSession(page);
      const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
      await touch('touchStart', [[500, 360], [780, 360]]);
      for (let i = 1; i <= 8; i++) await touch('touchMove', [[500 + i * 20, 360], [780 - i * 20, 360]]);
      await touch('touchEnd', []);
      await page.waitForTimeout(300);
      await mustHold(page, 'pinch gesture');
      await page.touchscreen.tap(640, 360); await mustHold(page, 'tap');
      receipts.cameraTouch = { pinchZoom: 'not implemented by the scene; a two-finger gesture leaves the camera at or above the floor' };
      await ctx.close();
    }
  }
} finally {
  await pixels.close();
  await calc.close();
  await browser.close();
  await town.close?.();
  await fs.rm(temp, { recursive: true, force: true });
}

assert.deepEqual(errors, [], 'no browser error');
console.log(JSON.stringify({ ok: true, ...receipts }, null, 2));
