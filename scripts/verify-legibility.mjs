// Visual legibility verification: do the Appearance choices read to a person at the
// normal live viewport, not just in resolved state?
//
// Runs against the production build served by the real Town server on loopback (run
// `npm run build` first). All events are synthetic. Everything here is measured on
// what the canvas actually draws, at a live-style 1672x940 viewport and the default
// overview camera, with the HUD hidden so only the Town canvas is compared.
//
//   - People kits: a staged row of residents (profile colours 0-5 plus one without)
//     is rendered under Townsfolk, Market folk and Plain clothes. Every resident's own
//     screen box must differ materially between every pair of kits, the profile colour
//     must still be on screen in each, and nothing about the residents changes.
//   - Mist: a measurable fog layer across the visible world, drifting in full motion,
//     held still but still there under reduced motion, never over a resident's name tag.
//   - Rain: a dense streak layer and ground ripples, falling in full motion, a static
//     cue under reduced motion; decorative only.
//   - Greenwood vs Town at the default overview: a large, deliberate difference on the
//     main canvas and on the minimap, with more water and a brighter ground; Reset
//     returns the same Town ground and the same minimap, byte for byte.
//   - Throughout: one canvas, no browser errors, no write to the live bridge.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/legibility');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-legibility-'));
const token = crypto.randomBytes(32).toString('base64url');
const town = createTownServer({ token, journalPath: path.join(temp, 'journal.jsonl'), staticRoot: path.join(root, 'dist') });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
const receipts = { syntheticActivity: true };
const VIEWPORT = { width: 1672, height: 940 };

const ready = (page) => page.waitForFunction(() => {
  const s = window.__town?.runtime?.scene?.();
  return Boolean(s && s.textures.exists('art-tree0') && s.appearance);
}, null, { timeout: 30000 });
const settle = (page, n = 4) => page.evaluate((frames) => new Promise((resolve) => {
  const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1)));
  tick(frames);
}), n);
const open = async (page) => { if (await page.locator('#appearance').isHidden()) { await page.click('#appearance-toggle'); await page.waitForSelector('#appearance:not([hidden])'); } };
const hasKit = (page, tag) => page.waitForFunction((tg) => { const v = [...window.__town.runtime.scene().views.values()]; return v.length > 0 && v.every((x) => (tg === '' ? !/-(mf|pc)$/.test(x.key) : x.key.endsWith(`-${tg}`))); }, tag, { timeout: 30000 });
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** Run a capture with every HUD element hidden, so the pixels are the Town canvas alone. */
const bare = async (page, fn) => {
  await page.evaluate(() => {
    if (!document.getElementById('bare-style')) { const s = document.createElement('style'); s.id = 'bare-style'; s.textContent = 'html.bare body > *:not(#game){visibility:hidden !important}'; document.head.append(s); }
    document.documentElement.classList.add('bare');
  });
  try { return await fn(); } finally { await page.evaluate(() => document.documentElement.classList.remove('bare')); }
};
const shot = (page) => bare(page, () => page.locator('#game canvas').screenshot());

