// Shared Town: one server, one bearer token per local Hermes profile.
//
// A profile registry names the Hermes homes that may publish. Each home keeps
// its own `hermes-town/runtime/bridge-token`, exactly as in single-profile
// mode, so the plugin needs no change and the wire contract does not grow a
// client-supplied field. The profile a resident belongs to is decided here, by
// *which token authenticated the request*, and attached by the server. An
// ingress body therefore cannot claim another profile's label, and a profile's
// pseudonymous keys (HMAC under its own token) cannot collide with another's.
//
// Registry file (`hermes-town.profiles.v1`), mode 0600, owner-only:
//
//   { "v": "hermes-town.profiles.v1",
//     "profiles": [ { "name": "default", "home": "/home/u/.hermes" },
//                   { "name": "coder",   "home": "/home/u/.hermes/profiles/coder", "slot": 3 } ] }
//
// Only `name`, `home` and an optional clothing `slot` are read. The token is
// always `<home>/hermes-town/runtime/bridge-token` and the scheduler's jobs
// file is `<home>/cron/jobs.json`; neither path is configurable per entry.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { PROFILE_NAME, PROFILE_PALETTE_SIZE, preferredProfileSlot } from './contract.mjs';
import { cronSeedEntries, readEnabledJobIds } from './cronSeed.mjs';

export const REGISTRY_VERSION = 'hermes-town.profiles.v1';
export const MAX_PROFILES = 64;
const MAX_REGISTRY_BYTES = 64 * 1024;

export function profileTokenPath(home) {
  return path.join(home, 'hermes-town', 'runtime', 'bridge-token');
}

export function profileJobsPath(home) {
  return path.join(home, 'cron', 'jobs.json');
}

/**
 * Assign every profile a clothing slot, stable and collision-free while the
 * palette lasts.
 *
 * Explicit slots are honoured first. The rest are placed in registry order at
 * the slot their name hashes to, probing forward to the next free one. The
 * result depends only on the registry's content and order, so it is the same
 * on every boot; appending a profile never moves an existing one. With more
 * profiles than palette entries, the surplus reuse their preferred slot.
 *
 * @param {{name: string, slot?: number}[]} entries
 * @returns {Map<string, number>}
 */
export function allocateSlots(entries) {
  const slots = new Map();
  const taken = new Set();
  for (const entry of entries) {
    if (Number.isInteger(entry.slot)) {
      slots.set(entry.name, entry.slot);
      taken.add(entry.slot);
    }
  }
  for (const entry of entries) {
    if (slots.has(entry.name)) continue;
    const preferred = preferredProfileSlot(entry.name);
    let slot = preferred;
    for (let step = 0; step < PROFILE_PALETTE_SIZE; step += 1) {
      const candidate = (preferred + step) % PROFILE_PALETTE_SIZE;
      if (!taken.has(candidate)) { slot = candidate; break; }
    }
    slots.set(entry.name, slot);
    taken.add(slot);
  }
  return slots;
}

/** @returns {{ok: true, entries: {name: string, home: string, slot?: number}[]} | {ok: false, reason: string}} */
export function parseRegistry(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'registry is not valid JSON' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'registry is not an object' };
  }
  if (body.v !== REGISTRY_VERSION) return { ok: false, reason: 'unsupported registry version' };
  if (!Array.isArray(body.profiles)) return { ok: false, reason: 'profiles is not an array' };
  if (body.profiles.length > MAX_PROFILES) return { ok: false, reason: 'too many profiles' };
  const entries = [];
  const names = new Set();
  for (const raw of body.profiles) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: 'profile entry is not an object' };
    }
    if (Object.keys(raw).some((key) => key !== 'name' && key !== 'home' && key !== 'slot')) {
      return { ok: false, reason: 'profile entry carries an unknown field' };
    }
    if (typeof raw.name !== 'string' || !PROFILE_NAME.test(raw.name)) {
      return { ok: false, reason: 'profile name is not a valid label' };
    }
    if (names.has(raw.name)) return { ok: false, reason: 'duplicate profile name' };
    names.add(raw.name);
    if (typeof raw.home !== 'string' || !path.isAbsolute(raw.home) || raw.home.includes('\0')) {
      return { ok: false, reason: 'profile home must be an absolute path' };
    }
    const entry = { name: raw.name, home: path.normalize(raw.home) };
    if (raw.slot !== undefined) {
      if (!Number.isInteger(raw.slot) || raw.slot < 0 || raw.slot >= PROFILE_PALETTE_SIZE) {
        return { ok: false, reason: 'profile slot is outside the palette' };
      }
      entry.slot = raw.slot;
    }
    entries.push(entry);
  }
  return { ok: true, entries };
}

function readRegistry(registryPath) {
  let info;
  try {
    info = fs.statSync(registryPath);
  } catch {
    return { ok: false, reason: 'registry file is missing' };
  }
  if (!info.isFile()) return { ok: false, reason: 'registry path is not a regular file' };
  // The registry decides which tokens are trusted, so it must not be writable
  // by anyone else. Windows has no POSIX mode bits; ACLs apply there.
  if (process.platform !== 'win32' && info.mode & 0o022) {
    return { ok: false, reason: 'registry file is group/world writable (chmod 600 it)' };
  }
  if (info.size > MAX_REGISTRY_BYTES) return { ok: false, reason: 'registry file is too large' };
  return parseRegistry(fs.readFileSync(registryPath, 'utf8'));
}

