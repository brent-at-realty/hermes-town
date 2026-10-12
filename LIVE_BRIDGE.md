# Live Hermes bridge

Hermes Town turns lifecycle metadata from a running Hermes process into residents and movement without reading the content of the work.

## Architecture

```text
Hermes process
  │ documented native plugin hooks
  │ validate, HMAC-pseudonymize, enqueue
  ▼
integrations/hermes-town-plugin
  │ bounded batches over authenticated loopback HTTP
  ▼
server/
  │ strict ingress schema, durable bounded journal
  ├─ GET /api/town/snapshot
  ├─ GET /api/town/events
  ├─ GET /api/town/health
  └─ static dist/
  ▼
src/live/liveSource.ts
  │ snapshot, SSE, incremental polling fallback
  ▼
src/sim/town.ts → src/scenes/TownScene.ts
```

## Trust boundaries

- Hermes runs the native plugin in-process. The callbacks receive normal Hermes hook payloads, but the plugin reads only a small allowlist.
- The plugin sends events only to loopback HTTP or HTTPS. It bypasses environment proxies.
- The ingest route is the only event writer and requires a bearer token. Managed process shutdown uses a separate authenticated management route.
- Snapshot, SSE, and health routes are read-only and unauthenticated. Keep the server bound to loopback.
- The browser receives no Hermes credential and never connects to a Hermes API, gateway, transcript, session database, or JSONL file.

## Wire contract

The plugin can publish only:

- `id`: random event identifier used for de-duplication
- `key`: `h/<main|child|cron>/<16 hex>`, derived from a raw execution-context identifier (or a cron job id) with HMAC-SHA256
- `kind`: `spawned`, `assigned`, `tool_started`, `waiting`, `completed`, `failed`, or `departed`
- `role`: `coordinator`, `research`, `fabrication`, `review`, `tooling`, `general`, or `scheduled`
- `tool`: a value matching `^[A-Za-z0-9_.:-]{1,64}$`, otherwise `tool`
- `outcome`: `ok`, `error`, `interrupted`, or `cancelled`
- `detail`: a skill name on `tool_started`, same pattern as `tool`, only when `HERMES_TOWN_SKILL_NAMES=1` opts in

The server rejects an entire request if an event contains any unknown field. It does not strip an unexpected field and continue.

The following data has no field in the contract:

- prompts and user messages
- conversation history
- child goals and summaries
- tool arguments and terminal commands
- paths and filenames
- tool output and assistant responses
- raw error messages
- raw Hermes session, task, turn, tool-call, subagent, user, or chat identifiers
- credentials

The raw execution-context identifier is used only as HMAC input and is then discarded. Public display names are derived from the role and the last four characters of the pseudonymous key.

## Plugin behavior

The plugin registers ten passive hooks:

| Hook | Town effect |
|---|---|
| `on_session_start` | creates the main resident if needed |
| `pre_llm_call` | assigns the resident |
| `post_llm_call` | records a waiting state without claiming task success |
| `pre_tool_call` | sends the resident to the tool's work place |
| `post_tool_call` | records waiting or a bounded failure state |
| `subagent_start` | creates a child resident with a closed role mapping |
| `subagent_stop` | classifies the child outcome and sends it home |
| `on_session_end` | classifies and retires a main resident |
| `on_session_finalize` | retires a main resident when applicable |
| `on_session_reset` | retires the previous main resident |

A delegated child runs the same generic session hooks as its parent. Namespace resolution therefore checks the child namespace first and uses Hermes' `parent_session_id` stamp before falling back to a main resident. This prevents a child from creating a second coordinator resident.

Only `subagent_stop` carries the parent's final child status. A child's own session ending is deferred rather than published as an optimistic completion. If the parent status never arrives, the child remains visible instead of receiving an invented outcome.

Every hook validates, pseudonymizes, and calls `queue.put_nowait`. Network delivery happens on one daemon worker.

