// Cyber City lift verification: placement, deck approach and floor occlusion, in a real browser against the
// production build served by the real Town server on loopback (run `npm run build` first). All activity is synthetic.
//
// The defect this guards: the lift cabin sat low, overlapped the deck-floor artwork, and was painted over the solid
// decks it passed. The intended picture, proved here from rendered pixels and not only from coordinates:
//
//   1. every lift connector boards and exits on the ordinary deck walk line (the middle row of its deck, the row the
//      stations use), and a resident really walks that path to the threshold before the ride and from it after;
//   2. the cabin's floor stands on the deck's back edge (clear of the deck art) at every served floor, and the cabin
//      pixels never touch the deck floor while it waits at a floor;
//   3. mid-ride, across an intermediate deck, the cabin and its passenger are visible in the shaft openings and are
//      hidden where the solid slab is: the pixels with the cabin drawn equal the pixels without it inside the slab;
//   4. the check has teeth: with the slab occluders hidden, or sunk beneath the cabin, the same measurement fails;
//   5. names, bubbles and emotes stay on top of the slab, and a control that lifts the slab above them fails;
//   6. reduced motion has no continuous vertical travel: the cabin stands at the origin floor then the destination
//      floor, each correctly placed and never overlapping a deck between;
//   7. one canvas, no browser error, no write request, and no leaked ride visual.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createTownServer } from '../server/townServer.mjs';
import { createPixels } from './lib/pixels.mjs';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'output/playwright/lift');
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'town-lift-'));
const token = crypto.randomBytes(32).toString('base64url');
const town = createTownServer({ token, journalPath: path.join(temp, 'journal.jsonl'), staticRoot: path.join(root, 'dist') });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const pixels = createPixels(browser);
const errors = [];
const receipts = { syntheticActivity: true };
const TILE = 16;
const CAB_HALF_W = 15; // the cabin is 30 world pixels wide
const CAB_H = 50;

const ready = (page) => page.waitForFunction(() => {
  const s = window.__town?.runtime?.scene?.();
  return Boolean(s && s.textures.exists('art-tree0') && s.appearance);
}, null, { timeout: 30000 });
const settle = (page, n = 4) => page.evaluate((frames) => new Promise((resolve) => { const tick = (left) => (left <= 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))); tick(frames); }), n);
const shot = (page) => page.locator('#game canvas').screenshot();
const track = (page, log) => page.on('request', (req) => { const u = new URL(req.url()); if (u.pathname.startsWith('/api/')) log.push({ method: req.method(), path: u.pathname }); });
/** How much of a box changed between two screenshots: the share of pixels that differ. */
const changed = async (a, b, box) => (await pixels.measure(a, b, { box, tolerance: 10 })).ratio;

async function openCyber(page, { reduced = false } = {}) {
  await page.goto(`http://127.0.0.1:${port}/?agents=demo&hour=12&theme=cyber-city${reduced ? '&motion=reduced' : ''}`);
  await ready(page);
  assert.equal(await page.locator('#game canvas').count(), 1, 'one game canvas');
  await page.evaluate(() => {
    const t = window.__town, s = t.runtime.scene();
    t.source.stop(); t.sim.residents.clear(); s.setDirector(false); s.cameras.main.stopFollow();
  });
}

/**
 * Spawn one resident, freeze the scene (it still renders), and drive the simulator by hand until the resident boards.
 * Returns the geometry of the walk to the lift. A frozen scene lets every frame be measured at an exact ride moment.
 */
const spawnAndWalkToLift = (page, startTileX = 58) => page.evaluate((sx) => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  s.scene.pause();
  const id = 'h/main/riderxxxxxxxxxxx';
  sim.push({ id: 'w1', agentId: id, seq: 1, at: 0, type: 'agent.spawned', role: 'coordinator', displayName: 'rider', profile: 'work', paletteSlot: 1 });
  sim.push({ id: 'w2', agentId: id, seq: 2, at: 0, type: 'agent.assigned' });
  // The resident starts in the Operations district, in front of the Operations Tower (a trip from the gate would, correctly,
  // begin with a street car: that is covered by verify-cyber-city-refinements). Here the lift approach is the subject.
  { const first = [...sim.residents.values()][0]; first.x = sx * 16 + 8; first.y = 44 * 16 + 8; }
  const rider = () => [...sim.residents.values()][0];
  const trace = [];
  let r = null;
  for (let i = 0; i < 6000; i++) {
    s.update(0, 50);
    r = rider();
    if (r.transit) break;
    trace.push({ x: r.x, y: r.y, anim: r.anim });
  }
  if (!r || !r.transit) return { error: 'no ride' };
  const legs = r.legs.map((l) => (l.kind === 'walk' ? { kind: 'walk', first: l.points[0], last: l.points[l.points.length - 1], points: l.points } : { kind: 'transit', connectorId: l.connectorId }));
  return { id: r.id, legIndex: r.legIndex, legs, trace, connector: r.transit.connectorId, from: r.transit.from, to: r.transit.to, duration: r.transit.duration, state: r.state, residents: sim.residents.size };
}, startTileX);

/** After the ride: walk the rest of the way to the station, recording the positions. */
const walkAfterRide = (page) => page.evaluate(() => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  const r = [...sim.residents.values()][0];
  const trace = [];
  for (let i = 0; i < 6000 && r.transit; i++) s.update(0, 50);
  const start = { x: r.x, y: r.y };
  const legs = r.legs.map((l) => (l.kind === 'walk' ? { kind: 'walk', first: l.points[0], last: l.points[l.points.length - 1], points: l.points } : { kind: 'transit', connectorId: l.connectorId }));
  const legIndex = r.legIndex;
  for (let i = 0; i < 400; i++) { s.update(0, 50); trace.push({ x: r.x, y: r.y, anim: r.anim, transit: Boolean(r.transit) }); if (r.anim !== 'walk' && !r.transit && i > 4) break; }
  return { start, trace, legs, legIndex, state: r.state, residents: sim.residents.size };
});