function digestOf(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * Read the registry and every profile's token.
 *
 * A profile whose token is missing, weak, loosely permissioned, shared with
 * another profile, or equal to a reserved secret is left out and reported in
 * `problems`; the others still load. Sharing a token would make attribution
 * ambiguous, so *every* holder of a shared token is excluded.
 */
export function loadProfiles({ registryPath, loadToken, reservedSecrets = [] }) {
  const registry = readRegistry(registryPath);
  if (!registry.ok) return { ok: false, reason: registry.reason, profiles: [], problems: [] };
  const slots = allocateSlots(registry.entries);
  const reserved = reservedSecrets.map(digestOf);
  const candidates = [];
  const problems = [];
  for (const entry of registry.entries) {
    let token;
    try {
      token = loadToken(profileTokenPath(entry.home));
    } catch (error) {
      problems.push({ name: entry.name, reason: error instanceof Error ? error.message : 'token could not be loaded' });
      continue;
    }
    const digest = digestOf(token);
    if (reserved.some((other) => crypto.timingSafeEqual(other, digest))) {
      problems.push({ name: entry.name, reason: 'token equals a reserved server secret' });
      continue;
    }
    candidates.push({ ...entry, slot: slots.get(entry.name), token, digest });
  }
  const counts = new Map();
  for (const candidate of candidates) {
    const id = candidate.digest.toString('hex');
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const profiles = [];
  for (const candidate of candidates) {
    if (counts.get(candidate.digest.toString('hex')) > 1) {
      problems.push({ name: candidate.name, reason: 'token is shared with another profile; give each profile its own' });
      continue;
    }
    profiles.push(candidate);
  }
  return { ok: true, profiles, problems };
}

/**
 * Live view of the registry: constant-time token lookup, rate-limited reload,
 * and the keepers each profile's scheduler should stand up.
 */
export function createProfileDirectory({
  registryPath, loadToken, reservedSecrets = [], reloadIntervalMs = 1000, now = Date.now,
}) {
  let profiles = [];
  let problems = [];
  let lastReloadAt = 0;
  let registryProblem = null;

  function load() {
    const loaded = loadProfiles({ registryPath, loadToken, reservedSecrets });
    lastReloadAt = now();
    if (!loaded.ok) {
      // Keep serving the last good set: a half-written registry must not
      // silently lock every profile out. The reason surfaces in `status()`.
      registryProblem = loaded.reason;
      return { changed: false, added: [] };
    }
    registryProblem = null;
    const signature = (profile) => `${profile.name}:${profile.slot}:${profile.digest.toString('hex')}`;
    const before = new Set(profiles.map(signature));
    const added = loaded.profiles.filter((profile) => !before.has(signature(profile)));
    const after = new Set(loaded.profiles.map(signature));
    const changed = added.length > 0 || [...before].some((entry) => !after.has(entry));
    profiles = loaded.profiles;
    problems = loaded.problems;
    return { changed, added };
  }

  const initial = load();

  return {
    /** Profiles present at construction, for boot-time seeding. */
    initialProfiles: initial.added,
    /** Every loaded profile, without its token. */
    list() {
      return profiles.map(({ name, home, slot }) => ({ name, home, slot }));
    },
    problems() {
      return problems.map((problem) => ({ ...problem }));
    },
    registryProblem() {
      return registryProblem;
    },
    /**
     * Resolve a presented bearer secret to `{name, slot}`, or `null`.
     * Every profile is compared, with no early exit, so timing does not reveal
     * which entry matched or how many exist.
     */
    authenticate(provided) {
      const presented = digestOf(provided);
      let match = null;
      for (const profile of profiles) {
        if (crypto.timingSafeEqual(presented, profile.digest) && match === null) {
          match = { name: profile.name, slot: profile.slot };
        }
      }
      return match;
    },
    /** Re-read the registry and tokens. `force` skips the rate limit. */
    refresh({ force = false } = {}) {
      if (!force && now() - lastReloadAt < reloadIntervalMs) return { changed: false, added: [] };
      return load();
    },
    /** `{key, profile, paletteSlot}` keepers for the given profiles' enabled cron jobs. */
    cronSeeds(selected = profiles) {
      const seeds = [];
      const notes = [];
      for (const profile of selected) {
        const jobs = readEnabledJobIds(profileJobsPath(profile.home));
        if (!jobs.ok || jobs.absent) {
          notes.push({ name: profile.name, keepers: 0, reason: jobs.ok ? 'no jobs file' : `jobs file unreadable (${jobs.reason})` });
          continue;
        }
        const keepers = cronSeedEntries(profile.token, jobs.ids);
        for (const keeper of keepers) {
          seeds.push({ key: keeper.key, profile: profile.name, paletteSlot: profile.slot });
        }
        notes.push({ name: profile.name, keepers: keepers.length, reason: null });
      }
      return { seeds, notes };
    },
    /** Profiles as the loader holds them, tokens included. Server-internal. */
    current() {
      return profiles;
    },
  };
}