| Limit | Value |
|---|---|
| Queue | 512 events, newest dropped on overflow |
| Batch | up to 24 events |
| Request body | at most 8 KiB |
| HTTP timeout | 0.5 seconds |
| Retry | none |
| Dependencies | Python standard library only |

## Server behavior

- Node standard library only.
- 8 KiB request cap enforced while streaming.
- Up to 32 events accepted per request.
- 256 residents and 48 recent events per resident retained.
- 8,192 ingress event IDs retained for de-duplication.
- Server-owned cursor, per-resident sequence, and monotonic epoch clock.
- Bounded JSONL journal compacted atomically.
- Snapshot catch-up after a disconnect.
- SSE replay using `Last-Event-ID`.
- Incremental snapshot polling when a proxy accepts but buffers SSE frames.
- Explicit disconnected state with no fallback to demo residents.
- Security headers including CSP `connect-src 'self'`, no CORS headers, and `X-Frame-Options: DENY`.

The public v1 contract retains a role-derived `district` field for compatibility with the earlier renderer. The current 2D client ignores that field and maps tool names to places locally in `src/sim/toolMap.ts`.

## Run modes

| URL | Source |
|---|---|
| `/` | live snapshot and SSE |
| `/?agents=demo` | scripted browser demo |
| `/?agents=demo&hour=17` | scripted demo with fixed time of day |

A disconnected live page stays empty and says `disconnected`. It never substitutes demo residents.

## What a fresh client sees

A full snapshot describes the town as it is now, not the journal's history.
The server leaves out residents that have departed and residents nothing has
been heard from for fifteen minutes (`LIMITS.staleSeconds`); their journal
entries stay retained for the stream and for incremental catch-up. The
snapshot reports how many it left out as `omitted: { departed, stale }`, and
the town's status line shows that count as past sessions not shown. Residents
that are in the snapshot appear where they are, without walking in from the
gate.

In the browser, a resident with no event for ten minutes walks home on its
own and sits on its porch for half an hour before it is forgotten. A new event
for that session wakes it up. Nothing here claims Hermes ended the session; it
is only what the town shows when the stream goes quiet.

## Scheduled runs and skill names

A Hermes cron run names its session `cron_<job id>_<timestamp>`. The plugin
keys such a run on the job id alone, in its own `h/cron/…` namespace, so every
run of one job is the same resident: a keeper with the `scheduled` role. The
town gives each keeper a post beside a lamp in the square. Between runs it
stands there on watch; when the job fires it thinks at the hall, sends its
runners out, pins the result and walks back to its post. A finished run is not
a departure, and an unseeded keeper is only dropped from a fresh snapshot after
a day of silence. The job id and timestamp are HMAC input only and never leave
the process; the keeper's name is `Keeper` plus four pseudonym characters.

Because the keeper key is deterministic (HMAC of the job id under a key
derived from the bridge token), the server can compute it itself and stand the
keepers up at boot, before any job fires. At startup it reads `$HERMES_HOME/
cron/jobs.json` (override with `--cron-jobs`, disable with `--no-cron-seeds`),
takes only each entry's `id` and `enabled` flag, and seeds one keeper per
enabled job. The jobs file also carries prompts, names, models, and workdirs;
none of those are ever read, and nothing but derived keys reaches a public
surface. A seeded keeper never ages out: the job is configured, so silence is
not staleness. When the job later fires, the plugin's event carries the same
key, lands on the seeded resident, and normal run choreography takes over;
there is no second resident and no rename. More enabled jobs than lamps is
fine: keepers share the least-crowded post.

Skill names are an opt-in. With `HERMES_TOWN_SKILL_NAMES=1` in the Hermes
process environment, a `skill_view` or `skill_manage` call publishes the
skill it names as the event's `detail` (`^[A-Za-z0-9_.:-]{1,64}$`, no `..`).
No other tool's arguments are ever read, with the flag on or off. The town
gives each skill its own market stall, labelled with the skill's name, and a
skill call sends a runner to that stall. Without the flag, skill calls are
plain market visits.

## Shared Town: one server, every local profile

