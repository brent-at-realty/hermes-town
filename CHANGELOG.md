# Changelog

All notable changes to Hermes Town are documented here.

## Unreleased

### Shared Town for every local profile

- One server can accept event streams from all local Hermes profiles. `serve-live.mjs --profiles PATH` reads a registry (`hermes-town.profiles.v1`: profile names and homes) and authenticates one bearer token per profile, each read from that profile's own `hermes-town/runtime/bridge-token`. The plugin and the ingest wire contract are unchanged.
- The server labels each resident with the profile whose token authenticated the request and publishes `profile` and `paletteSlot` on the `agent.spawned` public event (and on `recent` porch entries). The ingest schema still rejects any client-supplied `profile`. Residents are bound to the profile that spawned them: another profile's token cannot drive them, and ingress ids are namespaced per profile.
- Each profile's enabled cron jobs seed keepers with that profile's own token and label. Profiles added to, or removed from, the registry take effect on the running server within seconds; a token two profiles share authenticates neither.
- Residents wear a profile-specific clothing colour from a twelve-colour palette (`src/art/profileColors.ts`), allocated deterministically and collision-free in registry order, with a name-hash fallback for slots the server did not assign. A legend under the status line, the resident inspector, and the minimap show the profile.
- Native CLI: `hermes town setup|start|status|stop|open --shared`, and `hermes town profiles list|sync|add|remove`. The shared server keeps its state in `<hermes root>/hermes-town-shared/runtime/`. Profile-local mode is unchanged.
- Verification: `tests/verify-shared-town.mjs` (part of `test:contracts`) and `TownCLIShared` in `tests/verify-town-cli.py`.

## 0.2.0 - 2026-09-17

### Live bridge

- Cron keepers stand at their posts from server boot. The live server derives each enabled job's keeper key with the same HMAC the plugin uses, from the job ids in `$HERMES_HOME/cron/jobs.json` (only ids and enabled flags are read). When the job fires, the plugin's event lands on the seeded resident. `--cron-jobs PATH` overrides the file; `--no-cron-seeds` opts out.
- Keepers share the least-crowded lamp post when enabled jobs outnumber lamps.
- Fixed: the plugin now enables on Windows. Its token permission check is POSIX-only, as the server's already was and as the documentation said; before this the bridge stayed inert on every Windows host.

### Publishing

- The plugin manifest declares `requires_hermes: ">=0.21"`, and the repository carries a 2:1 banner for the Hermes plugin catalog card.
- The installer recognises a plugin directory installed from the Hermes catalog, leaves it on its reviewed pin, and only creates the bridge token.
- The wire contract documentation now lists the `cron` key namespace, the `scheduled` role, and the opt-in `detail` field, which the code had carried since 0.1.0.

### Verification

- The plugin delivery test waits until every enqueued event has had its delivery attempt. It used to treat an empty queue as done, which let the helper exit with the last batch still in flight and made the server contract check flaky on fast runners.
- `tests/verify-cron-seed.mjs` pins cross-language key agreement with the plugin, enabled-only seeding, no fork when the plugin's spawn arrives, idempotent reseeding, and absence of jobs-file content from public surfaces. Part of `test:contracts`.

## 0.1.0 - 2026-09-17

First tagged release: the developer preview plus everything that shipped on
`main` before the tag.

### Town

- Added the Phaser pixel-art town, the countryside around it, and the scripted demo mode.
- Redrew the world from the painted reference: image atlases with a chroma key, clean sprite edges, one bridge per street, no stray walls.
- Drew residents to the concept sheet: 20×30 frames, hats by role, walk, sit, and work cycles.

### Live bridge

- Added the passive native Hermes lifecycle bridge and the authenticated loopback ingest server with read-only snapshot, SSE stream, and bounded journal.
- A fresh client now sees the present town: departed and stale sessions are omitted from the snapshot, with counts of what was left out.
- Crew choreography: every tool call sends a runner to its building and back, the session waits at the door with "waiting for you" when a turn ends, resting sessions retire to a porch, and an earlier session is remembered for the day.
- A director camera follows the most recent resident when few are active.
- Keepers for scheduled jobs: a cron run keys to its job and stands at a lamp post between runs. Skill views open a market stall per skill when `HERMES_TOWN_SKILL_NAMES=1` opts in.
- Mapped the full Hermes tool registry, plus common Claude Code tool names, to buildings.

### Verification and publishing

- Added privacy-contract, server-contract, build, browser, and plugin-loader verification.
- CI splits into a required check (build and contracts) and an advisory world walk-through with screenshots.
- The scripted demo deploys to GitHub Pages on every push to `main`.
- Added explicit local-only deployment guidance and MIT licensing.
