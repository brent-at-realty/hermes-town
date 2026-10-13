// Shared Town verification: one server, one token per local Hermes profile.
//
// Proves, against a real server on loopback and the real plugin:
//   - every profile publishes into the one server and each resident carries the
//     profile its *token* belongs to (never one the request body names);
//   - one profile's token cannot drive another profile's resident, replay its
//     ingress ids, or authenticate after it leaves the registry;
//   - a profile added while the server runs is accepted without a restart;
//   - slot allocation is deterministic, collision-free and append-stable, and
//     the browser's palette module agrees with the server on the fallback;
//   - the clothing palette is perceptually distinct;
//   - the privacy contract still holds: no new client-supplied field, no path,
//     token, or profile roster in public routes.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { INGRESS_VERSION, PROFILE_PALETTE_SIZE, fnv1a, preferredProfileSlot } from '../server/lib/contract.mjs';
import {
  REGISTRY_VERSION, allocateSlots, createProfileDirectory, parseRegistry, profileTokenPath,
} from '../server/lib/profiles.mjs';
import { deriveCronKey } from '../server/lib/cronSeed.mjs';
import { createTownServer, loadToken } from '../server/townServer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-town-shared-'));
const PRIVATE = 'HT_SHARED_PRIVATE_SENTINEL';

function makeHome(name, { token = crypto.randomBytes(32).toString('base64url'), jobs = null } = {}) {
  const home = path.join(temp, name);
  fs.mkdirSync(path.join(home, 'hermes-town', 'runtime'), { recursive: true });
  if (token !== null) fs.writeFileSync(profileTokenPath(home), `${token}\n`, { mode: 0o600 });
  if (jobs !== null) {
    fs.mkdirSync(path.join(home, 'cron'), { recursive: true });
    fs.writeFileSync(path.join(home, 'cron', 'jobs.json'), JSON.stringify({ jobs }));
  }
  return { name, home, token };
}