`serve-live.mjs --profiles PATH` (or `hermes town start --shared`) replaces the single bridge token with a registry of local Hermes profiles. It is the multi-profile alternative to one server and port per profile. The plugin and the ingress wire contract are unchanged.

```text
profile A ── plugin ── token A ─┐
profile B ── plugin ── token B ─┼─▶ one server ── public.v1 + profile label ──▶ browser
profile C ── plugin ── token C ─┘   (loopback)
```

Registry (`hermes-town.profiles.v1`, owner-only, not group/world writable):

```json
{ "v": "hermes-town.profiles.v1",
  "profiles": [ { "name": "default", "home": "/home/u/.hermes" },
                { "name": "work", "home": "/home/u/.hermes/profiles/work", "slot": 3 } ] }
```

Only `name`, `home` and an optional `slot` are read, and an entry with any other field invalidates the registry. A profile's token is always `<home>/hermes-town/runtime/bridge-token` (the file the single-profile plugin already uses) and its scheduler jobs file is `<home>/cron/jobs.json`; neither path is configurable per entry. At most 64 profiles.

**Identity.** The profile is whatever the presented token authenticates, resolved by a constant-time comparison against every profile. The server attaches it after the strict ingress schema has run, so an ingress body that carries `profile` (or `paletteSlot`) is a schema error like any other unknown field. A token held by two profiles authenticates neither; a token that is weak, loosely permissioned, missing, or equal to the management secret leaves that profile out and the others still load. Because each profile's resident keys are HMACs under its own token, the same raw session id in two profiles is two different residents.

**Isolation.**

- A resident belongs to the profile that spawned it. An event for its key under another profile's token is skipped and counted (`foreignKeys`), not published. A resident with no profile (an earlier single-profile journal) is adopted by the first profile that speaks for it.
- Ingress ids are de-duplicated per profile (`<profile>/<id>`), so replaying another profile's id neither suppresses nor duplicates its events.
- The management route authenticates only with the management secret; no profile token can read it.

**Public contract additions** (`hermes-town.public.v1`, `agent.spawned` only, plus `recent` porch entries):

| Field | Value |
|---|---|
| `profile` | `^[a-z0-9][a-z0-9_-]{0,63}$`: the Hermes profile directory name, an operator-chosen label |
| `paletteSlot` | integer `0..11`: the clothing colour the server assigned that profile |

The label is configuration, not Hermes runtime data: it is never derived from a prompt, path, session, or message, and the registry's home paths never leave the server. It is visible to anyone who can read the snapshot, which stays loopback-only. Health reports only `shared: { profiles: <count> }`; per-profile delivery counts are on the authenticated management route.

**Colours.** Slots are allocated in registry order: explicit `slot` values first, then each profile at the slot its name hashes to (FNV-1a modulo twelve), moved forward to the next free slot. The result depends only on the registry's contents and order, so it is stable across restarts, appending a profile never recolours another, and up to twelve profiles are distinct. Beyond twelve, slots repeat. The browser maps a slot to one of twelve clothing colours (`src/art/profileColors.ts`), tested for a minimum perceptual distance; a resident with a profile but no usable slot falls back to the slot its name hashes to. Runners inherit their session's colour. Residents with no profile (single-profile mode, demo) keep the role-based look.

**Live changes.** The server re-reads the registry and tokens every few seconds and when an unknown token presents itself (rate limited). A newly registered profile is accepted and its cron keepers stand up without a restart; a removed or re-tokened profile stops authenticating. A registry that fails to parse keeps the last good set rather than locking every profile out.

**Cron keepers.** Each profile's enabled job ids seed keepers with that profile's own token, so a keeper carries the right label and the plugin's later events land on it.

## Packaged launcher (v0.3.0)