// ---- pixel measurements on decoded PNGs: these read what is drawn, not what is resolved.
let calc = null;
const measure = async (a, b, { box = null, tolerance = 24, empty = null } = {}) => {
  calc ??= await browser.newPage();
  return calc.evaluate(async ([x, y, tol, area, bg]) => {
    const load = (b64) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); resolve(g.getImageData(0, 0, img.width, img.height)); };
      img.onerror = reject;
      img.src = `data:image/png;base64,${b64}`;
    });
    const A = await load(x), B = await load(y), E = bg ? await load(bg) : null;
    if (A.width !== B.width || A.height !== B.height) return { ratio: 1, sameSize: false };
    const [x0, y0, w, h] = area ?? [0, 0, A.width, A.height];
    const far = (P, Q, k) => Math.abs(P.data[k] - Q.data[k]) > tol || Math.abs(P.data[k + 1] - Q.data[k + 1]) > tol || Math.abs(P.data[k + 2] - Q.data[k + 2]) > tol;
    let n = 0, sprite = 0;
    for (let j = Math.max(0, y0); j < Math.min(A.height, y0 + h); j++) for (let i = Math.max(0, x0); i < Math.min(A.width, x0 + w); i++) {
      const k = (j * A.width + i) * 4;
      if (far(A, B, k)) n += 1;
      if (E && (far(A, E, k) || far(B, E, k))) sprite += 1;
    }
    // with a background capture, the ratio is the share of the resident's own pixels that changed; without one, the share of the box
    return { ratio: E ? n / Math.max(1, sprite) : n / (w * h), changed: n, sprite, sameSize: true };
  }, [a.toString('base64'), b.toString('base64'), tolerance, box, empty ? empty.toString('base64') : null]);
};
/** Pixel statistics of one PNG: mean colour, and counts of colour classes. */
const stats = async (png, { near = [], hues = [], box = null } = {}) => {
  calc ??= await browser.newPage();
  return calc.evaluate(async ([b64, targets, area, hueTargets]) => {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = `data:image/png;base64,${b64}`; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const [x0, y0, w, h] = area ?? [0, 0, img.width, img.height];
    const d = g.getImageData(x0, y0, w, h).data;
    let r = 0, gr = 0, b = 0, blue = 0, light = 0; const hits = targets.map(() => 0), hueHits = hueTargets.map(() => 0);
    const hueOf = (R, G, B) => { const mx = Math.max(R, G, B), mn = Math.min(R, G, B), c = mx - mn; if (c === 0) return [0, 0]; const h = mx === R ? ((G - B) / c + 6) % 6 : mx === G ? (B - R) / c + 2 : (R - G) / c + 4; return [h * 60, c / mx]; };
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; gr += d[i + 1]; b += d[i + 2];
      if (d[i + 2] > d[i] + 28 && d[i + 2] > d[i + 1] - 4) blue += 1;
      if (d[i] > 215 && d[i + 1] > 215 && d[i + 2] > 215) light += 1;
      targets.forEach(([tr, tg, tb, dist], k) => { if (Math.hypot(d[i] - tr, d[i + 1] - tg, d[i + 2] - tb) <= dist) hits[k] += 1; });
      if (hueTargets.length) {
        const [hh, ss] = hueOf(d[i], d[i + 1], d[i + 2]);
        hueTargets.forEach(([th, tol, minSat], k) => { const dh = Math.min(Math.abs(hh - th), 360 - Math.abs(hh - th)); if (dh <= tol && ss >= minSat) hueHits[k] += 1; });
      }
    }
    const n = d.length / 4;
    return { mean: [r / n, gr / n, b / n].map((v) => +v.toFixed(1)), blue: blue / n, light: light / n, hits, hueHits };
  }, [png.toString('base64'), near, box, hues]);
};

const mini = (page) => page.evaluate(() => document.querySelector('#minimap').toDataURL('image/png'));
const frozen = (page) => page.evaluate(() => { const t = window.__town; t.source.stop(); t.sim.update = () => {}; t.sim.push = () => {}; });

/**
 * A controlled stage: the residents of the page are replaced by seven synthetic
 * sessions (six with profile colour slots, one without) standing in a row on the
 * plaza, the simulator is held still, and the camera is at the default overview.
 * Nothing is ingested and nothing is sent to the server.
 */