/**
 * Put the rider's ride at an exact moment and render it. `mode` is 'board' (doors opening, rider on the boarding tile),
 * 'exit' (doors opening at the destination), or a number: the cabin's floor line in world pixels, found by bisection on
 * the ride clock, so the same frame is reproducible whichever way the cabin is travelling.
 */
const setRide = (page, mode) => page.evaluate((m) => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  const r = [...sim.residents.values()][0], ride = r.transit;
  const d = ride.duration, door = Math.min(0.55, Math.max(0.2, d * 0.2));
  const apply = (e) => { ride.elapsed = e; s.update(0, 0); };
  if (m === 'board') apply(door * 0.25);
  else if (m === 'exit') apply(d - door * 0.25);
  else {
    const want = m + 24; // cabin floor = r.y - 24 (LIFT_CAR_BASE_OFFSET)
    const up = ride.to.y < ride.from.y;
    let lo = door, hi = d - door;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      apply(mid);
      if ((r.y > want) === up) lo = mid; else hi = mid;
    }
    apply((lo + hi) / 2);
  }
  return { elapsed: ride.elapsed, duration: d };
}, mode);

/** Everything a frame needs about the cabin, the rider (index 0), a bystander (index 1, if any), and where world pixels land on the screenshot. */
const facts = (page, index = 0) => page.evaluate((idx) => {
  const t = window.__town, sim = t.sim, s = t.runtime.scene();
  const r = [...sim.residents.values()][idx];
  const rider = [...sim.residents.values()][0];
  const snap = s.transit.snapshot()[0];
  const v = s.transit.active.get(rider.id);
  const view = s.views.get(r.id);
  const bounds = (o) => { const b = o.getBounds(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  return {
    rider: r.id, x: r.x, y: r.y, state: r.state, residents: sim.residents.size,
    snap, phase: snap?.phase, hidden: snap?.riderHidden, label: snap?.label,
    car: bounds(v.body), carVisible: v.body.visible, carDepth: v.body.depth, open: { visible: v.open.visible, alpha: v.open.alpha },
    passenger: { ...bounds(v.passenger), visible: v.passenger.visible, depth: v.passenger.depth, tint: v.passenger.tintTopLeft },
    label2: { depth: v.label.depth },
    sprite: { visible: view.sprite.visible, depth: view.sprite.depth, ...bounds(view.sprite) },
    overlayHidden: view.overlayHidden,
    name: { depth: view.name.depth, visible: view.name.visible, ...bounds(view.name) },
    bubble: { depth: view.bubble.depth, visible: view.bubble.visible, ...bounds(view.bubbleBg) },
    emote: { depth: view.emote.depth, visible: view.emote.visible, ...bounds(view.emote) },
    occluders: s.liftOccluders.map((o) => ({ x: o.x, y: o.y, w: o.displayWidth, h: o.displayHeight, depth: o.depth, visible: o.visible, key: o.texture.key })),
  };
}, index);

/** World rectangle to screenshot pixels, for the current camera. */
const toBox = (page, [wx, wy, ww, wh]) => page.evaluate(([x, y, w, h]) => {
  const s = window.__town.runtime.scene(), cam = s.cameras.main, canvas = document.querySelector('#game canvas');
  const f = canvas.getBoundingClientRect().width / cam.width, k = cam.zoom * f;
  return [Math.round((x - cam.worldView.x) * k), Math.round((y - cam.worldView.y) * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}, [wx, wy, ww, wh]);

/**
 * How much of a cabin's two cyan edge rails changed between a frame with the cabin and one without it, over the world
 * rows y0..y1. The cabin stands in front of its own door art, so its flat panels match the door and cannot be told
 * apart by colour; the rails are the cabin's signature and exist nowhere else in the shaft.
 */
const railRatio = async (page, a, b, cx, y0, y1) => {
  const left = await toBox(page, [cx - CAB_HALF_W + 0.25, y0, 1, Math.max(1, y1 - y0)]);
  const right = await toBox(page, [cx + CAB_HALF_W - 1.25, y0, 1, Math.max(1, y1 - y0)]);
  return Math.min(await changed(a, b, left), await changed(a, b, right));
};

const focus = (page, wx, wy, zoom = 3) => page.evaluate(([x, y, z]) => { const s = window.__town.runtime.scene(); s.cameras.main.setZoom(z); s.cameras.main.centerOn(x, y); }, [wx, wy, zoom]);
/** Hide or restore the lift visuals (cabin, doors, passenger, indicator) of the frozen scene. */
const showLift = (page, on) => page.evaluate((visible) => {
  const s = window.__town.runtime.scene();
  if (visible) s.update(0, 0); else for (const o of s.transit.objects()) o.setVisible(false);
}, on);
const showLifecycle = (page, on, index = 0) => page.evaluate(([visible, idx]) => {
  const s = window.__town.runtime.scene();
  const view = [...s.views.values()][idx];
  for (const o of [view.name, view.bubble, view.bubbleBg, view.emote]) o.setVisible(visible);
  if (visible) s.update(0, 0);
}, [on, index]);
/** Switch the rider-overlay occlusion (the verification control) and re-render the frame. */
const setOverlayOcclusion = (page, on) => page.evaluate((enabled) => { const s = window.__town.runtime.scene(); s.riderOverlayOcclusion = enabled; s.update(0, 0); }, on);
const showSprite = (page, on) => page.evaluate((visible) => { const s = window.__town.runtime.scene(); const view = [...s.views.values()][0]; view.sprite.setVisible(visible); view.shadow.setVisible(visible); }, on);
const setOccluders = (page, mode) => page.evaluate((m) => {
  const s = window.__town.runtime.scene();
  for (const o of s.liftOccluders) {
    if (m === 'normal') { o.setVisible(true).setDepth(-0.8); }
    else if (m === 'hidden') o.setVisible(false);
    else if (m === 'beneath') o.setVisible(true).setDepth(-1.5); // below the cabin: the slab is painted over
    else if (m === 'above-lifecycle') o.setVisible(true).setDepth(170000); // above names, bubbles, emotes
  }
}, mode);

const { port } = await town.listen(0);

try {
  // ============================================================ 1. geometry: every connector on the ordinary deck line
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`geometry: ${e.message}`));
    await openCyber(page);
    const g = await page.evaluate(() => {
      const m = window.__town.map, s = window.__town.runtime.scene();
      return {
        w: m.grid.w, cost: Array.from(m.grid.cost), regions: m.regions, stations: m.stations.map((st) => ({ place: st.place, x: st.tile.x, y: st.tile.y })),
        connectors: m.transit.connectors.map((c) => ({ id: c.id, kind: c.kind, from: c.fromRegion, to: c.toRegion, boarding: c.boarding, exit: c.exit })),
        occluders: s.liftOccluders.map((o) => ({ x: o.x, y: o.y, w: o.displayWidth, h: o.displayHeight, depth: o.depth })),
      };
    });
    const walkable = (p) => g.cost[p.y * g.w + p.x] !== 0;
    const region = (id) => g.regions.find((r) => r.id === id);
    const inside = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    assert.ok(g.connectors.filter((c) => c.kind === 'lift').length >= 36 && g.connectors.every((c) => c.kind === 'lift' || c.kind === 'car'), `Cyber City has lifts and street cars (${g.connectors.length})`);
    g.connectors = g.connectors.filter((c) => c.kind === 'lift');
    const stationRows = new Set(g.stations.map((st) => st.y));
    let checked = 0;
    for (const c of g.connectors) {
      const a = region(c.from), b = region(c.to);
      assert.ok(a && b, `${c.id}: regions exist`);
      for (const [tile, r, what] of [[c.boarding, a, 'boarding'], [c.exit, b, 'exit']]) {
        assert.ok(walkable(tile), `${c.id}: ${what} tile is walkable`);
        assert.ok(inside(tile, r), `${c.id}: ${what} tile ${tile.x},${tile.y} lies on its own deck`);
        assert.equal(tile.y, r.y + 1, `${c.id}: ${what} tile is on the middle row of its deck: the ordinary walk line`);
        assert.ok(stationRows.has(tile.y) || r.kind === 'deck' || r.kind === 'street', `${c.id}: ${what} tile row is a deck row`);
        // the cabin's floor is the back edge of the deck, derived from the tile and the one shared offset
        assert.equal(tile.y * TILE + TILE / 2 - 24, r.y * TILE, `${c.id}: the cabin floor at the ${what} tile is the deck's back edge`);
        checked += 1;
      }
    }
    // stations share the same walk line on every deck that has any
    const decksWithStations = g.regions.filter((r) => g.stations.some((st) => inside({ x: st.x, y: st.y }, r)));
    assert.ok(decksWithStations.length >= 8);
    for (const r of decksWithStations) for (const st of g.stations.filter((x) => inside({ x: x.x, y: x.y }, r))) assert.equal(st.y, r.y + 1, `${r.id}: ${st.place} station is on the same walk line`);
    // every upper deck has a slab occluder across its shaft: same width as the shaft, height of the deck
    const uppers = g.regions.filter((r) => r.kind === 'deck');
    assert.equal(g.occluders.length, uppers.length, 'one slab occluder per upper deck');
    for (const o of g.occluders) {
      const deck = uppers.find((r) => r.y * TILE === o.y);
      assert.ok(deck, `occluder at y ${o.y} lines up with a deck`);
      assert.equal(o.h, 3 * TILE, 'the slab is exactly the deck depth');
      assert.equal(o.w, 44, 'the slab spans the shaft and nothing wider (geometry-aware, not a global rectangle)');
      assert.ok(o.depth < 0 && o.depth > -1, `occluder depth ${o.depth} sits in the shaft band, above terrain and below every resident`);
    }
    receipts.geometry = { connectors: g.connectors.length, tilesChecked: checked, decksWithStations: decksWithStations.length, occluders: g.occluders.length };
    await ctx.close();
  }

  // ============================================================ 2-5. rendered boarding, crossing, exit, controls
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`ride: ${e.message}`));
    const requests = [];
    track(page, requests);
    await openCyber(page);
    const walk = await spawnAndWalkToLift(page);
    assert.ok(!walk.error, JSON.stringify(walk));
    assert.equal(walk.connector, 'lift-operations-0-2', 'the resident checks in at the Town hall: street to F2 of the Operations Tower, across F1');
    const map = await page.evaluate(() => { const m = window.__town.map; const c = m.transit.byId('lift-operations-0-2'); return { boarding: c.boarding, exit: c.exit, regions: m.regions, cost: Array.from(m.grid.cost), w: m.grid.w }; });
    const street = map.regions.find((r) => r.id === 'street'), deck2 = map.regions.find((r) => r.id === 'operations-f2');
    const centre = (p) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });
    const walkable = (p) => map.cost[p.y * map.w + p.x] !== 0;

    // --- the resident visibly walks the ordinary deck path up to the threshold
    const first = walk.legs[0];
    assert.equal(first.kind, 'walk');
    assert.deepEqual(first.last, map.boarding, 'the walk ends exactly on the boarding tile');
    assert.ok(first.points.every((p) => walkable(p) && p.x >= street.x && p.x < street.x + street.w && p.y >= street.y && p.y < street.y + street.h), 'every tile of the approach is a walkable tile of the street deck');
    assert.ok(walk.trace.length > 60 && walk.trace.filter((p) => p.anim === 'walk').length > 40, `the resident walked (${walk.trace.length} steps)`);
    for (const p of walk.trace) assert.ok(p.y >= street.y * TILE && p.y < (street.y + street.h) * TILE && p.x >= street.x * TILE, `walking position ${p.x},${p.y} stays on the street deck`);
    const reached = walk.trace[walk.trace.length - 1];
    const bc = centre(map.boarding);
    assert.ok(Math.hypot(reached.x - bc.x, reached.y - bc.y) < TILE, `the last walking step is at the threshold (${reached.x},${reached.y} vs ${bc.x},${bc.y})`);
    assert.equal(walk.residents, 1);
    assert.ok(['moving', 'returning'].includes(walk.state), `public state ${walk.state}`);
    receipts.approach = { steps: walk.trace.length, boarding: map.boarding, lastStep: { x: Math.round(reached.x), y: Math.round(reached.y) } };

    // make the lifecycle indicators real: a bubble and an emote on the rider
    await page.evaluate(() => { const sim = window.__town.sim; const r = [...sim.residents.values()][0]; r.bubble = 'on the lift'; r.emote = 'ok'; r.emoteUntil = Infinity; });

    // --- BOARDING: the rider stands on the threshold, the cabin waits clear of the deck with its doors opening
    const deck0Top = street.y * TILE; // street deck back edge
    await setRide(page, 'board');
    await focus(page, bc.x, bc.y - 20);
    await settle(page);
    let f = await facts(page);
    assert.equal(f.phase, 'board');
    assert.equal(f.hidden, false, 'the rider is still outside the cabin');
    assert.ok(f.sprite.visible, 'the rider sprite is drawn on the threshold');
    assert.ok(Math.abs(f.x - bc.x) < 0.5 && Math.abs(f.y - bc.y) < 0.5, 'the rider stands on the boarding tile centre');
    assert.equal(f.snap.y, deck0Top, `the cabin floor is the street deck's back edge (${f.snap.y} vs ${deck0Top}), not embedded in the deck`);
    assert.ok(f.car.y + f.car.h <= deck0Top + 0.01, 'the cabin sits entirely above the deck surface');
    assert.ok(f.open.visible, 'the doors are opening');
    assert.ok(f.sprite.depth > f.carDepth, 'the rider is drawn in front of the cabin');
    const boardWith = await shot(page);
    await showLift(page, false);
    await settle(page);
    const boardNoCar = await shot(page);
    await showLift(page, true);
    const deckBelowCar = await toBox(page, [bc.x - CAB_HALF_W, deck0Top + 1, 2 * CAB_HALF_W, 20]);
    const carRatio = await railRatio(page, boardWith, boardNoCar, bc.x, f.car.y + 1, f.car.y + f.car.h - 1);
    const deckRatio = await changed(boardWith, boardNoCar, deckBelowCar);
    assert.ok(carRatio > 0.4, `the cabin is drawn in the shaft opening (${carRatio.toFixed(2)} of its box changed)`);
    assert.ok(deckRatio < 0.02, `the cabin paints nothing onto the deck floor below its threshold (${deckRatio.toFixed(3)})`);
    await showSprite(page, false); await settle(page);
    const boardNoRider = await shot(page); await showSprite(page, true);
    const riderBox = await toBox(page, [f.sprite.x, f.sprite.y, f.sprite.w, f.sprite.h]);
    const riderRatio = await changed(boardWith, boardNoRider, riderBox);
    assert.ok(riderRatio > 0.15, `the waiting resident is visible in front of the shaft, not hidden by any occluder (${riderRatio.toFixed(2)})`);
    await fs.writeFile(path.join(output, 'cyber-lift-1-boarding.png'), boardWith);
    receipts.boarding = { carFloor: f.snap.y, deckBackEdge: deck0Top, cabinPixelsInOpening: +carRatio.toFixed(2), cabinPixelsOnDeck: +deckRatio.toFixed(3), riderPixels: +riderRatio.toFixed(2) };

    // --- MID-RIDE: the cabin crosses the F1 deck going up. Slab of Operations F1 across the shaft:
    const slab = (await facts(page)).occluders.find((o) => o.y === (map.regions.find((r) => r.id === 'operations-f1').y) * TILE);
    assert.ok(slab, 'the F1 slab occluder exists');
    const slabTop = slab.y, slabBottom = slab.y + slab.h, cx = bc.x;

    const measureCrossing = async (label, floorLine, { controls = false } = {}) => {
      await setRide(page, floorLine);
      await focus(page, cx, slabTop + 24);
      await settle(page);
      const ff = await facts(page);
      assert.equal(ff.phase, 'ride');
      assert.ok(ff.hidden && ff.passenger.visible, 'the resident is shown only as the cabin passenger');
      assert.ok(Math.abs(ff.snap.y - floorLine) < 3, `the cabin floor is at ${floorLine} (${ff.snap.y})`);
      const withCar = await shot(page);
      await showLift(page, false); await settle(page);
      const withoutCar = await shot(page);
      await showLift(page, true); await settle(page);
      const cabinTop = ff.snap.y - CAB_H, cabinBottom = ff.snap.y;
      const solid = [Math.max(cabinTop, slabTop), Math.min(cabinBottom, slabBottom)];
      const opening = [cabinTop, Math.min(cabinBottom, slabTop)];
      const boxes = {
        solid: await toBox(page, [cx - CAB_HALF_W, solid[0] + 1, 2 * CAB_HALF_W, Math.max(1, solid[1] - solid[0] - 2)]),
        passenger: await toBox(page, [ff.passenger.x, ff.passenger.y, ff.passenger.w, ff.passenger.h]),
      };
      const overlap = solid[1] - solid[0], gap = opening[1] - opening[0];
      const ratios = {
        solid: overlap >= 4 ? await changed(withCar, withoutCar, boxes.solid) : 0, // no part of the cabin is level with this slab
        opening: gap >= 4 ? await railRatio(page, withCar, withoutCar, cx, opening[0] + 1, opening[1] - 1) : 1,
        passenger: await changed(withCar, withoutCar, boxes.passenger),
      };
      return { ff, withCar, ratios, solid, opening };
    };

    // (a) the cabin straddles the slab: upper part in the opening, lower part and passenger behind the solid deck
    const cross = await measureCrossing('up', slabTop + 24);
    await fs.writeFile(path.join(output, 'cyber-lift-2-crossing-deck.png'), cross.withCar);
    assert.ok(cross.solid[1] - cross.solid[0] >= 20 && cross.opening[1] - cross.opening[0] >= 20, 'the frame straddles the slab edge');
    assert.ok(cross.ratios.opening > 0.4, `cabin pixels are visible in the shaft opening above the slab (${cross.ratios.opening.toFixed(2)})`);
    assert.ok(cross.ratios.solid < 0.03, `cabin pixels are absent inside the solid slab: the slab is in front (${cross.ratios.solid.toFixed(3)})`);
    assert.ok(cross.ratios.passenger < 0.03 && cross.ff.passenger.y >= slabTop, `the passenger behind the slab is hidden by it (${cross.ratios.passenger.toFixed(3)})`);
    // (b) fully in the opening: the cabin and the passenger are both plainly drawn
    const open = await measureCrossing('open', slabTop - 4);
    assert.ok(open.ratios.opening > 0.4 && open.ratios.passenger > 0.2, `cabin and passenger are visible in the opening (${JSON.stringify(open.ratios)})`);
    assert.ok(open.solid[1] - open.solid[0] <= 0 || open.ratios.solid < 0.03, 'nothing of the cabin is over the slab');
    assert.notEqual(open.ff.passenger.tint, 0xffffff, 'the passenger carries the profile colour');
    await fs.writeFile(path.join(output, 'cyber-lift-3-in-opening.png'), open.withCar);

    // (c) lifecycle labels and the floor. Two contracts, kept apart.
    //   structural: the RIDER's own name, bubble and emote ride with the passenger and are withheld while it is behind a solid slab
    //   decorative/other: every other resident's labels stay on top of the same slab, untouched; and a slab raised above them hides them
    const PARTS = ['name', 'bubble', 'emote'];
    const boxOf = (f, part) => [f[part].x, f[part].y, f[part].w, f[part].h];
    /** Share of each label's own pixels that are the label: the frame with it drawn against the frame with it hidden. */
    const labelRatios = async (boxes, index) => {
      const a = await shot(page);
      await showLifecycle(page, false, index); await settle(page);
      const b = await shot(page);
      await showLifecycle(page, true, index); await settle(page);
      if (process.env.DEBUG_LABELS) { await fs.writeFile(path.join(output, 'dbg-a.png'), a); await fs.writeFile(path.join(output, 'dbg-b.png'), b); }
      const out = {};
      for (const part of PARTS) out[part] = await changed(a, b, await toBox(page, boxes[part]));
      return out;
    };

    // a bystander stands at the front edge of the F1 deck of the Operations Tower, in line with the lift, its bubble wholly over the lower half of the very slab the rider passes behind, with its own labels
    await page.evaluate(() => {
      const t = window.__town, sim = t.sim, s = t.runtime.scene();
      const id = 'h/cron/bystanderxxxxxxx';
      sim.push({ id: 'b1', agentId: id, seq: 1, at: 0, type: 'agent.spawned', role: 'scheduled', displayName: 'on watch' });
      const b = sim.residents.get(id);
      b.queue.length = 0; b.intent = null; b.legs = []; b.path = []; b.transit = null; b.state = 'posted'; b.anim = 'stand'; b.facing = 'down';
      b.x = 45 * 16 + 8; b.y = 37 * 16 + 8; b.bubble = 'on watch'; b.emote = 'ok'; b.emoteUntil = Infinity;
      s.update(0, 0);
    });
    assert.equal((await facts(page)).residents, 2, 'the rider and one bystander');

    // c1. mid-slab: the rider is behind the F1 slab. Its overlay is withheld; the bystander's is not.
    await setRide(page, slabTop + 24); await focus(page, cx, slabTop + 24); await settle(page);
    const behindOn = await facts(page);
    assert.equal(behindOn.overlayHidden, true, 'the rider is flagged as behind a slab');
    assert.ok(behindOn.passenger.y >= slabTop && behindOn.passenger.y + behindOn.passenger.h <= slabBottom, 'the passenger lies within the slab');
    for (const part of PARTS) assert.equal(behindOn[part].visible, false, `the rider's ${part} is withheld while it is behind the slab`);
    assert.ok(behindOn.name.depth >= 150000, 'the name is still a lifecycle-band object: it is withheld, not covered by drawing order');
    // the boxes where the labels would be: the same frame with the occlusion switched off (the control)
    await setOverlayOcclusion(page, false); await settle(page);
    const behindOff = await facts(page);
    for (const part of PARTS) assert.ok(behindOff[part].visible, `control: with the occlusion disabled the rider's ${part} is drawn`);
    const boxes = Object.fromEntries(PARTS.map((p) => [p, boxOf(behindOff, p)]));
    assert.ok(boxes.name[1] + boxes.name[3] > slabTop && boxes.name[1] < slabBottom, 'the rider\'s name tag would sit over the slab in this frame');
    const ratioOff = await labelRatios(boxes, 0);
    for (const part of PARTS) assert.ok(ratioOff[part] > 0.08, `control: the rider's ${part} is plainly drawn over the slab without the occlusion (${ratioOff[part].toFixed(2)}), so the check can fail ${JSON.stringify({ boxes, behindOff: { name: behindOff.name, bubble: behindOff.bubble, emote: behindOff.emote, car: behindOff.car, pass: behindOff.passenger } })}`);
    const behindShotOff = await shot(page);
    await setOverlayOcclusion(page, true); await settle(page);
    const ratioOn = await labelRatios(boxes, 0);
    for (const part of PARTS) assert.ok(ratioOn[part] < 0.03, `the rider's ${part} is absent behind the slab (${ratioOn[part].toFixed(3)})`);
    const behindShotOn = await shot(page);
    await fs.writeFile(path.join(output, 'cyber-lift-6-rider-label-behind-slab.png'), behindShotOn);
    await fs.writeFile(path.join(output, 'cyber-lift-6-control-label-without-occlusion.png'), behindShotOff);

    // c2. the bystander on the same slab: untouched, with and without the rider's occlusion
    const by = await facts(page, 1);
    assert.equal(by.overlayHidden, false);
    for (const part of PARTS) assert.ok(by[part].visible && by[part].depth >= 150000, `the bystander's ${part} stays visible in the lifecycle band while the rider is behind the slab`);
    const byBoxes = Object.fromEntries(PARTS.map((p) => [p, boxOf(by, p)]));
    const byOn = await labelRatios(byBoxes, 1);
    for (const part of PARTS) assert.ok(byOn[part] > 0.08, `the bystander's ${part} is drawn on top of the slab (${byOn[part].toFixed(2)})`);
    await setOverlayOcclusion(page, false); await settle(page);
    const byOff = await labelRatios(byBoxes, 1);
    await setOverlayOcclusion(page, true); await settle(page);
    for (const part of PARTS) assert.ok(Math.abs(byOff[part] - byOn[part]) < 0.1, `the bystander's ${part} is unaffected by the rider's occlusion (${byOn[part].toFixed(2)} vs ${byOff[part].toFixed(2)})`);
    // the bystander's bubble really overlaps the slab, so raising the slab above the lifecycle band must hide it (the check can fail)
    const bubbleOnSlab = by.bubble.y + by.bubble.h > slabTop && by.bubble.y < slabBottom;
    assert.ok(bubbleOnSlab, 'the bystander\'s bubble overlaps the slab in this frame');
    await setOccluders(page, 'above-lifecycle'); await settle(page);
    const bad = await labelRatios(byBoxes, 1);
    assert.ok(bad.bubble < byOn.bubble * 0.5, `control: a slab raised above the lifecycle band hides the bystander's bubble, and the check sees it (${byOn.bubble.toFixed(2)} -> ${bad.bubble.toFixed(2)})`);
    await setOccluders(page, 'normal'); await settle(page);
    const back = await labelRatios(byBoxes, 1);
    assert.ok(Math.abs(back.bubble - byOn.bubble) < 0.1, 'reset returns the labels on top');

    // c3. in a shaft opening the rider's overlay is present again, with the passenger, anchored inside and above the cabin
    await setRide(page, slabTop - 4); await focus(page, cx, slabTop - 40); await settle(page);
    const inOpening = await facts(page);
    assert.equal(inOpening.overlayHidden, false, 'in the opening the rider is not behind a slab');
    assert.ok(inOpening.passenger.visible);
    for (const part of PARTS) assert.ok(inOpening[part].visible, `the rider's ${part} is back in the opening`);
    const openBoxes = Object.fromEntries(PARTS.map((p) => [p, boxOf(inOpening, p)]));
    const openRatios = await labelRatios(openBoxes, 0);
    for (const part of PARTS) assert.ok(openRatios[part] > 0.08, `the rider's ${part} is drawn in the opening (${openRatios[part].toFixed(2)})`);
    // anchored to the cabin, not floating: the name tag sits inside the cabin, the bubble just above it
    assert.ok(inOpening.name.y >= inOpening.car.y && inOpening.name.y + inOpening.name.h <= inOpening.car.y + inOpening.car.h + 1, 'the name tag is inside the cabin with the passenger');
    assert.ok(Math.abs(inOpening.name.x + inOpening.name.w / 2 - (inOpening.passenger.x + inOpening.passenger.w / 2)) < 1.5, 'and over the passenger');
    assert.ok(inOpening.bubble.y + inOpening.bubble.h <= inOpening.car.y + 1, `the bubble is just above the cabin ${JSON.stringify({ bubble: inOpening.bubble, car: inOpening.car })}`);
    await fs.writeFile(path.join(output, 'cyber-lift-7-rider-label-in-opening.png'), await shot(page));
    // sweeping the whole ride: the overlay is withheld exactly while the passenger box overlaps a slab of its own tower
    const sweep = await page.evaluate(() => {
      const t = window.__town, s = t.runtime.scene(), r = [...t.sim.residents.values()][0], ride = r.transit;
      const slabs = s.liftOccluders.map((o) => ({ y: o.y, h: o.displayHeight, x: o.x, w: o.displayWidth }));
      const d = ride.duration, door = Math.min(0.55, Math.max(0.2, d * 0.2));
      const out = { frames: 0, hiddenFrames: 0, mismatches: [], visibleBetween: 0, segments: 0 };
      let prev = null;
      for (let i = 0; i <= 120; i++) {
        ride.elapsed = door + ((d - 2 * door) * i) / 120; s.update(0, 0);
        const view = s.views.get(r.id), snap = s.transit.snapshot()[0], p = [...s.transit.active.values()][0].passenger;
        const behind = slabs.some((sl) => p.x + 4 > sl.x && p.x - 4 < sl.x + sl.w && p.y > sl.y && p.y - 14 < sl.y + sl.h);
        out.frames += 1; if (view.overlayHidden) out.hiddenFrames += 1;
        if (view.overlayHidden !== behind || view.name.visible === view.overlayHidden || view.bubble.visible === view.overlayHidden || view.emote.visible === view.overlayHidden) out.mismatches.push({ i, behind, hidden: view.overlayHidden, name: view.name.visible, bubble: view.bubble.visible, emote: view.emote.visible, y: snap.y });
        if (prev !== null && prev !== view.overlayHidden) out.segments += 1;
        prev = view.overlayHidden;
      }
      return out;
    });
    assert.deepEqual(sweep.mismatches, [], 'every frame of the ride agrees with the geometry');
    assert.ok(sweep.hiddenFrames > 10 && sweep.hiddenFrames < sweep.frames - 10, `the overlay is withheld for part of the ride only (${sweep.hiddenFrames} of ${sweep.frames} frames)`);
    assert.ok(sweep.segments >= 2, `and returns between decks (${sweep.segments} changes)`);
    receipts.riderOverlay = { behindSlab: { withheld: true, ratioOn, controlOff: ratioOff }, bystander: { on: byOn, off: byOff, controlSlabAbove: bad }, inOpening: openRatios, sweep: { frames: sweep.frames, hiddenFrames: sweep.hiddenFrames, changes: sweep.segments } };
    await setRide(page, slabTop + 24); await focus(page, cx, slabTop + 24); await settle(page);
    // --- CONTROLS: the pixel assertion must fail when the occluder is hidden or sunk below the cabin
    const controls = {};
    for (const mode of ['hidden', 'beneath']) {
      await setOccluders(page, mode);
      const c = await measureCrossing(mode, slabTop + 24);
      const detected = c.ratios.solid > 0.4 && c.ratios.passenger > 0.2;
      assert.ok(detected, `control (${mode}): the overlap on the solid slab is detected (${JSON.stringify(c.ratios)})`);
      controls[mode] = c.ratios;
      await fs.writeFile(path.join(output, `cyber-lift-control-${mode}.png`), c.withCar);
    }
    await setOccluders(page, 'normal');
    const restored = await measureCrossing('restored', slabTop + 24);
    assert.ok(restored.ratios.solid < 0.03 && restored.ratios.passenger < 0.03, `reset restores the occlusion (${JSON.stringify(restored.ratios)})`);
    receipts.crossing = { occluded: cross.ratios, inOpening: open.ratios, controls, restored: restored.ratios };

    // --- EXIT: the cabin has arrived level with F2, clear of that deck, and the rider steps out onto the exit tile
    const ec = centre(map.exit);
    await setRide(page, 'exit');
    await focus(page, ec.x, ec.y - 20);
    await settle(page);
    f = await facts(page);
    const deck2Top = deck2.y * TILE;
    assert.equal(f.phase, 'exit');
    assert.equal(f.hidden, false, 'the rider is out of the cabin');
    assert.ok(f.sprite.visible);
    assert.ok(Math.abs(f.x - ec.x) < 0.5 && Math.abs(f.y - ec.y) < 0.5, 'the rider steps out onto the exit tile centre');
    assert.equal(f.snap.y, deck2Top, `the cabin floor is F2's deck back edge (${f.snap.y} vs ${deck2Top})`);
    assert.ok(f.car.y + f.car.h <= deck2Top + 0.01);
    const exitWith = await shot(page);
    await showLift(page, false); await settle(page);
    const exitNoCar = await shot(page); await showLift(page, true);
    const exitDeck = await toBox(page, [ec.x - CAB_HALF_W, deck2Top + 1, 2 * CAB_HALF_W, 20]);
    const exitDeckRatio = await changed(exitWith, exitNoCar, exitDeck), exitCabRatio = await railRatio(page, exitWith, exitNoCar, ec.x, f.car.y + 1, f.car.y + f.car.h - 1);
    assert.ok(exitCabRatio > 0.4 && exitDeckRatio < 0.02, `exit: cabin drawn in the opening (${exitCabRatio.toFixed(2)}), nothing on the deck floor (${exitDeckRatio.toFixed(3)})`);
    await fs.writeFile(path.join(output, 'cyber-lift-4-exit.png'), exitWith);
    receipts.exit = { carFloor: f.snap.y, deckBackEdge: deck2Top, cabinPixelsInOpening: +exitCabRatio.toFixed(2), cabinPixelsOnDeck: +exitDeckRatio.toFixed(3) };

    // --- after the ride the resident walks from the exit tile along the destination deck
    const after = await walkAfterRide(page);
    assert.equal(after.residents, 2, 'the rider and the bystander');
    assert.ok(Math.hypot(after.start.x - ec.x, after.start.y - ec.y) < 0.5, 'the next leg starts on the exit tile');
    const nextWalk = after.legs[after.legIndex];
    assert.equal(nextWalk.kind, 'walk');
    assert.deepEqual(nextWalk.points[0], map.exit, 'the walk after the ride starts on the exit tile');
    assert.ok(nextWalk.points.every((p) => walkable(p) && p.x >= deck2.x && p.x < deck2.x + deck2.w && p.y >= deck2.y && p.y < deck2.y + deck2.h), 'every tile after the ride is a walkable tile of the F2 deck');
    assert.ok(after.trace.some((p) => p.anim === 'walk'), 'the resident walks away from the lift');
    for (const p of after.trace.filter((q) => !q.transit)) assert.ok(p.y >= deck2.y * TILE && p.y < (deck2.y + deck2.h) * TILE, `position ${p.x},${p.y} stays on the F2 deck`);
    receipts.afterRide = { steps: after.trace.length, firstTile: nextWalk.points[0], tiles: nextWalk.points.length };

    // --- a downward ride crosses the same slab the other way: F2 back to the street
    await page.evaluate(() => { const t = window.__town, s = t.runtime.scene(); const r = [...t.sim.residents.values()][0]; r.bubble = 'on the lift'; r.emote = 'ok'; r.emoteUntil = Infinity; t.sim.walkTo(r, { x: 50, y: 44 }); });
    const down = await page.evaluate(() => { const t = window.__town, s = t.runtime.scene(); const r = [...t.sim.residents.values()][0]; for (let i = 0; i < 4000 && !r.transit; i++) s.update(0, 50); return r.transit ? { id: r.transit.connectorId } : { error: 'no downward ride' }; });
    assert.equal(down.id, 'lift-operations-2-0');
    const downCross = await measureCrossing('down', slabTop + 24);
    assert.match(downCross.ff.label, /^▼/, 'the indicator shows the cabin going down');
    assert.ok(downCross.ratios.opening > 0.4 && downCross.ratios.solid < 0.03 && downCross.ratios.passenger < 0.03, `going down is occluded the same way (${JSON.stringify(downCross.ratios)})`);
    await fs.writeFile(path.join(output, 'cyber-lift-5-crossing-down.png'), downCross.withCar);
    receipts.crossingDown = downCross.ratios;

    // --- the cabin always ends clear of every deck: sweep the whole downward ride and check each frame
    let worst = 0, overlapFrames = 0;
    for (const line of [404, 420, 460, 500, 540, 600, 650, 684]) {
      const c = await measureCrossing('sweep', line);
      worst = Math.max(worst, c.ratios.solid);
      if (c.ratios.solid > 0.03) overlapFrames += 1;
    }
    assert.equal(overlapFrames, 0, `across the ride the cabin never shows over a solid slab (worst ${worst.toFixed(3)})`);
    receipts.sweep = { frames: 8, overlapFrames, worstSolidRatio: +worst.toFixed(3) };

    // --- one canvas, no clone, no write request, no leaked visual
    assert.equal(await page.locator('#game canvas').count(), 1);
    assert.deepEqual(requests.filter((q) => q.method !== 'GET'), [], 'no write request');
    const done = await page.evaluate(() => { const t = window.__town, s = t.runtime.scene(); const r = [...t.sim.residents.values()][0]; for (let i = 0; i < 4000 && (r.transit || r.anim === 'walk'); i++) s.update(0, 50); for (let i = 0; i < 4; i++) s.update(0, 50); return { residents: t.sim.residents.size, stats: s.transit.stats(), snap: s.transit.snapshot().length }; });
    assert.equal(done.residents, 2, 'the rider and the bystander');
    assert.equal(done.stats.active, 0, 'the ride visual went back to the pool');
    assert.equal(done.snap, 0);
    receipts.pool = done.stats;
    await ctx.close();
  }

  // ============================================================ 6. reduced motion: stops at floors, correct placement and occlusion
  {
    const ctx = await browser.newContext({ viewport: { width: 1672, height: 940 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`reduced: ${e.message}`));
    await openCyber(page, { reduced: true });
    const walk = await spawnAndWalkToLift(page);
    assert.ok(!walk.error, JSON.stringify(walk));
    const info = await page.evaluate(() => { const m = window.__town.map; const c = m.transit.byId('lift-operations-0-2'); return { boarding: c.boarding, exit: c.exit, f1: m.regions.find((r) => r.id === 'operations-f1'), f2: m.regions.find((r) => r.id === 'operations-f2'), street: m.regions.find((r) => r.id === 'street') }; });
    const deckTops = { street: info.street.y * TILE, f2: info.f2.y * TILE };
    const slabTop = info.f1.y * TILE, slabBottom = slabTop + 3 * TILE;
    const cx = info.boarding.x * TILE + TILE / 2;
    const stops = new Set();
    let straddled = 0;
    const d = walk.duration, door = Math.min(0.55, Math.max(0.2, d * 0.2));
    for (let i = 0; i <= 24; i++) {
      await page.evaluate((e) => { const t = window.__town, s = t.runtime.scene(); const r = [...t.sim.residents.values()][0]; r.transit.elapsed = e; s.update(0, 0); }, (d * i) / 24 - (i === 24 ? 0.01 : 0));
      const ff = await facts(page);
      assert.equal(ff.snap.reduced, true);
      stops.add(Math.round(ff.snap.y));
      assert.ok(Math.round(ff.snap.y) === deckTops.street || Math.round(ff.snap.y) === deckTops.f2, `reduced motion: the cabin floor ${ff.snap.y} is a deck back edge, never between floors`);
      assert.ok(ff.snap.label.includes('→'), 'the static floor cue is shown');
    }
    assert.deepEqual([...stops].sort((a, b) => a - b), [deckTops.f2, deckTops.street], 'exactly two stops: origin and destination');
    // placement and occlusion at the ride's middle, where the fade is deepest: the cabin is at a floor and no deck is overpainted
    await page.evaluate((e) => { const t = window.__town, s = t.runtime.scene(); const r = [...t.sim.residents.values()][0]; r.transit.elapsed = e; s.update(0, 0); }, d * 0.3);
    const f = await facts(page);
    await focus(page, cx, slabTop + 24);
    await settle(page);
    const withCar = await shot(page);
    await showLift(page, false); await settle(page);
    const without = await shot(page);
    const carTop = f.snap.y - CAB_H, carBottom = f.snap.y;
    const overlapsSlab = carBottom > slabTop && carTop < slabBottom;
    assert.equal(overlapsSlab, false, `the parked cabin [${carTop}, ${carBottom}] does not reach the F1 slab [${slabTop}, ${slabBottom}]`);
    const slabBox = await toBox(page, [cx - CAB_HALF_W, slabTop + 1, 2 * CAB_HALF_W, 3 * TILE - 2]);
    const slabRatio = await changed(withCar, without, slabBox);
    assert.ok(slabRatio < 0.03, `reduced motion: no cabin pixel on the F1 slab (${slabRatio.toFixed(3)})`);
    receipts.reduced = { stops: [...stops], cabinOnSlab: +slabRatio.toFixed(3) };
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