The catalog package now contains `runtime/server/`, `runtime/dist/`, licenses, and a deterministic SHA-256 manifest. Once that release is catalog-pinned, install and enable it normally, then run `hermes town start`. No npm or build is needed by end users. See [README](README.md#connect-a-local-hermes-runtime) for setup and diagnostics. Release publication and the reviewed catalog pin update are separate steps.

`hermes town setup` validates prerequisites and creates a private profile-local token; `start` also performs setup, authenticates existing process ownership, and starts a background loopback server only when necessary. `status` separates local setup, server reachability/ownership, and first events. `stop` uses a per-process management secret, never a stale PID. `open` is opt-in browser launching. These commands neither edit Hermes configuration nor restart/enable Hermes.

Managed state lives in `$HERMES_HOME/hermes-town/runtime/`: `bridge-token`, `server.json`, `lifecycle.lock`, `town-journal.jsonl`, and bounded `server.log`/`server.log.1`. Each log is capped at 1 MiB. Code stays in the installed plugin directory and is not modified at runtime.

The launcher passes an independent random management secret through the child environment. Only managed servers expose `GET /api/town/manage` and `POST /api/town/manage/stop`; both require that secret. It is never returned by public routes or passed to the browser, and the bridge secret cannot authorize a stop. Manual servers leave these routes disabled unless explicitly configured by an operator.

Health, snapshots, SSE hello/heartbeat, and a dedicated SSE `bridge` update carry `bridge: { receivedEvents, lastEventAt }`. These counters count accepted, nonduplicate ingress events during the current boot only. Cron seeding and journal replay cannot turn "waiting" into "events received". Missing telemetry from an older server remains unknown.

## Operator runbook

The following is the advanced source-checkout/foreground path. It remains useful for external supervision and custom token/HTTPS configurations; it is not needed for a packaged install.

### 1. Install the source package

From the repository root:

```bash
npm run install:plugin
# Or choose a Hermes home explicitly:
node scripts/install-hermes-town-plugin.mjs --hermes-home /path/to/hermes-home
```

This copies the plugin files and creates a 32-byte random bridge token with mode `0600` on POSIX systems. The token value is never printed.

### 2. Validate and enable

```bash
hermes plugins doctor ~/.hermes/plugins/hermes-town --ci
hermes plugins enable hermes-town
hermes plugins list --plain --no-bundled
```

### 3. Build and start the local server

```bash
npm ci
npm run build
npm run serve:live
```

Defaults:

- server: `http://127.0.0.1:4187`
- token: `$HERMES_HOME/hermes-town/runtime/bridge-token`
- journal: `runtime/town-journal.jsonl`
- static files: `dist/`
- cron keepers: seeded from `$HERMES_HOME/cron/jobs.json`

Server flags include `--port`, `--host`, `--token-file`, `--journal`, `--static`, `--no-static`, `--heartbeat-seconds`, `--cron-jobs PATH`, `--no-cron-seeds`, and `--profiles PATH` (shared Town; mutually exclusive with `--token-file` and `--cron-jobs`; see above). The `--host` value is restricted to `127.0.0.1`, `localhost`, or `::1`.

### 4. Restart the observed Hermes process

```bash
hermes gateway restart
# Or start a new Hermes CLI session.
```

### 5. Open the town

```text
http://127.0.0.1:4187/
```

Drive a real tool call or delegated run and watch the corresponding resident activity.

### Disable and remove

```bash
hermes plugins disable hermes-town
rm -rf ~/.hermes/plugins/hermes-town
rm -f ~/.hermes/hermes-town/runtime/bridge-token
```

Disabling the plugin is sufficient to stop observation. Stopping the Town server is independent.

## Verification

```bash
npm run test:contracts
npm run build
npx playwright install chromium
npm run verify:world
hermes plugins doctor integrations/hermes-town-plugin --ci
```

`tests/verify-plugin-privacy.py` registers all ten hooks, fires each one with private sentinel values, and checks the captured queue. `tests/verify-server-contract.mjs` exercises loopback-only binding, authenticated and unauthenticated HTTP ingress, unknown-field rejection, real plugin delivery, the public snapshot, security headers, and token/path absence. `tests/verify-cron-seed.mjs` derives keeper keys in Node and Python for the same job id and proves they agree, then checks seeding behaviour against the live server. `scripts/verify-world.mjs` exercises the actual browser UI and simulation.