const stage = async (page) => {
  await page.evaluate(() => {
    const t = window.__town, sim = t.sim;
    t.source.stop();
    sim.residents.clear();
    const roles = ['coordinator', 'research', 'fabrication', 'review', 'tooling', 'general', 'scheduled'];
    roles.forEach((role, i) => sim.push({
      id: `stage-${i}`, seq: i + 1, at: sim.now(), agentId: `h/main/stage${String(i).padStart(12, '0')}`, type: 'agent.spawned', role,
      displayName: `stage ${i}`, ...(i === 0 ? {} : { profile: `p${i}`, paletteSlot: i - 1 }),
    }));
    sim.update = () => {}; sim.push = () => {};
    [...sim.residents.values()].forEach((r, i) => { r.x = (46 + i * 3.2) * 16; r.y = 38.5 * 16; r.state = 'idle'; r.anim = 'idle'; });
    const s = t.runtime.scene();
    s.setDirector(false); s.overview();
    s.cloudBlobs?.splice?.(0); // cloud shadow positions are random; remove them so repeat captures can be compared exactly
  });
  await settle(page, 8);
};
/** Screen boxes of the staged residents at the current camera. */
const boxes = (page) => page.evaluate(() => {
  const s = window.__town.runtime.scene(), c = s.cameras.main, z = c.zoom;
  return [...window.__town.sim.residents.values()].map((r) => {
    const cx = (r.x - c.worldView.x) * z, foot = (r.y + 7 - c.worldView.y) * z;
    return { id: r.id, slot: r.profileSlot ?? null, box: [Math.round(cx - 14 * z), Math.round(foot - 35 * z), Math.round(28 * z), Math.round(40 * z)] };
  });
});
const facts = (page) => page.evaluate(() => [...window.__town.sim.residents.values()].map((r) => ({ id: r.id, role: r.role, name: r.name, profile: r.profile ?? null, profileSlot: r.profileSlot ?? null, history: r.history.map((h) => h.text) })).sort((a, b) => (a.id < b.id ? -1 : 1)));
const resolved = (page) => page.evaluate(() => { const a = window.__town.runtime.scene().appearance(); return { people: a.people.id, map: a.map.id, weather: a.environment.weather, reduced: a.environment.reducedMotion }; });
const select = async (page, id, value) => { await open(page); await page.selectOption(id, value); await page.evaluate(() => window.__town.runtime.scene().cloudBlobs?.splice?.(0)); await settle(page, 6); };
const grade = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// The Classic grade at midday multiplies by about (0.99, 0.96, 0.91): the rendered profile colour is the palette colour times that.
const rendered = (hex) => { const [r, g, b] = grade(hex); return [r * 0.99, g * 0.96, b * 0.91]; };
const hueDeg = (hex) => { const [r, g, b] = grade(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn; const h = mx === r ? ((g - b) / c + 6) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4; return h * 60; };
const PROFILE_PALETTE = ['#c0392b', '#2e6fd0', '#2fa35a', '#e0a81e', '#8e44ad', '#17a2a2'];

try {
  const { port } = await town.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const requests = [];

  // ====================================================== people kits, normal view
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`kits: ${e.message}`));
    page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) requests.push(`${req.method()} ${u.pathname}`); });
    await page.goto(`${base}/?agents=demo&hour=12`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await stage(page);
    const zoom = await page.evaluate(() => window.__town.runtime.scene().cameras.main.zoom);
    assert.ok(zoom > 1 && zoom < 1.3, `the default overview is the normal live scale (zoom ${zoom})`);
    const stageBoxes = await boxes(page);
    const factsBefore = await facts(page);
    const shots = {}, pairs = {};
    for (const [label, value, tag] of [['townsfolk', 'townsfolk', ''], ['market-folk', 'market-folk', 'mf'], ['plainclothes', 'plainclothes', 'pc']]) {
      await select(page, '#ap-people', value);
      await hasKit(page, tag); await settle(page, 6);
      shots[label] = await shot(page);
      await fs.writeFile(path.join(output, `kit-${label}.png`), shots[label]);
    }
    assert.deepEqual(await facts(page), factsBefore, 'resident ids, names, roles, profiles and history are untouched by the kits');
    // the same view with nobody in it: what is the resident and what is the plaza
    await page.evaluate(() => { window.__town.sim.residents.clear(); });
    await settle(page, 8);
    const emptyShot = await shot(page);
    await fs.writeFile(path.join(output, 'kit-empty.png'), emptyShot);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#game canvas').length), 1);
    const min = { v: 1 };
    for (const [a, b] of [['townsfolk', 'market-folk'], ['townsfolk', 'plainclothes'], ['market-folk', 'plainclothes']]) {
      const per = [];
      for (const r of stageBoxes) per.push(+(await measure(shots[a], shots[b], { box: r.box, tolerance: 24, empty: emptyShot })).ratio.toFixed(3));
      pairs[`${a} vs ${b}`] = per;
      // Each resident's whole screen box (28x40 css px at the normal view): a sixth of its pixels must change, for every resident.
      const floor = a === 'townsfolk' && b === 'plainclothes' ? 0.2 : 0.5, mean = per.reduce((x, y) => x + y, 0) / per.length;
      for (let i = 0; i < per.length; i++) assert.ok(per[i] >= floor, `${a} vs ${b}: resident ${i} changes only ${(per[i] * 100).toFixed(1)}% of its own pixels at the normal view`);
      assert.ok(mean >= (floor === 0.2 ? 0.4 : 0.55), `${a} vs ${b}: on average ${(mean * 100).toFixed(1)}% of each resident's pixels change`);
      min.v = Math.min(min.v, ...per);
    }
    // the profile colour is an obvious identity layer under every kit: its (graded) hue is on the resident's screen box
    const profileHits = {};
    for (const label of Object.keys(shots)) {
      profileHits[label] = [];
      for (const r of stageBoxes) {
        if (r.slot === null) continue;
        const [tr, tg, tb] = rendered(PROFILE_PALETTE[r.slot]);
        const s = await stats(shots[label], { box: r.box, near: [[tr, tg, tb, 38]] });
        profileHits[label].push(s.hits[0]);
        assert.ok(s.hits[0] >= 25, `${label}: profile colour ${PROFILE_PALETTE[r.slot]} is on screen for slot ${r.slot} (${s.hits[0]}px)`);
      }
    }
    // Market folk read as festive: crimson, gold and plum on every resident that Townsfolk do not carry
    const marketAccent = await stats(shots['market-folk'], { near: [[0xd6, 0x45, 0x6a, 40]], box: [stageBoxes[0].box[0] - 10, stageBoxes[0].box[1] - 20, stageBoxes.at(-1).box[0] + 40 - stageBoxes[0].box[0], 120] });
    const townAccent = await stats(shots.townsfolk, { near: [[0xd6, 0x45, 0x6a, 40]], box: [stageBoxes[0].box[0] - 10, stageBoxes[0].box[1] - 20, stageBoxes.at(-1).box[0] + 40 - stageBoxes[0].box[0], 120] });
    assert.ok(marketAccent.hits[0] > townAccent.hits[0] + 60, `Market folk carry crimson accents Townsfolk do not (${townAccent.hits[0]} -> ${marketAccent.hits[0]})`);
    assert.deepEqual(requests.filter((q) => !q.startsWith('GET ')), [], 'kit changes write nothing');
    receipts.kits = { zoom: +zoom.toFixed(3), viewport: VIEWPORT, residentBoxPixelsChanged: pairs, minimumChanged: +min.v.toFixed(3), profileColourPixels: profileHits, marketCrimsonPixels: [townAccent.hits[0], marketAccent.hits[0]] };
    await ctx.close();
  }

  // ====================================================== weather, normal view
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`weather: ${e.message}`));
    await page.goto(`${base}/?agents=demo&hour=12`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await stage(page);
    const stageBoxes = await boxes(page);
    // `motion` first: full motion for the moving captures, then reduced for the static ones
    const take = async (weather, motion) => {
      await select(page, '#ap-motion', motion);
      await select(page, '#ap-weather', weather);
      await page.waitForTimeout(300); await settle(page, 4);
      const a = await shot(page);
      await page.waitForTimeout(1400);
      const b = await shot(page);
      await fs.writeFile(path.join(output, `${weather}-${motion}.png`), a);
      const d = await page.evaluate(() => { const e = window.__town.runtime.scene().appearance().environment; return { rain: e.rain, falls: e.rainFalls, fog: e.fogAlpha, sheet: e.rainSheetAlpha, drift: e.fogDrift, ripple: e.rippleRate }; });
      return { a, b, d };
    };
    const clearFull = await take('clear', 'full'), clearReduced = await take('clear', 'reduced');
    const mistFull = await take('mist', 'full'), mistReduced = await take('mist', 'reduced');
    const rainFull = await take('rain', 'full'), rainReduced = await take('rain', 'reduced');
    const vs = async (x, y) => (await measure(x.a, y.a, { tolerance: 16 })).ratio;
    const drift = async (x) => (await measure(x.a, x.b, { tolerance: 12 })).ratio;

    // ---- mist: a layered, drifting fog bank across the visible world
    const mistLayer = await vs(mistFull, clearFull), mistStatic = await vs(mistReduced, clearReduced);
    assert.ok(mistLayer >= 0.55, `mist covers most of the visible world (${(mistLayer * 100).toFixed(1)}% of pixels changed from clear)`);
    assert.ok(mistStatic >= 0.45, `mist is still plainly there under reduced motion (${(mistStatic * 100).toFixed(1)}%)`);
    const mistDrift = await drift(mistFull), mistStill = await drift(mistReduced), clearNoise = await drift(clearFull), clearStill = await drift(clearReduced);
    assert.ok(mistDrift > clearNoise + 0.01 && mistDrift > 0.02, `fog banks drift in full motion (${(mistDrift * 100).toFixed(2)}% vs ${(clearNoise * 100).toFixed(2)}% on a clear day)`);
    assert.ok(mistStill < mistDrift / 8 && mistStill <= clearStill + 0.01, `reduced motion holds the fog still (${(mistStill * 100).toFixed(2)}% vs ${(mistDrift * 100).toFixed(2)}%; a clear reduced day moves ${(clearStill * 100).toFixed(2)}%)`);
    assert.equal(mistFull.d.drift, 1); assert.equal(mistReduced.d.drift, 0); assert.ok(mistReduced.d.fog > 0);
    // fog is a haze, not a curtain: the staged residents keep their profile colour on screen through it
    const clearStats = await stats(clearFull.a), mistStats = await stats(mistFull.a);
    const through = [];
    for (const r of stageBoxes) {
      if (r.slot === null) continue;
      // haze lifts and softens a colour but keeps its hue: look for the profile hue, not the exact colour
      const s = await stats(mistFull.a, { box: r.box, hues: [[hueDeg(PROFILE_PALETTE[r.slot]), 14, 0.12]] });
      through.push(s.hueHits[0]);
      assert.ok(s.hueHits[0] >= 20, `a resident (slot ${r.slot}) can still be told by profile colour through the mist (${s.hueHits[0]}px)`);
    }
    const lum = (m) => 0.3 * m[0] + 0.6 * m[1] + 0.1 * m[2], sat = (m) => Math.max(...m) - Math.min(...m);
    assert.ok(lum(mistStats.mean) > lum(clearStats.mean) + 12 && sat(mistStats.mean) < sat(clearStats.mean) - 4, `mist lifts and greys the whole view (brightness ${lum(clearStats.mean).toFixed(1)} -> ${lum(mistStats.mean).toFixed(1)}, colourfulness ${sat(clearStats.mean).toFixed(1)} -> ${sat(mistStats.mean).toFixed(1)})`);
    // the fog layer sits below name tags, bubbles and emotes
    const depths = await page.evaluate(() => { const s = window.__town.runtime.scene(); return { fog: s.fogLayers.map((l) => l.sprite.depth), names: [...s.views.values()].map((v) => v.name.depth) }; });
    assert.equal(depths.fog.length, 3, 'three fog banks');
    assert.ok(Math.max(...depths.fog) < Math.min(...depths.names), 'fog is drawn under every name tag');

    // ---- rain: dense streaks and ripples, falling; a static cue under reduced motion
    const rainLayer = await vs(rainFull, clearFull), rainStatic = await vs(rainReduced, clearReduced);
    assert.ok(rainLayer >= 0.2, `rain is a dense layer over the visible world (${(rainLayer * 100).toFixed(1)}% of pixels changed from clear)`);
    assert.ok(rainStatic >= 0.12, `reduced motion keeps a static rain cue (${(rainStatic * 100).toFixed(1)}%)`);
    const rainDrift = await drift(rainFull), rainStill = await drift(rainReduced);
    assert.ok(rainDrift > 0.12, `rain falls: consecutive frames differ in ${(rainDrift * 100).toFixed(1)}% of pixels`);
    assert.ok(rainStill < rainDrift / 6 && rainStill <= clearStill + 0.015, `reduced motion stops the rain from falling (${(rainStill * 100).toFixed(2)}% vs ${(rainDrift * 100).toFixed(2)}%)`);
    assert.deepEqual([rainFull.d.rain, rainFull.d.falls, rainReduced.d.rain, rainReduced.d.falls], [true, true, false, false]);
    assert.ok(rainReduced.d.sheet > 0 && rainReduced.d.sheet < rainFull.d.sheet, 'the static cue is gentler than the falling rain');
    await select(page, '#ap-motion', 'full'); await select(page, '#ap-weather', 'rain'); await settle(page, 6);
    const ripples = await page.evaluate(() => { const s = window.__town.runtime.scene(); return { zone: Boolean(s.rippleZone), width: s.rippleZone?.width ?? 0, view: s.cameras.main.worldView.width }; });
    assert.ok(ripples.zone && Math.abs(ripples.width - ripples.view) < 1, 'ripples fall across the visible camera area');
    const camera = await page.evaluate(() => { const s = window.__town.runtime.scene(); return { zoom: s.cameras.main.zoom, parts: s.sys.displayList.list.filter((o) => o.type === 'ParticleEmitter' && o.texture?.key === 'ripple').length }; });
    assert.ok(camera.parts >= 1, 'a ripple emitter is live while it rains');
    // weather is decoration: the same residents, the same facts
    assert.deepEqual((await facts(page)).map((f) => f.id), stageBoxes.map((b) => b.id).sort());
    receipts.weather = {
      mistFromClear: +mistLayer.toFixed(3), mistReducedFromClear: +mistStatic.toFixed(3), mistDriftPerSecond: +mistDrift.toFixed(3), mistReducedDrift: +mistStill.toFixed(4), clearNoise: +clearNoise.toFixed(4),
      profileColourPixelsThroughMist: through, meanColourClearToMist: [clearStats.mean, mistStats.mean],
      rainFromClear: +rainLayer.toFixed(3), rainReducedFromClear: +rainStatic.toFixed(3), rainDrift: +rainDrift.toFixed(3), rainReducedDrift: +rainStill.toFixed(4),
      environment: { mistFull: mistFull.d, mistReduced: mistReduced.d, rainFull: rainFull.d, rainReduced: rainReduced.d },
    };
    await ctx.close();
  }

  // ====================================================== Greenwood versus Town, default overview
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`greenwood: ${e.message}`));
    const hashes = (p) => p.evaluate(() => {
      const s = window.__town.runtime.scene();
      const h = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x = 2166136261; for (let i = 0; i < d.length; i += 7) x = Math.imul(x ^ d[i], 16777619); return x >>> 0; };
      return { terrain: h(s.textures.get('terrain').getSourceImage()), structures: h(s.textures.get('structures').getSourceImage()) };
    });
    const quiet = async () => { await frozen(page); await page.evaluate(() => { const t = window.__town; t.sim.residents.clear(); const s = t.runtime.scene(); s.setDirector(true); s.overview(); s.cloudBlobs?.splice?.(0); }); await settle(page, 8); };
    await page.goto(`${base}/?agents=demo&hour=12`);
    await ready(page);
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await quiet();
    const townShot = await shot(page), townMini = await mini(page), townHash = await hashes(page);
    const townZoom = await page.evaluate(() => window.__town.runtime.scene().cameras.main.zoom);
    await open(page);
    await page.selectOption('#ap-map', 'greenwood');
    await page.click('#ap-map-apply');
    await page.waitForFunction(() => window.__town.runtime.preset.id === 'greenwood' && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await quiet();
    const greenShot = await shot(page), greenMini = await mini(page), greenHash = await hashes(page);
    await fs.writeFile(path.join(output, 'overview-town.png'), townShot); await fs.writeFile(path.join(output, 'overview-greenwood.png'), greenShot);
    await fs.writeFile(path.join(output, 'minimap-town.png'), Buffer.from(townMini.split(',')[1], 'base64')); await fs.writeFile(path.join(output, 'minimap-greenwood.png'), Buffer.from(greenMini.split(',')[1], 'base64'));
    const canvasDiff = (await measure(townShot, greenShot, { tolerance: 24 })).ratio;
    const miniDiff = (await measure(Buffer.from(townMini.split(',')[1], 'base64'), Buffer.from(greenMini.split(',')[1], 'base64'), { tolerance: 24 })).ratio;
    const [townStats, greenStats] = [await stats(townShot), await stats(greenShot)];
    const [townMiniStats, greenMiniStats] = [await stats(Buffer.from(townMini.split(',')[1], 'base64')), await stats(Buffer.from(greenMini.split(',')[1], 'base64'))];
    const greenZoom = await page.evaluate(() => window.__town.runtime.scene().cameras.main.zoom);
    assert.ok(canvasDiff >= 0.6, `Greenwood differs from Town in ${(canvasDiff * 100).toFixed(1)}% of the canvas at the default overview`);
    assert.ok(miniDiff >= 0.4, `Greenwood differs from Town in ${(miniDiff * 100).toFixed(1)}% of the minimap`);
    assert.ok(greenStats.blue >= townStats.blue * 2 && greenStats.blue >= 0.1, `a lake fills the opening view: water-blue pixels ${(townStats.blue * 100).toFixed(1)}% -> ${(greenStats.blue * 100).toFixed(1)}%`);
    assert.ok(greenMiniStats.blue >= townMiniStats.blue * 2 && greenMiniStats.blue >= 0.07, `the minimap shows the lake: ${(townMiniStats.blue * 100).toFixed(1)}% -> ${(greenMiniStats.blue * 100).toFixed(1)}%`);
    const [tr, tg] = townStats.mean, [gr, gg] = greenStats.mean;
    assert.ok(gg - gr > tg - tr + 14, `Greenwood's ground is a much greener, brighter place (mean green over red: ${(tg - tr).toFixed(1)} -> ${(gg - gr).toFixed(1)})`);
    assert.notEqual(townHash.terrain, greenHash.terrain, 'Greenwood paints its own ground');
    assert.deepEqual(await resolved(page).then((r) => r.map), 'greenwood');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#game canvas').length), 1);

    // Reset: the same Town ground, structures and minimap, byte for byte
    await open(page);
    await page.click('#ap-reset');
    await page.waitForFunction(() => window.__town.runtime.preset.id === 'town' && window.__town.runtime.scene()?.textures.exists('art-tree0'), null, { timeout: 30000 });
    await page.waitForFunction(() => window.__town.sim.residents.size > 0, null, { timeout: 30000 });
    await quiet();
    const resetShot = await shot(page), resetMini = await mini(page), resetHash = await hashes(page);
    assert.deepEqual(resetHash, townHash, 'Reset repaints exactly the original Town ground and structures');
    assert.equal(resetMini, townMini, 'Reset restores the exact Town minimap');
    const resetDiff = (await measure(townShot, resetShot, { tolerance: 24 })).ratio;
    assert.ok(resetDiff < 0.02, `Reset renders the Town canvas again (${(resetDiff * 100).toFixed(2)}% of pixels differ, tree sway and spray only)`);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#game canvas').length), 1);
    receipts.greenwood = {
      overviewZoom: { town: +townZoom.toFixed(3), greenwood: +greenZoom.toFixed(3) },
      canvasPixelsChanged: +canvasDiff.toFixed(3), minimapPixelsChanged: +miniDiff.toFixed(3),
      waterBluePixels: { town: +townStats.blue.toFixed(3), greenwood: +greenStats.blue.toFixed(3) }, minimapWaterBlue: { town: +townMiniStats.blue.toFixed(3), greenwood: +greenMiniStats.blue.toFixed(3) },
      meanColour: { town: townStats.mean, greenwood: greenStats.mean },
      terrainHash: { town: townHash.terrain, greenwood: greenHash.terrain, afterReset: resetHash.terrain },
      reset: { sameTerrain: true, sameStructures: true, sameMinimap: resetMini === townMini, canvasPixelsChanged: +resetDiff.toFixed(4) },
    };
    await ctx.close();
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
