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
  export { validateRegistry, validateMap } from './src/themes/validate.ts';
  export { TownSim } from './src/sim/town.ts';
  export { findPath } from './src/world/pathfind.ts';
  export { createTransitNetwork, validateTransit, labelRegions, transitPhase, transitPoint, riderVisible } from './src/world/transit.ts';
  export { strayWalkable } from './src/world/regions.ts';
  export { buildTownMap, buildGreenwoodMap, STALL_KINDS } from './src/world/map.ts';
  export { buildCyberCityMap, CYBER_TOWERS, floorBase, vestibule } from './src/world/cyberCity.ts';
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
    if (!runner.transit) return;
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

console.log(`verify-worlds: ${checks} checks passed`);
