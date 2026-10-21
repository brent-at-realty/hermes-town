// World pack contract verification: typed transit, routes, the simulator on lifts and shuttles, and the
// Cyber City and Orbital System maps. No browser: the map, route planner and simulator are plain TypeScript,
// bundled here with esbuild (the same way verify-themes does).
//
// Proves:
//   - maps without transit keep ordinary A* walking, exactly as before;
//   - every connector endpoint, entrance, station, door, porch and dock is reachable, and void space is blocked;
//   - routes are walk / transit / walk, built from real connectors, and never step on a blocked tile;
//   - a resident riding a lift or shuttle stays one resident in the same lifecycle state, creates no event, no
//     log line and no history entry, keeps its station reservation, and is never in two places;
//   - a completion, a departure or a replayed snapshot during a ride is handled without stranding anyone;
//   - broken connectors (missing endpoint, self-loop, duplicate, disconnected) are rejected by validation.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function load(entry) {
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  const file = path.join(process.env.TMPDIR ?? '/tmp', `hermes-town-worlds-${process.pid}.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

const w = await load(`
  export * from './src/themes/index.ts';
  export { validateRegistry, validateMap, validatePosts } from './src/themes/validate.ts';
  export { TownSim } from './src/sim/town.ts';
  export { findPath } from './src/world/pathfind.ts';
  export { createTransitNetwork, validateTransit, labelRegions, transitPhase, transitPoint, riderVisible } from './src/world/transit.ts';
  export { strayWalkable } from './src/world/regions.ts';
  export { buildTownMap, buildGreenwoodMap, STALL_KINDS } from './src/world/map.ts';
  export { buildCyberCityMap, CYBER_TOWERS, floorBase, vestibule, liftOccluderRects, liftCabinFloorPx, deckTopPx, liftCentreX, LIFT_SHAFT_HALF_W, STREET_YB, TOWER_W, CYBER_W, CYBER_H,
    CYBER_POSTS, cyberPostExclusions, CYBER_DISTRICTS, cyberDistrictOf, cyberDistrictsAdjacent, CYBER_DISTRICT_MODEL, carStop, cyberCarConnectors,
    ROAD, CAR_SIZE, PRIOR_CAR_SIZE, TRAFFIC_SPEED, CAR_RIDE_SPEED, slabBehindRider, liftPassengerBox, PASSENGER_H } from './src/world/cyberCity.ts';
  export { zoomFloor, clampZoom, viewInsideWorld } from './src/world/zoomFloor.ts';
  export { LIFT_CAR_BASE_OFFSET } from './src/world/transit.ts';
  export { LIFT_DEPTHS, ROAD_RIDE_DEPTHS, LIFECYCLE_FLOOR, EFFECT_DEPTHS, TRANSIT_DEPTH } from './src/scenes/depthBands.ts';
  export { buildOrbitalSystemMap, DOCKS } from './src/world/orbitalSystem.ts';
  export { PLACE_LABEL } from './src/sim/toolMap.ts';
  export { weatherOptionsFor } from './src/themes/environment.ts';
`);

let checks = 0;
const ok = (name, fn) => { try { fn(); checks += 1; } catch (error) { console.error(`FAIL ${name}`); throw error; } };
const TILE = 16;
const tile = (x, y) => ({ x: Math.floor(x / TILE), y: Math.floor(y / TILE) });
const cyber = () => w.buildCyberCityMap();
const orbit = () => w.buildOrbitalSystemMap();
const places = Object.keys(w.PLACE_LABEL);

// ------------------------------------------------------------ compatibility
ok('the town and Greenwood have no transit and keep plain A* walking', () => {
  for (const map of [w.buildTownMap(0), w.buildGreenwoodMap()]) {
    assert.equal(map.transit, undefined);
    assert.equal(map.skin, undefined);
    const sim = new w.TownSim(map);
    const id = 'h/main/aaaaaaaaaaaaaaaa';
    sim.push({ id: '1', agentId: id, seq: 1, at: 0, type: 'agent.assigned' });
    const r = sim.residents.get(id);
    sim.update(0.05);
    assert.deepEqual(r.legs, []);
    assert.equal(r.transit, null);
    const from = tile(r.x, r.y);
    const expected = w.findPath(map.grid, from, r.path[r.path.length - 1]);
    assert.ok(expected && expected.length > 1);
    assert.deepEqual(r.path, w.findPath(map.grid, r.path[0], r.path[r.path.length - 1]));
  }
});

// ------------------------------------------------------------ the maps
ok('both worlds are registered, skinned and valid', () => {
  assert.deepEqual(w.validateRegistry(), []);
  for (const id of ['cyber-city', 'orbital-system']) {
    const preset = w.findMap(id);
    assert.ok(preset, id);
    const map = preset.build();
    assert.equal(map.skin, id);
    assert.ok(map.transit && map.transit.connectors.length > 0);
    assert.match(preset.routeNote, /not a separate Hermes lifecycle signal/);
  }
});

ok('Cyber City: Archive, Maker, Operations and Residential towers; every Place on real upper floors; lifts on every floor', () => {
  const map = cyber();
  assert.deepEqual(w.CYBER_TOWERS.map((t) => t.id), ['archive', 'maker', 'operations', 'residential']);
  const placeFloor = new Map();
  for (const t of w.CYBER_TOWERS) for (const f of t.floors) if (f.place) placeFloor.set(f.place, { tower: t.id, floor: f.floor });
  for (const place of places) {
    if (place === 'market') continue;
    assert.ok(placeFloor.has(place), `${place} has a floor`);
    assert.ok(placeFloor.get(place).floor >= 1, `${place} is above the street`);
    const stations = map.stations.filter((s) => s.place === place);
    assert.ok(stations.length >= 3, `${place} stations`);
  }
  assert.equal(map.stations.filter((s) => s.place === 'market').length, 6);
  assert.equal(map.homes.length, 7);
  for (const t of w.CYBER_TOWERS) for (const f of [0, ...t.floors.map((x) => x.floor)]) {
    const v = w.vestibule(t, f);
    assert.ok(map.grid.cost[v.y * map.grid.w + v.x] !== 0, `${t.id} floor ${f} vestibule is walkable`);
  }
  // every floor of a tower is its own walkable region, joined only by the lift
  const net = map.transit;
  const archiveF1 = net.regionOf(w.vestibule(w.CYBER_TOWERS[0], 1)), archiveF2 = net.regionOf(w.vestibule(w.CYBER_TOWERS[0], 2));
  assert.notEqual(archiveF1, archiveF2);
  assert.notEqual(net.regionOf(w.vestibule(w.CYBER_TOWERS[0], 1)), net.regionOf(map.entrance));
});

ok('Cyber City lifts: the cabin floor is the deck back edge on the ordinary walk line; every upper deck has a shaft-wide slab occluder; depth bands order shaft < slab < residents < lifecycle', () => {
  const map = cyber();
  assert.equal(w.LIFT_CAR_BASE_OFFSET, -24);
  const deckRows = new Set();
  for (const t of w.CYBER_TOWERS) for (const f of [0, ...t.floors.map((x) => x.floor)]) {
    const v = w.vestibule(t, f);
    assert.equal(v.y, w.floorBase(f) - 1, `${t.id} F${f}: the vestibule is on the deck's middle row, the stations' walk line`);
    assert.equal(w.liftCabinFloorPx(t, f), w.deckTopPx(f), `${t.id} F${f}: the cabin floor is the back edge of the deck, clear of the deck art`);
    assert.equal(w.deckTopPx(f), (w.floorBase(f) - 2) * TILE);
    deckRows.add(v.y);
  }
  for (const s of map.stations) assert.ok(deckRows.has(s.tile.y), `station ${s.place} ${s.tile.x},${s.tile.y} is on a deck walk line`);
  for (const c of map.transit.connectors.filter((x) => x.kind === 'lift')) {
    for (const p of [c.boarding, c.exit]) assert.ok(deckRows.has(p.y), `${c.id}: ${p.x},${p.y} is on a deck walk line`);
  }
  const rects = w.liftOccluderRects();
  const upper = w.CYBER_TOWERS.flatMap((t) => t.floors.map((f) => [t, f.floor]));
  assert.equal(rects.length, upper.length, 'a slab for every upper deck, none for the street');
  for (const r of rects) {
    const t = w.CYBER_TOWERS.find((x) => x.id === r.tower);
    assert.equal(r.w, 2 * w.LIFT_SHAFT_HALF_W, 'the slab is exactly as wide as the shaft');
    assert.equal(r.h, 3 * TILE, 'and exactly as deep as the deck');
    assert.equal(r.x + r.w / 2, w.liftCentreX(t), 'centred on the shaft');
    assert.equal(r.y, w.deckTopPx(r.floor));
    assert.ok(r.w < 3 * TILE * 2, 'never a global rectangle across the tower');
  }
  const d = w.LIFT_DEPTHS;
  assert.ok(d.car < d.doors && d.doors < d.passenger && d.passenger < d.indicator && d.indicator < d.occluder, 'shaft band is below the slab occluder');
  assert.ok(d.car > -2 && d.occluder < 0, 'above terrain and below every resident and prop (depth = y >= 0)');
  assert.ok(d.occluder < w.TRANSIT_DEPTH && w.TRANSIT_DEPTH < w.EFFECT_DEPTHS.grade && w.EFFECT_DEPTHS.night < w.LIFECYCLE_FLOOR, 'decorative and transit bands stay beneath the lifecycle floor');
});

ok('Orbital System: Helios Station, Mercury Lab, Forge Moon, Relay Garden; sun not walkable; empty space blocked', () => {
  const map = orbit();
  const ids = map.regions.map((r) => r.id);
  for (const id of ['sun', 'mercury', 'forge-moon', 'relay-garden', 'helios-top', 'helios-mid', 'helios-low']) assert.ok(ids.includes(id), id);
  const stray = w.strayWalkable(map.grid, map.regions);
  assert.deepEqual(stray.void, [], 'no walkable tile outside an authored region');
  assert.deepEqual(stray.sun, [], 'the sun is not walkable');
  const sun = map.regions.find((r) => r.id === 'sun');
  assert.equal(sun.kind, 'sun');
  // at least the great majority of the grid is void
  const walkable = [...map.grid.cost].filter((c) => c !== 0).length;
  assert.ok(walkable / map.grid.cost.length < 0.45, `walkable share ${walkable / map.grid.cost.length}`);
  const where = (place) => map.stations.filter((s) => s.place === place).map((s) => net.regionOf(s.tile));
  const net = map.transit;
  const body = (p) => net.regionOf(map.stations.find((s) => s.place === p).tile);
  assert.equal(body('library'), body('observatory'), 'Mercury Lab hosts Library and Observatory');
  assert.equal(body('workshop'), body('forge'), 'Forge Moon hosts Workshop and Forge');
  assert.equal(body('hall'), body('post')); assert.equal(body('hall'), body('tavern'));
  assert.equal(new Set([body('library'), body('workshop'), body('hall'), body('market')]).size, 4, 'four separate walkable bodies');
  void where;
  for (const h of map.homes) assert.equal(net.regionOf(h.door), body('hall'), 'crew quarters are on Helios Station');
});

ok('every station, door, porch, dock and lift vestibule is reachable from the entrance through the typed network', () => {
  for (const map of [cyber(), orbit()]) {
    const targets = [...map.stations.map((s) => s.tile), ...[...map.buildings, ...map.homes].flatMap((b) => [b.door, ...b.porch]), ...map.transit.connectors.flatMap((c) => [c.boarding, c.exit])];
    for (const t of targets) assert.ok(map.transit.route(map.entrance, t), `${map.skin}: ${t.x},${t.y}`);
  }
});

ok('plain A* alone cannot reach another floor or body: the connectors are what join the regions', () => {
  for (const map of [cyber(), orbit()]) {
    const unreachableByWalking = map.stations.filter((s) => !w.findPath(map.grid, map.entrance, s.tile));
    assert.ok(unreachableByWalking.length > 0, `${map.skin} needs its connectors`);
    for (const s of unreachableByWalking) assert.ok(map.transit.route(map.entrance, s.tile), 'but the network reaches it');
  }
});

// ------------------------------------------------------------ routes
const stepsAreWalkable = (map, plan) => {
  for (const leg of plan.legs) {
    if (leg.kind !== 'walk') continue;
    for (let i = 0; i < leg.points.length; i++) {
      const p = leg.points[i];
      assert.ok(map.grid.cost[p.y * map.grid.w + p.x] !== 0, `walks on blocked ${p.x},${p.y}`);
      if (i > 0) assert.equal(Math.abs(p.x - leg.points[i - 1].x) + Math.abs(p.y - leg.points[i - 1].y), 1, 'a walk moves one tile at a time');
    }
  }
};
ok('same deck or body: a walk only. Another floor: walk, lift, walk. Another body: walk, shuttle, walk', () => {
  const c = cyber(), a = c.stations.find((s) => s.place === 'library').tile, b = c.stations.filter((s) => s.place === 'library')[1].tile;
  assert.deepEqual(c.transit.route(a, b).legs.map((l) => l.kind), ['walk']);
  const obs = c.stations.find((s) => s.place === 'observatory').tile;
  const up = c.transit.route(a, obs);
  assert.deepEqual(up.legs.map((l) => l.kind), ['walk', 'transit', 'walk']);
  assert.match(up.legs[1].connectorId, /^lift-archive-1-2$/);
  stepsAreWalkable(c, up);
  const shop = c.stations.find((s) => s.place === 'workshop').tile;
  const cross = c.transit.route(a, shop); // library F1 -> lift down -> street -> lift up
  assert.deepEqual(cross.legs.map((l) => l.kind), ['walk', 'transit', 'walk', 'transit', 'walk']);
  assert.deepEqual(cross.legs.filter((l) => l.kind === 'transit').map((l) => l.connectorId), ['lift-archive-1-0', 'lift-maker-0-1']);
  stepsAreWalkable(c, cross);
  const o = orbit();
  const lib = o.stations.find((s) => s.place === 'library').tile, hall = o.stations.find((s) => s.place === 'hall').tile, forge = o.stations.find((s) => s.place === 'forge').tile;
  const hop = o.transit.route(lib, hall);
  assert.deepEqual(hop.legs.map((l) => l.kind), ['walk', 'transit', 'walk']);
  assert.equal(hop.legs[1].connectorId, 'shuttle-mercury-out'.replace('out', 'back'));
  const two = o.transit.route(lib, forge);
  assert.deepEqual(two.legs.map((l) => l.kind), ['walk', 'transit', 'walk', 'transit', 'walk']);
  assert.deepEqual(two.legs.filter((l) => l.kind === 'transit').map((l) => l.connectorId), ['shuttle-mercury-back', 'shuttle-forge-out']);
  stepsAreWalkable(o, hop); stepsAreWalkable(o, two);
});

ok('a route is deterministic and never walks through void', () => {
  for (const map of [cyber(), orbit()]) {
    const targets = map.stations.map((s) => s.tile);
    for (const from of targets.filter((_, i) => i % 3 === 0)) for (const to of targets.filter((_, i) => i % 4 === 1)) {
      const p = map.transit.route(from, to), q = map.transit.route(from, to);
      assert.deepEqual(p, q);
      stepsAreWalkable(map, p);
      // each transit leg starts at the previous walk's end and ends where the next walk begins
      p.legs.forEach((leg, i) => {
        if (leg.kind !== 'transit') return;
        const before = p.legs[i - 1], after = p.legs[i + 1];
        assert.deepEqual(before.points[before.points.length - 1], leg.from);
        assert.deepEqual(after.points[0], leg.to);
      });
      assert.equal(p.legs[p.legs.length - 1].kind, 'walk');
    }
  }
});

// ----------------------------------------------------------- validation
ok('broken connectors are rejected: blocked endpoint, self-loop, duplicate, disconnected, bad duration', () => {
  const map = cyber();
  const [first] = map.transit.connectors;
  const bad = (patch) => w.validateTransit(map.grid, map.entrance, [first, { ...first, id: 'x', ...patch }], 'cyber-city');
  assert.ok(bad({ boarding: { x: 0, y: 0 } }).some((m) => /boarding tile/.test(m)));
  assert.ok(bad({ exit: { x: 83, y: 0 } }).some((m) => /exit tile/.test(m)));
  assert.ok(bad({ exit: first.boarding, toRegion: first.fromRegion }).some((m) => /joins a region to itself|self-loop/.test(m)));
  assert.ok(bad({ id: first.id }).some((m) => /duplicate connector id/.test(m)));
  assert.ok(bad({ durationMs: 50 }).some((m) => /duration/.test(m)));
  assert.ok(bad({ kind: 'shuttle' }).some((m) => /does not match its visual/.test(m)));
  // an island nothing leads to: walkable, but no connector reaches it
  const cost = new Uint8Array(map.grid.cost); cost[0] = 1; cost[1] = 1;
  const island = w.validateTransit({ ...map.grid, cost }, map.entrance, [{ ...first, id: 'island', boarding: { x: 0, y: 0 }, exit: { x: 1, y: 0 } }], 'cyber-city');
  assert.ok(island.some((m) => /not reachable from the entrance/.test(m)), island.join('\n'));
  // a station left without a connector is reported by the map validator
  const preset = w.findMap('cyber-city');
  const stripped = { ...map, transit: w.createTransitNetwork(map.grid, map.transit.connectors.filter((c) => !c.id.startsWith('lift-archive'))) };
  assert.ok(w.validateMap(stripped, preset).some((m) => /not reachable from the entrance/.test(m)));
  // void space: a walkable tile that no region owns is reported
  const leaked = new Uint8Array(orbit().grid.cost); const o = orbit();
  leaked[5 * o.grid.w + 40] = 1;
  assert.ok(w.validateMap({ ...o, grid: { ...o.grid, cost: leaked } }, w.findMap('orbital-system')).some((m) => /outside every authored region/.test(m)));
});

ok('timing: board, ride and exit phases; the rider is hidden only inside the car', () => {
  const d = 3.45;
  assert.equal(w.transitPhase(0, d).phase, 'board');
  assert.equal(w.transitPhase(d / 2, d).phase, 'ride');
  assert.equal(w.transitPhase(d, d).phase, 'exit');
  assert.equal(w.transitPhase(d / 2, d).t > 0.4 && w.transitPhase(d / 2, d).t < 0.6, true);
  assert.equal(w.riderVisible(0, d), true);
  assert.equal(w.riderVisible(d / 2, d), false);
  assert.equal(w.riderVisible(d, d), true);
  const lift = cyber().transit.connectors[0];
  const a = { x: 10, y: 10 }, b = { x: 10, y: 110 };
  assert.deepEqual(w.transitPoint(lift, a, b, 0), a); assert.deepEqual(w.transitPoint(lift, a, b, 1), b);
  const shuttle = orbit().transit.connectors[0];
  const mid = w.transitPoint(shuttle, { x: 0, y: 0 }, { x: 100, y: 0 }, 0.5);
  assert.ok(Math.abs(mid.y) > 1 || shuttle.visual.control.y !== 0, 'a shuttle flies a curve');
});

// ---------------------------------------------------------- the simulator
const ev = (n, agentId, type, extra = {}) => ({ id: `e${n}`, agentId, seq: n, at: 0, type, ...extra });
const run = (sim, seconds, step = 0.05, onTick = () => {}) => { for (let t = 0; t < seconds; t += step) { sim.update(step); onTick(); } };

ok('Cyber City: a tool call sends a runner by lift to the right floor; nothing is invented', () => {
  const map = cyber(), sim = new w.TownSim(map);
  const id = 'h/main/bbbbbbbbbbbbbbbb';
  sim.push(ev(1, id, 'agent.assigned', { action: 'turn started' }));
  run(sim, 40);
  const session = sim.residents.get(id);
  assert.equal(session.place, 'hall');
  assert.equal(session.state, 'working');
  const logBefore = sim.log.length, historyBefore = session.history.length;
  sim.push(ev(2, id, 'agent.tool_started', { tool: 'read_file' }));
  const runner = [...sim.residents.values()].find((r) => r.kind === 'runner');
  const ids = new Set(), rides = [], seenStates = new Set();
  let maxResidents = 0;
  run(sim, 60, 0.05, () => {
    maxResidents = Math.max(maxResidents, sim.residents.size);
    for (const r of sim.residents.values()) ids.add(r.id);
    if (runner.transit) { rides.push({ id: runner.transit.connectorId, x: runner.x, y: runner.y, state: runner.state }); }
    seenStates.add(runner.state);
  });
  assert.ok(rides.length > 10, `the runner rode a lift (${rides.length} ticks)`);
  assert.ok(rides.every((r) => r.state === 'moving' || r.state === 'returning'), 'the public state stays moving or returning during a ride');
  assert.ok(rides.some((r) => /^lift-operations-2-0$/.test(r.id)), 'down from the command floor');
  assert.ok(rides.some((r) => /^lift-archive-0-1$/.test(r.id)), 'up to the Archive floor');
  assert.equal(runner.place, 'library');
  assert.equal(runner.station.place, 'library');
  assert.deepEqual(tile(runner.x, runner.y).y, runner.station.tile.y);
  assert.equal(runner.transit, null);
  assert.equal(maxResidents, 2, 'one session and one runner, never a clone');
  assert.equal([...ids].filter((i) => i.startsWith(id)).length, 2);
  // nothing the simulator wrote came from the ride
  assert.equal(session.history.length, historyBefore + 1, 'only the tool call itself is noted');
  assert.ok(sim.log.length <= logBefore + 1);
  assert.ok(![...runner.history, ...session.history].some((h) => /lift|shuttle|transit/i.test(h.text)));
});

ok('during a ride the position follows the shaft: same column, between the two vestibules, never in another deck', () => {
  const map = cyber(), sim = new w.TownSim(map);
  const id = 'h/main/cccccccccccccccc';
  sim.push(ev(1, id, 'agent.assigned'));
  run(sim, 40);
  sim.push(ev(2, id, 'agent.tool_started', { tool: 'terminal' })); // forge: Maker Tower floor 2
  const runner = [...sim.residents.values()].find((r) => r.kind === 'runner');
  let rode = 0;
  run(sim, 80, 0.05, () => {
    if (!runner.transit || !runner.transit.connectorId.startsWith('lift-')) return;
    rode += 1;
    const { from, to } = runner.transit;
    assert.equal(Math.round(runner.x), Math.round(from.x));
    assert.ok(runner.y >= Math.min(from.y, to.y) - 0.01 && runner.y <= Math.max(from.y, to.y) + 0.01);
  });
  assert.ok(rode > 10);
  assert.equal(runner.place, 'forge');
  assert.ok(runner.station.tile.y === 26, 'Maker floor 2');
});

ok('Orbital System: a tool call flies a shuttle to the right body and the runner returns by shuttle', () => {
  const map = orbit(), sim = new w.TownSim(map);
  const id = 'h/main/dddddddddddddddd';
  sim.push(ev(1, id, 'agent.assigned'));
  run(sim, 30);
  sim.push(ev(2, id, 'agent.tool_started', { tool: 'write_file' })); // workshop: Forge Moon
  const runner = [...sim.residents.values()].find((r) => r.kind === 'runner');
  const used = new Set();
  run(sim, 60, 0.05, () => { if (runner.transit) used.add(runner.transit.connectorId); });
  assert.equal(runner.place, 'workshop');
  assert.ok(used.has('shuttle-forge-out'));
  sim.push(ev(3, id, 'agent.waiting'));
  run(sim, 80, 0.05, () => { if (runner.transit) used.add(runner.transit.connectorId); });
  assert.ok(used.has('shuttle-forge-back'), 'the runner flew home');
  assert.ok(!sim.residents.has(runner.id) || ['returning', 'handing', 'gone'].includes(runner.state));
});

ok('completion, departure and a new tool during a ride leave nobody stranded and nobody duplicated', () => {
  for (const map of [cyber(), orbit()]) {
    const sim = new w.TownSim(map);
    const id = 'h/main/eeeeeeeeeeeeeeee';
    sim.push(ev(1, id, 'agent.assigned'));
    run(sim, 40);
    sim.push(ev(2, id, 'agent.tool_started', { tool: 'web_search' }));
    const session = sim.residents.get(id);
    // keep the session itself busy elsewhere so that it rides too: send it home mid-way
    let seq = 3;
    run(sim, 200, 0.05, () => {
      const rider = [...sim.residents.values()].find((r) => r.transit);
      if (rider && rider.kind === 'runner' && !rider.rodeAlready) { rider.rodeAlready = true; sim.push(ev(seq++, id, 'agent.completed', { action: 'done' })); }
      assert.ok(sim.residents.size <= 2, 'no clone');
    });
    assert.ok(['waiting', 'pinning', 'moving', 'resting', 'idle', 'working'].includes(session.state), session.state);
    sim.push(ev(seq++, id, 'agent.departed'));
    run(sim, 300);
    assert.equal(session.state, 'resting', `${map.skin}: home on its porch`);
    assert.equal(session.transit, null);
    assert.ok(session.porch);
    const home = tile(session.x, session.y);
    assert.ok(session.home.porch.some((p) => p.x === home.x && p.y === home.y));
  }
});

ok('a new destination during a ride defers the new route until the ride ends: no teleport, no stranding', () => {
  for (const map of [cyber(), orbit()]) {
    const sim = new w.TownSim(map);
    const id = 'h/main/ffffffffffffffff';
    sim.push(ev(1, id, 'agent.assigned')); // the session walks from the gate to the hall: a ride on both maps? only when the hall is off the gate's region
    const session = sim.residents.get(id);
    let deferred = false, rides = 0, last = { x: session.x, y: session.y }, worst = 0;
    run(sim, 400, 0.05, () => {
      if (session.transit) rides += 1;
      if (session.transit && !deferred) { deferred = true; sim.push(ev(2, id, 'agent.departed')); assert.ok(session.deferredTarget, 'the departure is queued behind the ride'); assert.ok(session.transit, 'the ride carries on'); }
      // sitting down on the porch is the one existing snap (the porch tile is beside the door)
      if (session.state !== 'resting') worst = Math.max(worst, Math.hypot(session.x - last.x, session.y - last.y));
      last = { x: session.x, y: session.y };
    });
    if (map.skin === 'cyber-city') assert.ok(deferred && rides > 5, 'the session rode a lift to the command floor');
    assert.equal(session.transit, null); assert.equal(session.deferredTarget, null);
    assert.equal(session.state, deferred ? 'resting' : session.state);
    assert.ok(worst <= 16, `${map.skin}: no teleporting (largest step ${worst.toFixed(1)} px in one tick)`);
  }
});

ok('no resident ever jumps more than a step between ticks across a busy session on either world', () => {
  for (const map of [cyber(), orbit()]) {
    const sim = new w.TownSim(map);
    const tools = ['read_file', 'write_file', 'terminal', 'discord', 'web_search', 'delegate_task', 'skill_view', 'unknown_tool'];
    const last = new Map();
    let worst = 0, rides = 0, seq = 1;
    for (let a = 0; a < 3; a++) sim.push(ev(seq++, `h/main/agent${a}000000000000`.slice(0, 22), 'agent.assigned'));
    for (let t = 0; t < 2400; t++) {
      if (t % 120 === 30) for (let a = 0; a < 3; a++) sim.push(ev(seq++, `h/main/agent${a}000000000000`.slice(0, 22), 'agent.tool_started', { tool: tools[(t / 120 + a) % tools.length | 0] }));
      if (t % 400 === 390) for (let a = 0; a < 3; a++) sim.push(ev(seq++, `h/main/agent${a}000000000000`.slice(0, 22), 'agent.completed'));
      sim.update(0.05);
      for (const r of sim.residents.values()) {
        if (r.transit) rides += 1;
        const prev = last.get(r.id);
        if (prev && r.state !== 'resting' && r.state !== 'gone') worst = Math.max(worst, Math.hypot(r.x - prev.x, r.y - prev.y));
        last.set(r.id, { x: r.x, y: r.y });
        // a resident is only ever on a walkable tile or inside a ride
        if (!r.transit && r.state !== 'gone') { const c = tile(r.x, r.y); assert.ok(map.grid.cost[c.y * map.grid.w + c.x] !== 0, `${map.skin}: ${r.id} stands on blocked ${c.x},${c.y} in ${r.state}`); }
      }
    }
    assert.ok(rides > 50, `${map.skin}: rides happened (${rides})`);
    assert.ok(worst <= 16, `${map.skin}: largest one-tick step ${worst.toFixed(1)} px`);
  }
});

ok('a snapshot replay (settle) never replays a ride: residents are simply at the end of their route', () => {
  const map = orbit(), sim = new w.TownSim(map);
  const id = 'h/main/9999999999999999';
  sim.push(ev(1, id, 'agent.assigned'));
  sim.push(ev(2, id, 'agent.tool_started', { tool: 'read_file' }));
  sim.settle();
  for (const r of sim.residents.values()) {
    assert.equal(r.transit, null);
    assert.deepEqual(r.legs, []);
  }
  const runner = [...sim.residents.values()].find((r) => r.kind === 'runner');
  assert.equal(runner.state, 'working');
  assert.equal(runner.place, 'library');
});

ok('stalls: the kiosks of the sci-fi worlds are stalls that skills can claim', () => {
  for (const map of [cyber(), orbit()]) {
    const sim = new w.TownSim(map);
    const stall = sim.stallFor('web-design');
    assert.ok(stall && stall.place === 'market' && w.STALL_KINDS.has(stall.prop.kind));
  }
});

ok('weather wording follows the world, the stored values never change', () => {
  const normal = w.weatherOptionsFor(undefined), orbital = w.weatherOptionsFor('orbit');
  assert.deepEqual(normal.map((o) => o.id), ['clear', 'mist', 'rain']);
  assert.deepEqual(orbital.map((o) => o.id), ['clear', 'mist', 'rain']);
  assert.deepEqual(orbital.map((o) => o.label), ['Clear orbit', 'Nebula haze', 'Solar-particle field']);
  assert.deepEqual(normal.map((o) => o.label), ['Clear', 'Mist', 'Rain']);
});

ok('complete packs: each theme brings its own people kit, map and environment; the choice stays valid', () => {
  for (const [theme, kit, map] of [['cyber-city', 'neon-operatives', 'cyber-city'], ['orbital-system', 'orbital-crew', 'orbital-system']]) {
    const t = w.findTheme(theme);
    assert.ok(t.pack && t.pack.summary && /not a separate Hermes lifecycle signal/.test(t.pack.routeNote));
    assert.equal(t.people, kit); assert.equal(t.maps.default, map);
    const r = w.resolveAppearance(w.chooseTheme(w.DEFAULT_CHOICE, theme), { prefersReducedMotion: false });
    assert.equal(r.people.id, kit); assert.equal(r.map.id, map); assert.deepEqual(r.notes, []);
    const explicit = { ...w.DEFAULT_CHOICE, theme, people: kit, map };
    const link = w.toSearch(explicit);
    assert.deepEqual(w.parseSearch(link).choice, explicit);
  }
  for (const id of ['classic', 'night-market']) for (const map of ['cyber-city', 'orbital-system']) {
    const r = w.resolveAppearance({ ...w.DEFAULT_CHOICE, theme: id, map }, { prefersReducedMotion: false });
    assert.equal(r.map.id, map, `${id} can host ${map}`);
  }
});

// ---------------------------------------------------------- watch posts

ok('Cyber City watch posts: authored on the street beside landmarks, valid, reachable, clear of every lift approach, shaft and car stop', () => {
  const map = cyber();
  assert.deepEqual(map.posts, w.CYBER_POSTS.map((p) => p.tile));
  assert.ok(map.posts.length >= 8, 'enough posts that keepers are spread along the street');
  assert.ok(map.postExclusions.some((r) => r.kind === 'shaft') && map.postExclusions.some((r) => r.kind === 'lift-approach') && map.postExclusions.some((r) => r.kind === 'car-stop'));
  assert.deepEqual(w.validatePosts(map, 'cyber-city'), []);
  assert.deepEqual(w.validateMap(map, w.findMap('cyber-city')), []);
  for (const p of w.CYBER_POSTS) assert.ok(p.landmark && p.label, `${p.id} is beside a named landmark`);
  // An independent geometric check, not derived from the exclusion list: at least four tiles from every lift column and every car stop.
  for (const p of map.posts) {
    assert.ok(p.y >= w.STREET_YB - 2 && p.y <= w.STREET_YB, `post ${p.x},${p.y} is on the street deck`);
    for (const t of w.CYBER_TOWERS) {
      assert.ok(Math.abs(p.x - w.vestibule(t, 0).x) >= 4, `post ${p.x},${p.y} is clear of the ${t.id} lift landing and its approach`);
      assert.ok(Math.abs(p.x - w.carStop(t).x) >= 3, `post ${p.x},${p.y} is clear of the ${t.id} car stop`);
    }
    assert.ok(!map.stations.some((s) => s.tile.x === p.x && s.tile.y === p.y), 'not on a workstation');
    assert.ok(map.transit.route(map.entrance, p), `post ${p.x},${p.y} is reachable from the entrance`);
  }
  // the town and Greenwood still stand keepers beside their lamps
  for (const m of [w.buildTownMap(0), w.buildGreenwoodMap()]) { assert.equal(m.posts, undefined); assert.deepEqual(w.validatePosts(m, 'town'), []); }
});

ok('the post validation has teeth: a forced invalid post is rejected, for every way a post can be wrong', () => {
  const map = cyber();
  const v0 = w.vestibule(w.CYBER_TOWERS[0], 0), ops = w.CYBER_TOWERS[2];
  const bad = (post, expected, m = map) => {
    const out = w.validatePosts({ ...m, posts: [post] }, 'cyber-city');
    assert.ok(out.some((x) => expected.test(x)), `${JSON.stringify(post)} should fail ${expected}: ${out.join(' | ') || 'no error'}`);
  };
  bad({ x: v0.x, y: v0.y }, /exclusion|boarding/);                                  // on the lift threshold itself
  bad({ x: v0.x + 2, y: v0.y }, /lift-approach/);                                  // directly in front of the lift
  bad({ x: v0.x + 1, y: w.STREET_YB - 2 }, /shaft|lift-approach/);                 // under the shaft
  bad({ x: w.carStop(ops).x, y: w.STREET_YB }, /car-stop/);                         // a car pickup point
  bad({ x: w.carStop(ops).x + 2, y: w.STREET_YB - 1 }, /car-stop/);                // its direct approach
  bad({ x: w.vestibule(ops, 0).x + 1, y: w.floorBase(1) - 1 }, /lift-approach/);   // the approach to an upper-deck lift
  bad({ x: 0, y: 0 }, /not a walkable tile/);                                       // void space
  const room = map.buildings[0];
  bad({ x: room.x + 1, y: room.y + 1 }, /not a walkable tile|inside building/);     // inside a room
  const st = map.stations[0];
  bad({ x: st.tile.x, y: st.tile.y }, /workstation/);                               // on a workstation
  const dup = w.validatePosts({ ...map, posts: [{ x: 8, y: 43 }, { x: 8, y: 43 }] }, 'cyber-city');
  assert.ok(dup.some((x) => /duplicates/.test(x)));
  // a tile that is walkable in the grid but that no route reaches
  const cost = new Uint8Array(map.grid.cost); cost[10 * map.grid.w + 1] = 1;
  bad({ x: 1, y: 10 }, /not reachable from the entrance/, { ...map, grid: { ...map.grid, cost } });
  // and the registry validation reports the same through the map
  const broken = { ...map, posts: [{ x: v0.x + 2, y: v0.y }] };
  assert.ok(w.validateMap(broken, w.findMap('cyber-city')).some((x) => /exclusion/.test(x)));
});

ok('keepers stand at the authored posts, share them least-crowded first, and keep their identity and history', () => {
  const map = cyber(), sim = new w.TownSim(map);
  const post = new Set(map.posts.map((p) => `${p.x},${p.y}`));
  const ids = Array.from({ length: 12 }, (_, i) => `h/cron/${String(i).padStart(16, 'k')}`);
  ids.forEach((id, i) => sim.push(ev(1, id, 'agent.spawned', { role: 'scheduled', displayName: `job ${i}` })));
  const before = new Map(ids.map((id) => [id, sim.residents.get(id).history.map((h) => h.text)]));
  run(sim, 160);
  const used = new Map();
  for (const id of ids) {
    const r = sim.residents.get(id);
    assert.equal(r.state, 'posted', `${id} is on watch`);
    assert.equal(r.bubble, 'on watch');
    const t = tile(r.x, r.y), key = `${t.x},${t.y}`;
    assert.ok(post.has(key), `${id} stands at an authored post (${key})`);
    for (const z of map.postExclusions) assert.ok(!(t.x >= z.x && t.x < z.x + z.w && t.y >= z.y && t.y < z.y + z.h), `${id} at ${key} is outside ${z.id}`);
    used.set(key, (used.get(key) ?? 0) + 1);
    assert.deepEqual(r.history.map((h) => h.text).filter((x) => !before.get(id).includes(x)), [], 'no activity was invented while walking to the post');
    assert.equal(r.id, id);
  }
  assert.equal(sim.residents.size, 12, 'one resident per keeper');
  assert.equal(used.size, map.posts.length, 'every post is used before any is shared twice');
  assert.ok(Math.max(...used.values()) <= 2, 'with more jobs than posts the extra keepers share the least-crowded posts');
});

// ---------------------------------------------------------- cars

ok('car transit is structural: district adjacency decides it, not a pixel distance', () => {
  const map = cyber(), net = map.transit;
  assert.deepEqual(w.CYBER_DISTRICTS.map((d) => d.id), w.CYBER_TOWERS.map((t) => t.id), 'districts follow the order of the towers along the street');
  const at = (id) => w.carStop(w.CYBER_TOWERS.find((t) => t.id === id));
  const cars = (a, b) => net.route(a, b).legs.filter((l) => l.kind === 'transit' && l.connectorId.startsWith('car-')).map((l) => l.connectorId);
  const ids = w.CYBER_TOWERS.map((t) => t.id);
  for (const a of ids) for (const b of ids) {
    const apart = Math.abs(ids.indexOf(a) - ids.indexOf(b)) >= 2;
    assert.equal(w.cyberDistrictsAdjacent(a, b), !apart, `${a}/${b} adjacency`);
    const from = { x: at(a).x, y: w.STREET_YB - 1 }, to = { x: at(b).x, y: w.STREET_YB - 1 };
    const plan = net.route(from, to);
    assert.deepEqual(cars(from, to), apart ? [`car-${a}-${b}`] : [], `${a} to ${b}: ${apart ? 'a car' : 'walking'}`);
    if (apart) assert.deepEqual(plan.legs.map((l) => l.kind), ['walk', 'transit', 'walk'], `${a} to ${b}: exactly walk, car, walk`);
    else assert.deepEqual(plan.legs.map((l) => l.kind), ['walk'], `${a} to ${b}: walking only`);
  }
  // Not a distance threshold: a shorter walk between districts that are apart still takes the car, and a longer walk to a
  // neighbouring district does not.
  const shortApart = { from: { x: 19, y: 44 }, to: { x: 43, y: 44 } };     // 24 tiles, archive to operations
  const longAdjacent = { from: { x: 2, y: 44 }, to: { x: 40, y: 44 } };    // 38 tiles, archive to maker
  assert.equal(w.cyberDistrictOf(shortApart.from), 'archive'); assert.equal(w.cyberDistrictOf(shortApart.to), 'operations');
  assert.equal(w.cyberDistrictOf(longAdjacent.from), 'archive'); assert.equal(w.cyberDistrictOf(longAdjacent.to), 'maker');
  assert.deepEqual(cars(shortApart.from, shortApart.to), ['car-archive-operations']);
  assert.deepEqual(cars(longAdjacent.from, longAdjacent.to), []);
  assert.ok(Math.abs(shortApart.to.x - shortApart.from.x) < Math.abs(longAdjacent.to.x - longAdjacent.from.x));
  // the rule is the model's: with every district a neighbour, the same trip walks
  const allNeighbours = w.createTransitNetwork(map.grid, map.transit.connectors, { districts: { of: w.cyberDistrictOf, adjacent: () => true } });
  assert.deepEqual(allNeighbours.route(shortApart.from, shortApart.to).legs.map((l) => l.kind), ['walk']);
  // the same building (same district), and a lift trip inside one tower, never takes a car
  const lib = map.stations.filter((s) => s.place === 'library'), obs = map.stations.find((s) => s.place === 'observatory');
  assert.deepEqual(cars(lib[0].tile, lib[1].tile), []);
  assert.deepEqual(cars(lib[0].tile, obs.tile), [], 'library F1 to observatory F2 is a lift inside one tower');
  assert.deepEqual(net.route(lib[0].tile, obs.tile).legs.filter((l) => l.kind === 'transit').map((l) => l.connectorId), ['lift-archive-1-2']);
  // car links exist only for pairs that are apart, one per ordered pair
  const links = w.cyberCarConnectors();
  assert.equal(links.length, 6);
  for (const c of links) {
    assert.ok(!w.cyberDistrictsAdjacent(c.visual.from, c.visual.to));
    assert.equal(c.visual.lane, c.exit.x > c.boarding.x ? 'east' : 'west');
    assert.equal(c.visual.laneY, c.visual.lane === 'east' ? w.ROAD.eastLaneY : w.ROAD.westLaneY);
    assert.ok(c.durationMs >= 600 && c.durationMs <= 9000);
  }
});

ok('car links are validated: a link between neighbouring districts, in the wrong lane, or off the street is rejected', () => {
  const map = cyber(), net = map.transit, model = net.districts;
  assert.ok(model, 'the network carries its district model');
  assert.deepEqual(w.validateTransit(map.grid, map.entrance, net.connectors, 'cyber-city', model), []);
  const car = net.connectors.find((c) => c.kind === 'car' && c.visual.lane === 'east');
  const check = (patch) => w.validateTransit(map.grid, map.entrance, [car, { ...car, id: 'x', ...patch }], 'cyber-city', model);
  const neighbour = { boarding: w.carStop(w.CYBER_TOWERS[0]), exit: w.carStop(w.CYBER_TOWERS[1]), visual: { ...car.visual, from: 'archive', to: 'maker' } };
  assert.ok(check(neighbour).some((m) => /neighbours/.test(m)), 'a car between neighbouring districts is rejected');
  assert.ok(check({ visual: { ...car.visual, lane: 'west', laneY: w.ROAD.westLaneY } }).some((m) => /lane does not match/.test(m)), 'a car in the wrong lane is rejected');
  assert.ok(check({ visual: { ...car.visual, from: 'maker' } }).some((m) => /do not lie in the districts/.test(m)));
  const stair = w.vestibule(w.CYBER_TOWERS[0], 1);
  assert.ok(check({ boarding: stair }).some((m) => /same street/.test(m)), 'a car stop on another deck is rejected');
  assert.ok(w.validateTransit(map.grid, map.entrance, [car], 'cyber-city').some((m) => /district model/.test(m)), 'a car link needs the map\'s district model');
});

ok('a resident rides a car walk, car, walk to a street station, as one resident with no event, history or log line', () => {
  const map = cyber(), sim = new w.TownSim(map);
  const id = 'h/cron/rrrrrrrrrrrrrrrr';
  sim.push(ev(1, id, 'agent.spawned', { role: 'scheduled', displayName: 'night keeper' }));
  const r = sim.residents.get(id);
  // the keeper's post is the first authored one; give it a far one instead (the Residential Tower's street lamp)
  const target = w.CYBER_POSTS.find((p) => p.id === 'residence-lamp').tile;
  r.post = { ...target }; r.queue[0].tile = { ...target };
  const log0 = sim.log.length, hist0 = r.history.length;
  run(sim, 0.1);
  const kinds = r.legs.map((l) => (l.kind === 'walk' ? 'walk' : l.connectorId.split('-')[0]));
  assert.deepEqual(kinds, ['walk', 'car', 'walk'], 'exactly walk, car, walk');
  const rides = [], states = new Set();
  let maxResidents = 0;
  run(sim, 40, 0.05, () => {
    maxResidents = Math.max(maxResidents, sim.residents.size); states.add(r.state);
    if (r.transit) rides.push({ id: r.transit.connectorId, x: r.x, y: r.y, from: r.transit.from, to: r.transit.to });
  });
  assert.ok(rides.length > 40, `the keeper rode (${rides.length} ticks)`);
  assert.ok(rides.every((q) => q.id === 'car-archive-residential'), 'one car link for the whole ride');
  const c = map.transit.byId('car-archive-residential');
  assert.equal(c.visual.lane, 'east');
  const xs = rides.map((q) => q.x);
  assert.ok(xs.every((x, i) => i === 0 || x >= xs[i - 1] - 1e-6), 'the car only ever drives east along its lane');
  assert.ok(rides.some((q) => Math.abs(q.y - w.ROAD.eastLaneY) < 0.01), 'the car drives on the eastbound lane line');
  assert.ok(rides.every((q) => q.y >= q.from.y - 0.01 && q.y <= w.ROAD.eastLaneY + 0.01), 'and never goes past its lane line, so never crosses the divider');
  assert.equal(maxResidents, 1, 'one resident, never a duplicate');
  assert.ok([...states].every((s) => ['moving', 'posted'].includes(s)), `public state is the ordinary one (${[...states]})`);
  assert.equal(r.state, 'posted');
  assert.equal(sim.log.length, log0, 'the ride wrote nothing to the log');
  assert.equal(r.history.length, hist0 + 0, 'and nothing to the history');
  assert.ok(![...r.history, ...sim.log].some((h) => /car|lift|transit|ride/i.test(h.text)));
});

ok('a westbound trip rides the westbound lane; neighbouring and same-building trips never take a car', () => {
  const map = cyber();
  const sim = new w.TownSim(map);
  const id = 'h/main/wwwwwwwwwwwwwwww';
  sim.push(ev(1, id, 'agent.assigned'));
  const r = sim.residents.get(id);
  // stand the resident in the Residential district, then send it to the Library (Archive Tower): three districts away
  const start = tile(r.x, r.y); void start;
  r.x = 75 * TILE + 8; r.y = 44 * TILE + 8; r.queue.length = 0; r.state = 'idle';
  const lib = map.stations.find((s) => s.place === 'library');
  sim.walkTo(r, lib.tile); r.state = 'moving'; r.intent = { target: { place: 'library', style: 'sit', verb: 'reading' }, tool: null, tile: lib.tile };
  const used = [];
  let west = true, residents = 0, onLane = 0;
  run(sim, 120, 0.05, () => {
    residents = Math.max(residents, sim.residents.size);
    if (r.transit && !used.includes(r.transit.connectorId)) used.push(r.transit.connectorId);
    if (r.transit && r.transit.connectorId.startsWith('car-')) {
      if (Math.abs(r.y - w.ROAD.westLaneY) < 0.01) onLane += 1;
      if (r.y < r.transit.from.y - 0.01 || r.y > w.ROAD.westLaneY + 0.01) west = false; // between the curb and the westbound lane line, nowhere else
    }
  });
  assert.deepEqual(used, ['car-residential-archive', 'lift-archive-0-1'], 'car west along the street, then the Archive Tower lift');
  assert.ok(west && onLane > 20, 'the car drove the westbound lane line and never left the road');
  assert.equal(map.transit.byId('car-residential-archive').visual.lane, 'west');
  assert.equal(residents, 1);
  // an adjacent district and the same building: no car, only walking and lifts
  for (const [from, to] of [[{ x: 30, y: 44 }, 'library'], [{ x: 50, y: 44 }, 'workshop'], [{ x: 70, y: 44 }, 'hall'], [{ x: 8, y: 44 }, 'observatory']]) {
    const s2 = new w.TownSim(map), id2 = 'h/main/vvvvvvvvvvvvvvvv';
    s2.push(ev(1, id2, 'agent.assigned'));
    const q = s2.residents.get(id2);
    q.x = from.x * TILE + 8; q.y = from.y * TILE + 8; q.queue.length = 0;
    const target = map.stations.find((s) => s.place === to).tile;
    s2.walkTo(q, target);
    const apart = Math.abs(w.CYBER_DISTRICTS.findIndex((d) => d.id === w.cyberDistrictOf(from)) - w.CYBER_DISTRICTS.findIndex((d) => d.id === w.CYBER_TOWERS.find((t) => t.floors.some((f) => f.place === to))?.id)) >= 2;
    assert.equal(q.legs.some((l) => l.kind === 'transit' && l.connectorId.startsWith('car-')), apart, `${JSON.stringify(from)} to ${to}`);
  }
});

ok('the road: a bold dashed divider between two lanes, each car size and speed clearly above the earlier baseline', () => {
  const R = w.ROAD;
  assert.ok(R.y0 < R.eastLaneY && R.eastLaneY < R.divider && R.divider < R.westLaneY && R.westLaneY < R.y1, 'east lane, divider, west lane, in order, inside the road');
  assert.equal(R.divider - R.eastLaneY, R.westLaneY - R.divider - 0 + 0 - (R.westLaneY - R.divider - (R.divider - R.eastLaneY)), 'the divider is the middle line between the lane centres');
  assert.equal(R.westLaneY - R.divider, R.divider - R.eastLaneY, 'the divider is centred between the lanes');
  assert.ok(R.dividerThickness >= 3, 'a bold divider');
  const half = w.CAR_SIZE.h / 2;
  assert.ok(R.eastLaneY + half < R.divider - R.dividerThickness / 2, 'an eastbound car sits wholly on its side of the divider');
  assert.ok(R.westLaneY - half > R.divider + R.dividerThickness / 2, 'a westbound car sits wholly on its side of the divider');
  assert.ok(R.eastLaneY - half >= R.y0 && R.westLaneY + half <= R.y1, 'and both cars are on the road');
  assert.ok(w.CAR_SIZE.w >= w.PRIOR_CAR_SIZE.w * 1.5 && w.CAR_SIZE.h >= w.PRIOR_CAR_SIZE.h * 1.5, 'cars are materially larger');
  assert.ok(w.CAR_SIZE.w * w.CAR_SIZE.h >= 3 * w.PRIOR_CAR_SIZE.w * w.PRIOR_CAR_SIZE.h, 'and several times the earlier area');
  assert.ok(w.TRAFFIC_SPEED.min > 50, 'traffic is faster than the earlier 26 to 50 px/s');
  assert.ok(w.CAR_RIDE_SPEED > w.TRAFFIC_SPEED.min);
  const d = w.ROAD_RIDE_DEPTHS;
  assert.ok(d.car < d.doors && d.doors < d.passenger && d.passenger < d.indicator && d.indicator < 0, 'a car carrying a resident is on the road, below every resident and prop');
  assert.ok(d.car > -11 && d.car > -10.5 - 1, 'above the road surface');
  // the stops are on the street's front row, in the districts they serve, beside the road
  for (const t of w.CYBER_TOWERS) { const s = w.carStop(t); assert.equal(s.y, w.STREET_YB); assert.equal(w.cyberDistrictOf(s), t.id); assert.ok(cyber().grid.cost[s.y * w.CYBER_W + s.x] !== 0); }
});

// ---------------------------------------------------------- rider overlay occlusion (geometry)

ok('a lift rider is behind a slab exactly while the passenger overlaps a slab of its own tower: per rider, per slab', () => {
  const slabs = w.liftOccluderRects();
  const ops = w.CYBER_TOWERS.find((t) => t.id === 'operations'), cx = w.liftCentreX(ops);
  const floor = (f) => w.deckTopPx(f);
  const behind = (tower, x, floorY) => w.slabBehindRider(tower, w.liftPassengerBox(x, floorY), slabs);
  // at a landing, the cabin's floor is a deck's back edge: in the opening, never behind that deck's slab
  for (const f of [0, 1, 2, 3]) assert.equal(behind('operations', cx, floor(f)), null, `landing F${f}`);
  // between two decks (cabin floor midway above F1), in the opening
  assert.equal(behind('operations', cx, (floor(1) + floor(2)) / 2 + 72 - 72), null);
  // across a deck: the passenger overlaps that deck's slab
  for (const f of [1, 2, 3]) {
    const s = behind('operations', cx, floor(f) + 24);
    assert.ok(s && s.floor === f && s.tower === 'operations', `behind the F${f} slab`);
  }
  // just above and just below the slab's own edges
  const s1 = slabs.find((s) => s.id === 'operations-f1');
  assert.equal(behind('operations', cx, s1.y + 4), null, 'passenger bottom exactly at the slab top: still in the opening above it');
  assert.ok(behind('operations', cx, s1.y + 4 + 0.5), 'half a pixel into the slab: behind it');
  assert.equal(behind('operations', cx, s1.y + s1.h + 4 + w.PASSENGER_H), null, 'passenger top exactly at the slab bottom: out of it, below');
  assert.ok(behind('operations', cx, s1.y + s1.h + 4 + w.PASSENGER_H - 0.5), 'half a pixel above that: still behind it');
  // per slab and per tower: another tower's slab never hides this rider, and a rider outside the shaft is not behind it
  assert.equal(behind('archive', cx, floor(1) + 24), null, 'the Archive Tower rider is not behind an Operations slab');
  assert.equal(behind('operations', cx + w.LIFT_SHAFT_HALF_W + 4, floor(1) + 24), null, 'a box outside the shaft width is not behind the slab');
  // a ride up crosses each slab on its way and is in an opening between them
  const states = []; for (let y = floor(0); y >= floor(3); y -= 2) states.push(Boolean(behind('operations', cx, y)));
  let transitions = 0; for (let i = 1; i < states.length; i++) if (states[i] !== states[i - 1]) transitions += 1;
  assert.equal(transitions, 6, 'behind, then clear, three times: F1, F2 and F3 each hide the rider once (enter and leave)');
});

// ---------------------------------------------------------- camera floor

ok('the camera zoom floor is dynamic and map-specific: the window at the floor never shows space beyond the authored world', () => {
  const viewports = [[640, 360], [800, 1200], [1280, 720], [1440, 900], [1672, 940], [1920, 1080], [2560, 1080], [3840, 2160], [320, 240]];
  const floors = new Map();
  for (const id of ['town', 'greenwood', 'cyber-city', 'orbital-system']) {
    const map = w.findMap(id).build();
    const W = map.grid.w * TILE, H = map.grid.h * TILE;
    for (const [vw, vh] of viewports) {
      const f = w.zoomFloor(vw, vh, W, H);
      assert.ok(w.viewInsideWorld(f, vw, vh, W, H), `${id} ${vw}x${vh}: the window at the floor lies inside the world`);
      assert.ok(!w.viewInsideWorld(f * 0.98, vw, vh, W, H), `${id} ${vw}x${vh}: a zoom below the floor shows space beyond the world (the check has teeth)`);
      assert.equal(w.clampZoom(f * 0.2, f), f, 'a deliberately lowered zoom is raised to the floor');
      assert.equal(w.clampZoom(5, f), 5, 'zooming in is never restricted');
      assert.ok(f > 0);
      floors.set(`${id}@${vw}x${vh}`, f);
    }
  }
  assert.notEqual(floors.get('town@1672x940'), floors.get('cyber-city@1672x940'), 'each map has its own floor at the same viewport');
  assert.notEqual(floors.get('cyber-city@1672x940'), floors.get('cyber-city@1280x720'), 'and the floor follows the viewport');
  assert.ok(floors.get('cyber-city@3840x2160') > floors.get('cyber-city@1280x720'), 'a larger window needs a closer camera');
});

console.log(`verify-worlds: ${checks} checks passed`);
