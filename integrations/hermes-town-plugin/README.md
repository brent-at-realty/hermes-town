# Hermes Town Brent native plugin

Plugin id `hermes-town-brent`. A passive lifecycle observer for [Hermes Town Brent](https://github.com/brent-at-realty/hermes-town). It renders one pseudonymous resident per Hermes execution context without reading what the agent is working on.

This v0.6.2 package includes the passive bridge, a profile-local launcher, the Node server, and a prebuilt frontend. No npm or repository checkout is needed at runtime. Requires Hermes Agent (validated baseline 0.21.2) and Node.js `^20.19.0` or `>=22.12.0`.

Once a catalog entry for `hermes-town-brent` is merged (until then, use the developer install in the repository README or a Git install of the exact commit):

```bash
hermes plugins install hermes-town-brent
hermes plugins enable hermes-town-brent
hermes town start
```

Open the printed `http://127.0.0.1:4187/` URL on the Hermes host. Start a **new Hermes CLI session**, or restart the observed gateway, then run a turn. Town never enables itself or restarts Hermes.

**Legacy `hermes-town` plugin?** Do not enable both. If the legacy plugin is enabled in the same Hermes home, this plugin logs a warning and registers nothing; it never overwrites, migrates, or deletes the legacy plugin or its state (`hermes-town/runtime/` is shared). Switch with `hermes town stop`, `hermes plugins disable hermes-town`, `hermes plugins enable hermes-town-brent`, then a new Hermes session.

## Manage your town

```bash
hermes town setup          # optional prerequisite/token check, no server start
hermes town start          # idempotent, background, loopback-only
hermes town start --open   # additionally open a browser, opt-in
hermes town status         # local prerequisites, ownership, received events
hermes town status --json
hermes town open
hermes town stop           # authenticated stop, never an arbitrary PID kill
```

Use `hermes -p NAME town ...` for a named profile. Runtime state, the token, bounded logs, journal, and private process identity stay under that profile's `hermes-town/runtime/`, outside the installed code. Windows relies on user-only profile NTFS ACLs; POSIX files use private modes. The server does not automatically start after reboot.

Multiple profiles on one host need distinct ports. Set `HERMES_TOWN_BRIDGE_URL=http://127.0.0.1:PORT/api/town/ingest` in both the Town CLI and the observed Hermes process; `--port PORT` must match. An occupied port or mismatched setting is refused. Managed mode uses its profile-local token, not an external token-file override.

### One shared Town for all profiles

To avoid one server and port per profile, run one Town that every local profile publishes into:

```bash
hermes town setup --shared      # register default + profiles/*, create each profile's own private token
hermes town start --shared      # one loopback server on the default port; no per-profile URL needed
hermes town status --shared     # per-profile token, acceptance, and event counts
hermes town profiles sync       # after creating a new profile (the server picks it up without a restart)
hermes town profiles add NAME | remove NAME | list
hermes town stop --shared
```

Each profile keeps using its own `hermes-town/runtime/bridge-token`, so the plugin is unchanged and the ingest wire contract gains no field. The server labels each resident with the profile whose token authenticated the request and colours its clothing by that profile. State lives in `<hermes root>/hermes-town-shared/runtime/` (registry `profiles.json`, journal, logs, management secret). Stop profile-local Towns first: they share the default port. See the repository README and `LIVE_BRIDGE.md` for the contract.

A remote-host loopback URL is not your laptop's loopback URL. Use a private SSH forward; do not publish the live API. Browser opening reports when no graphical session exists.

## Diagnose connection problems

- **Unknown `town` command:** this plugin version is not installed/enabled in the current profile. Install/update through Hermes and explicitly enable it.
- **Node missing or unsupported:** install a supported Node.js version on the Hermes host. No npm packages are installed at runtime.
- **Server ready, waiting for events:** open a new Hermes session or restart the gateway that should load the bridge. Check that the bridge URL and profile match. A successful browser connection does not prove plugin delivery.
- **Events received:** a real accepted ingress event reached this server run. Cron keepers and restored journal history are not counted. The age of the last event is not a claim that the plugin is still connected.
- **Port occupied / ownership unknown:** Town refuses to adopt or stop another process. Stop it through its original supervisor or select a matching unused port.
- **Invalid token/permissions:** setup fails closed and leaves unsafe existing credential files untouched. Inspect the profile's private runtime directory.

The CLI does not claim to know whether another Hermes process has loaded the plugin. It reports that as unknown.

## Packaging and updates

The `runtime/` contents belong to the reviewed Git commit. Commands never download replacement code. Maintainers run `npm run package:plugin`, commit the generated bundle with source, and require `npm run check:package` after a clean build. The SHA-256 manifest detects drift, not publisher authenticity. Catalog updates still require human review.

The source-checkout fallback `npm run install:plugin` copies this full package and creates a token, but never edits configuration, enables the plugin, or replaces catalog-managed bytes.

## Registered hooks

- `pre_llm_call`
- `post_llm_call`
- `pre_tool_call`
- `post_tool_call`
- `on_session_start`
- `on_session_end`
- `on_session_finalize`
- `on_session_reset`
- `subagent_start`
- `subagent_stop`

The plugin registers these ten passive hooks and the `hermes town` CLI command tree. It registers no tools, slash commands, middleware, or prompt context. Pre-call hooks always return `None`. Import/registration never starts the server or creates a token.

## Published fields

Each event can contain only:

- `id`: random event identifier for de-duplication
- `key`: HMAC-derived `h/<main|child|cron>/<16 hex>` resident key
- `kind`: closed lifecycle enum
- `role`: closed role enum
- `tool`: sanitized tool name on `tool_started`
- `outcome`: closed outcome enum when applicable
- `detail`: a skill name on `tool_started`, only when `HERMES_TOWN_SKILL_NAMES=1` opts in

All other callback fields are ignored. The queue is bounded to 512 events, delivery uses one daemon worker, request bodies are capped at 8 KiB, and the HTTP timeout is 0.5 seconds.

## Configuration

| Variable | Default |
|---|---|
| `HERMES_TOWN_BRIDGE_URL` | `http://127.0.0.1:4187/api/town/ingest` |
| `HERMES_TOWN_SKILL_NAMES` | unset. Set to `1` to publish the skill name a `skill_view` or `skill_manage` call asks for, so the town gives each skill its own market stall. Nothing else from tool arguments is ever read. |
| `HERMES_TOWN_BRIDGE_TOKEN_FILE` | `${HERMES_HOME:-~/.hermes}/hermes-town/runtime/bridge-token` |

Only loopback HTTP or HTTPS endpoints are accepted. The token must be a regular file with at least 128 estimated bits of entropy. On POSIX systems it must have no group or other permission bits.

## Validate

```bash
hermes plugins doctor integrations/hermes-town-plugin --ci
python3 tests/verify-plugin-privacy.py
```