function writeRegistry(file, profiles, extra = {}) {
  fs.writeFileSync(file, `${JSON.stringify({ v: REGISTRY_VERSION, profiles: profiles.map(({ name, home }) => ({ name, home, ...extra[name] })) })}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

let eventSerial = 0;
function ingressEvent(key, kind = 'spawned', extra = {}) {
  eventSerial += 1;
  return { id: `evt_shared_${String(eventSerial).padStart(6, '0')}`, key, kind, role: 'coordinator', ...extra };
}

async function post(base, token, events, extraBody = {}) {
  return fetch(`${base}/api/town/ingest`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ v: INGRESS_VERSION, events, ...extraBody }),
  });
}

const snapshot = async (base) => (await fetch(`${base}/api/town/snapshot`)).json();
const spawnOf = (snap, key) => snap.events.find((event) => event.agentId === key && event.type === 'agent.spawned');

// -- slot allocation ----------------------------------------------------------
{
  const names = ['default', 'claude-coder', 'uat', 'curator', 'planner', 'reviewer', 'ops', 'research', 'writer', 'qa', 'ci', 'bot'];
  const slots = allocateSlots(names.map((name) => ({ name })));
  assert.equal(new Set(slots.values()).size, names.length, 'twelve profiles get twelve distinct colours');
  assert.deepEqual([...allocateSlots(names.map((name) => ({ name }))).entries()], [...slots.entries()], 'allocation is deterministic');
  const grown = allocateSlots([...names, 'late-arrival'].map((name) => ({ name })));
  for (const name of names) assert.equal(grown.get(name), slots.get(name), `appending a profile does not move ${name}`);
  assert.equal(grown.get('late-arrival') < PROFILE_PALETTE_SIZE, true);
  const pinned = allocateSlots([{ name: 'a', slot: 5 }, { name: 'b' }]);
  assert.equal(pinned.get('a'), 5);
  assert.notEqual(pinned.get('b'), 5, 'an explicit slot is reserved for its owner');
  assert.equal(allocateSlots([{ name: 'solo' }]).get('solo'), preferredProfileSlot('solo'), 'an uncontested profile gets the slot its name hashes to');
  const over = allocateSlots(Array.from({ length: PROFILE_PALETTE_SIZE + 3 }, (_, index) => ({ name: `p${index}` })));
  assert.equal(over.size, PROFILE_PALETTE_SIZE + 3, 'more profiles than colours still all resolve');
  for (const slot of over.values()) assert.ok(slot >= 0 && slot < PROFILE_PALETTE_SIZE);
}

// -- registry parsing ---------------------------------------------------------
{
  const ok = (value) => parseRegistry(JSON.stringify(value));
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: 'a', home: '/tmp/a' }] }).ok, true);
  assert.equal(ok({ v: 'nope', profiles: [] }).ok, false);
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: 'A', home: '/tmp/a' }] }).ok, false, 'uppercase label rejected');
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: '../x', home: '/tmp/a' }] }).ok, false, 'path-like label rejected');
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: 'a', home: 'relative' }] }).ok, false, 'relative home rejected');
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: 'a', home: '/tmp/a', tokenFile: '/etc/passwd' }] }).ok, false, 'a per-entry token path is not configurable');
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: 'a', home: '/tmp/a' }, { name: 'a', home: '/tmp/b' }] }).ok, false, 'duplicate names rejected');
  assert.equal(ok({ v: REGISTRY_VERSION, profiles: [{ name: 'a', home: '/tmp/a', slot: 99 }] }).ok, false, 'slot outside the palette rejected');
  assert.equal(parseRegistry('{').ok, false);
}

// -- the browser palette ------------------------------------------------------
{
  const esbuild = await import('esbuild');
  const source = fs.readFileSync(path.join(root, 'src/art/profileColors.ts'), 'utf8');
  const js = esbuild.transformSync(source, { loader: 'ts', format: 'esm' }).code;
  const palette = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.equal(palette.PROFILE_PALETTE.length, PROFILE_PALETTE_SIZE, 'client and server agree on the palette size');
  for (const name of ['default', 'claude-coder', 'a', 'zz_top-9']) {
    assert.equal(palette.profileHash(name), fnv1a(name), `FNV parity for ${name}`);
    assert.equal(palette.profileColorFor(name).slot, preferredProfileSlot(name), `fallback slot parity for ${name}`);
  }
  assert.equal(palette.profileColorFor('whatever', 7).slot, 7, 'a server-assigned slot wins');
  assert.equal(palette.profileColorFor('whatever', 7 + PROFILE_PALETTE_SIZE).slot, 7, 'an out-of-range slot wraps instead of failing');
  assert.equal(palette.profileColorFor('whatever', -1).slot, preferredProfileSlot('whatever'), 'a malformed slot falls back to the name');
  assert.deepEqual(palette.profileColorFor('new-profile'), palette.profileColorFor('new-profile'), 'unknown profiles are deterministic');
  assert.equal(palette.profileColorFor(null), null);
  assert.equal(palette.profileColorFor('Bad Label'), null);
  assert.equal(palette.profileColorFor('x'.repeat(65)), null);

  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lab = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => lin(parseInt(hex.slice(index, index + 2), 16)));
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  let minimum = Infinity;
  for (let i = 0; i < palette.PROFILE_PALETTE.length; i += 1) {
    for (let j = i + 1; j < palette.PROFILE_PALETTE.length; j += 1) {
      const a = lab(palette.PROFILE_PALETTE[i].cloth);
      const b = lab(palette.PROFILE_PALETTE[j].cloth);
      minimum = Math.min(minimum, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  assert.ok(minimum >= 25, `palette colours must stay visually distinct (min CIE76 distance ${minimum.toFixed(1)} < 25)`);
  globalThis.__minimumDeltaE = minimum;
}

// -- shared server ------------------------------------------------------------
const alpha = makeHome('alpha', { jobs: [{ id: 'job_alpha_1', enabled: true, prompt: PRIVATE }, { id: 'job_off', enabled: false }] });
const beta = makeHome('beta');
const gamma = makeHome('gamma', { jobs: [{ id: 'job_gamma_1', enabled: true }] });
const registryPath = path.join(temp, 'profiles.json');
writeRegistry(registryPath, [alpha, beta, gamma]);

const directory = createProfileDirectory({ registryPath, loadToken, reloadIntervalMs: 0 });
assert.equal(directory.list().length, 3);
assert.equal(new Set(directory.list().map((profile) => profile.slot)).size, 3, 'three profiles, three colours');
assert.equal(JSON.stringify(directory.list()).includes(alpha.token), false, 'the directory listing carries no token');

const management = crypto.randomBytes(32).toString('base64url');
assert.throws(() => createTownServer({ profiles: directory, token: alpha.token, journalPath: path.join(temp, 'x.jsonl') }), /either a bridge token or a profile directory/);
assert.throws(() => createTownServer({ journalPath: path.join(temp, 'x.jsonl') }), /either a bridge token or a profile directory/);
assert.throws(() => createTownServer({ profiles: directory, journalPath: path.join(temp, 'x.jsonl'), managementToken: 'short' }), /strong, separate/);

const town = createTownServer({
  profiles: directory,
  journalPath: path.join(temp, 'journal.jsonl'),
  staticRoot: null,
  heartbeatSeconds: 60,
  profileRefreshSeconds: 3600,
  managementToken: management,
});
const slotOf = (name) => directory.list().find((profile) => profile.name === name).slot;

try {
  await assert.rejects(() => town.listen(0, '0.0.0.0'), /only binds to loopback/);
  const address = await town.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  // Cron keepers stand up per profile, with that profile's own token and label.
  const keeperAlpha = deriveCronKey(alpha.token, 'job_alpha_1');
  const keeperGamma = deriveCronKey(gamma.token, 'job_gamma_1');
  let snap = await snapshot(base);
  assert.equal(spawnOf(snap, keeperAlpha)?.profile, 'alpha');
  assert.equal(spawnOf(snap, keeperAlpha)?.paletteSlot, slotOf('alpha'));
  assert.equal(spawnOf(snap, keeperGamma)?.profile, 'gamma');
  assert.equal(snap.events.filter((event) => event.type === 'agent.spawned').length, 2, 'only enabled jobs get keepers');

  // Each profile publishes with its own token and is labelled by it.
  const keys = { alpha: 'h/main/aaaaaaaaaaaaaaaa', beta: 'h/main/bbbbbbbbbbbbbbbb', gamma: 'h/main/cccccccccccccccc' };
  for (const profile of [alpha, beta, gamma]) {
    const response = await post(base, profile.token, [ingressEvent(keys[profile.name]), ingressEvent(keys[profile.name], 'assigned')]);
    assert.equal(response.status, 202, `${profile.name} ingest`);
  }
  snap = await snapshot(base);
  for (const profile of [alpha, beta, gamma]) {
    const spawn = spawnOf(snap, keys[profile.name]);
    assert.equal(spawn.profile, profile.name);
    assert.equal(spawn.paletteSlot, slotOf(profile.name));
  }
  assert.equal(new Set(['alpha', 'beta', 'gamma'].map((name) => spawnOf(snap, keys[name]).paletteSlot)).size, 3, 'residents of three profiles wear three colours');
  assert.equal(snap.events.filter((event) => event.type !== 'agent.spawned' && 'profile' in event).length, 0, 'profile rides on the spawn event only');

  // A mid-life event for an unseen resident synthesises a spawn that is labelled too.
  const late = 'h/main/dddddddddddddddd';
  assert.equal((await post(base, beta.token, [ingressEvent(late, 'assigned')])).status, 202);
  snap = await snapshot(base);
  assert.equal(spawnOf(snap, late).profile, 'beta');

  // The body cannot name a profile, and an unknown token gets nothing.
  const forged = await post(base, alpha.token, [{ ...ingressEvent('h/main/eeeeeeeeeeeeeeee'), profile: 'beta' }]);
  assert.equal(forged.status, 400, 'a client-supplied profile field is a schema error');
  assert.equal((await post(base, alpha.token, [ingressEvent('h/main/eeeeeeeeeeeeeeee')], { profile: 'beta' })).status, 400);
  assert.equal((await post(base, alpha.token, [{ ...ingressEvent('h/main/eeeeeeeeeeeeeeee'), paletteSlot: 1 }])).status, 400);
  assert.equal((await post(base, crypto.randomBytes(32).toString('base64url'), [ingressEvent('h/main/eeeeeeeeeeeeeeee')])).status, 401);
  assert.equal((await post(base, management, [ingressEvent('h/main/eeeeeeeeeeeeeeee')])).status, 401, 'the management secret does not ingest');
  assert.equal((await fetch(`${base}/api/town/ingest`, { method: 'POST', body: '{}' })).status, 401);
  snap = await snapshot(base);
  assert.equal(snap.events.some((event) => event.agentId === 'h/main/eeeeeeeeeeeeeeee'), false);

  // Token isolation: alpha's token cannot drive beta's resident.
  const before = (await snapshot(base)).cursor;
  const hijack = await post(base, alpha.token, [ingressEvent(keys.beta, 'tool_started', { tool: 'terminal' })]);
  assert.equal(hijack.status, 202);
  const hijackBody = await hijack.json();
  assert.equal(hijackBody.accepted, 0);
  assert.equal(hijackBody.skipped, 1);
  assert.equal((await snapshot(base)).cursor, before, 'a foreign-key event is not published');
  assert.equal(town.state.stats().foreignKeys, 1);

  // Ingress ids are namespaced: replaying another profile's id is not a duplicate of it, and not a suppression.
  const shared = { id: 'evt_same_id_0001', kind: 'spawned', role: 'research' };
  assert.equal((await (await post(base, alpha.token, [{ ...shared, key: 'h/main/1111111111111111' }])).json()).accepted, 1);
  assert.equal((await (await post(base, beta.token, [{ ...shared, key: 'h/main/2222222222222222' }])).json()).accepted, 1, 'the same id from another profile is a distinct event');
  assert.equal((await (await post(base, alpha.token, [{ ...shared, key: 'h/main/1111111111111111' }])).json()).duplicate, 1, 'a replay inside one profile is still de-duplicated');

  // Management route reports per-profile delivery; the public health route does not name anyone.
  const manage = await (await fetch(`${base}/api/town/manage`, { headers: { authorization: `Bearer ${management}` } })).json();
  assert.deepEqual(manage.profiles.map((profile) => profile.name).sort(), ['alpha', 'beta', 'gamma']);
  assert.ok(manage.profiles.find((profile) => profile.name === 'alpha').receivedEvents >= 2);
  assert.equal((await fetch(`${base}/api/town/manage`, { headers: { authorization: `Bearer ${alpha.token}` } })).status, 401, 'a profile token cannot read management detail');
  const health = await (await fetch(`${base}/api/town/health`)).json();
  assert.equal(health.shared.profiles, 3);
  const healthText = JSON.stringify(health);
  for (const secret of [alpha.token, beta.token, gamma.token, management, temp, 'alpha', 'beta']) {
    assert.equal(healthText.includes(secret), false, 'health exposes no secret, path, or roster');
  }

  // A profile registered while the server runs is accepted without a restart.
  const delta = makeHome('delta');
  assert.equal((await post(base, delta.token, [ingressEvent('h/main/4444444444444444')])).status, 401, 'unregistered profile is refused');
  writeRegistry(registryPath, [alpha, beta, gamma, delta]);
  const accepted = await post(base, delta.token, [ingressEvent('h/main/4444444444444444')]);
  assert.equal(accepted.status, 202, 'a newly registered profile is picked up on its first request');
  snap = await snapshot(base);
  assert.equal(spawnOf(snap, 'h/main/4444444444444444').profile, 'delta');
  assert.equal(new Set(['alpha', 'beta', 'gamma', 'delta'].map(slotOf)).size, 4, 'appending delta did not move or collide with the others');
  assert.equal(slotOf('alpha') === spawnOf(snap, keys.alpha).paletteSlot, true, 'existing profiles keep their colour');

  // A profile removed from the registry stops authenticating.
  writeRegistry(registryPath, [alpha, beta, delta]);
  town.refreshProfiles({ force: true });
  assert.equal((await post(base, gamma.token, [ingressEvent(keys.gamma, 'waiting', { outcome: 'ok' })])).status, 401, 'a removed profile is locked out');
  assert.equal((await post(base, alpha.token, [ingressEvent(keys.alpha, 'waiting', { outcome: 'ok' })])).status, 202, 'the others are unaffected');

  // A half-written registry keeps the last good set rather than locking everyone out.
  fs.writeFileSync(registryPath, '{ not json', { mode: 0o600 });
  town.refreshProfiles({ force: true });
  assert.equal(directory.registryProblem() !== null, true);
  assert.equal((await post(base, beta.token, [ingressEvent(keys.beta, 'waiting', { outcome: 'ok' })])).status, 202);
  writeRegistry(registryPath, [alpha, beta, gamma, delta]);
  town.refreshProfiles({ force: true });
  assert.equal(directory.registryProblem(), null);

  // A registry other users could rewrite is not trusted.
  fs.chmodSync(registryPath, 0o666);
  assert.equal(createProfileDirectory({ registryPath, loadToken }).registryProblem()?.includes('writable'), true);
  fs.chmodSync(registryPath, 0o600);

  // Public surface: only allowlisted fields, no secrets, paths, or private sentinels.
  const PUBLIC = new Set(['cursor', 'id', 'seq', 'at', 'agentId', 'type', 'role', 'displayName', 'district', 'action', 'tool', 'reason', 'detail', 'profile', 'paletteSlot']);
  snap = await snapshot(base);
  const incremental = await (await fetch(`${base}/api/town/snapshot?since=0&stream=${encodeURIComponent(snap.streamId)}`)).json();
  for (const event of [...snap.events, ...incremental.events]) {
    for (const name of Object.keys(event)) assert.ok(PUBLIC.has(name), `unexpected public event field: ${name}`);
    if ('profile' in event) assert.equal(event.type, 'agent.spawned');
  }
  const publicText = JSON.stringify(snap) + JSON.stringify(incremental);
  for (const secret of [alpha.token, beta.token, gamma.token, management, temp, PRIVATE, alpha.home]) {
    assert.equal(publicText.includes(secret), false, 'public routes carry no token, path, or private sentinel');
  }
  const journalText = fs.readFileSync(path.join(temp, 'journal.jsonl'), 'utf8');
  for (const secret of [alpha.token, beta.token, management, temp, PRIVATE]) {
    assert.equal(journalText.includes(secret), false, 'the journal carries no token, path, or private sentinel');
  }

  // Real plugin, three Hermes homes, one session id: three distinct residents, three labels.
  const plugin = (profile, bridgeBase) => new Promise((resolve, reject) => {
    const child = spawn('python3', ['tests/emit-plugin-events.py'], {
      cwd: root,
      env: { ...process.env, HERMES_HOME: profile.home, HERMES_TOWN_BRIDGE_URL: `${bridgeBase}/api/town/ingest`, HERMES_TOWN_BRIDGE_TOKEN_FILE: profileTokenPath(profile.home) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      try { resolve(JSON.parse(stdout.trim().split('\n').pop() ?? '')); } catch { reject(new Error(`no plugin report (exit ${code})`)); }
    });
  });
  const start = (await snapshot(base)).cursor;
  for (const profile of [alpha, beta, delta]) assert.equal((await plugin(profile, base)).ok, true, `${profile.name} plugin delivery`);
  const delivered = await (await fetch(`${base}/api/town/snapshot?since=${start}&stream=${encodeURIComponent(snap.streamId)}`)).json();
  const spawned = delivered.events.filter((event) => event.type === 'agent.spawned');
  assert.equal(spawned.length, 3, 'the same raw session id in three profiles is three residents');
  assert.deepEqual(spawned.map((event) => event.profile).sort(), ['alpha', 'beta', 'delta']);
  assert.equal(new Set(spawned.map((event) => event.agentId)).size, 3);
  assert.equal(JSON.stringify(delivered).includes('HT_DELIVERY_PRIVATE_SENTINEL'), false);

  console.log(JSON.stringify({
    ok: true,
    profiles: 4,
    perProfileLabels: true,
    clientProfileFieldRejected: 400,
    foreignKeyRejected: true,
    idsNamespaced: true,
    hotRegister: true,
    removedProfileLockedOut: true,
    badRegistryKeepsLastGood: true,
    pluginDelivery: spawned.length,
    paletteMinDeltaE: Number(globalThis.__minimumDeltaE.toFixed(1)),
    privateSentinelAbsent: true,
  }));
} finally {
  await town.close();
  fs.rmSync(temp, { recursive: true, force: true });
}

// Weak, shared, or unreadable profile tokens are excluded and the rest still load.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-town-shared-bad-'));
  try {
    const make = (name, token) => {
      const home = path.join(dir, name);
      fs.mkdirSync(path.join(home, 'hermes-town', 'runtime'), { recursive: true });
      if (token !== null) fs.writeFileSync(profileTokenPath(home), `${token}\n`, { mode: 0o600 });
      return { name, home };
    };
    const good = crypto.randomBytes(32).toString('base64url');
    const twin = crypto.randomBytes(32).toString('base64url');
    const profiles = [make('good', good), make('weak', 'aaaa'), make('missing', null), make('twin-a', twin), make('twin-b', twin)];
    const loose = make('loose', crypto.randomBytes(32).toString('base64url'));
    fs.chmodSync(profileTokenPath(loose.home), 0o644);
    profiles.push(loose);
    const file = path.join(dir, 'profiles.json');
    fs.writeFileSync(file, JSON.stringify({ v: REGISTRY_VERSION, profiles }), { mode: 0o600 });
    const bad = createProfileDirectory({ registryPath: file, loadToken });
    assert.deepEqual(bad.list().map((profile) => profile.name), ['good']);
    assert.deepEqual(bad.problems().map((problem) => problem.name).sort(), ['loose', 'missing', 'twin-a', 'twin-b', 'weak']);
    assert.equal(bad.authenticate(twin), null, 'a token two profiles share authenticates neither');
    assert.equal(bad.authenticate(good)?.name, 'good');
    const reserved = createProfileDirectory({ registryPath: file, loadToken, reservedSecrets: [good] });
    assert.equal(reserved.list().length, 0, 'a profile token equal to a reserved server secret is excluded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
