# Changelog

All notable changes to Hermes Town Brent (formerly published as Hermes Town) are documented here.

## 0.6.1 - 2026-10-21

Version rationale: patch, presentation only. No wire protocol, plugin id, state layout, lifecycle or privacy change.

### Fix: Cyber City lifts sit clear of the deck and pass behind the floors

- The lift cabin was drawn with its floor in the middle of the deck artwork and sorted with its rider, so it overlapped the deck floor at every stop and was painted over the solid decks it passed. The cabin now waits in the shaft opening behind the deck, its floor on the deck's back edge (`LIFT_CAR_BASE_OFFSET`, 24 px above the centre of the vestibule tile), and the door frame, sill and rails are redrawn to match. Residents still walk the ordinary deck line (the middle row, the same row as the stations) to the vestibule tile; each landing now has a lit threshold plate with chevrons on that line.
- While travelling, the cabin, its passenger and its floor indicator are hidden by the solid deck slabs and show only in the shaft openings between decks. A new `lift-occluder` layer holds one slab per upper deck, cut from the painted city so it matches it pixel for pixel, exactly the width of the shaft and the depth of the deck: it never covers a resident, a name tag, a bubble or an emote. New named depth band `LIFT_DEPTHS` in `src/scenes/depthBands.ts` (shaft band below the slab occluders, both below every resident and far below the lifecycle band). Under reduced motion the cabin still only stands at the origin and destination floors, correctly placed and never overlapping a deck between.
- The Maker Tower's street lift landing was covered by the neon arcade and shared its tile with a market kiosk. The arcade facade now starts to the right of the lift and the six kiosks (still six market stations) are re-spaced two tiles apart, so the street threshold is free.
- Verification: `scripts/verify-cyber-lift.mjs` (part of `npm run verify:worlds`) drives a real browser through boarding, mid-ride crossing of an intermediate deck (up and down), and exit. It asserts every lift connector boards and exits on the ordinary deck walk line, that the resident walks that path before and after the ride, and, from rendered pixels with the cabin drawn and hidden, that the cabin is visible in shaft openings and absent inside solid slab regions, with failing controls (slab hidden, slab sunk beneath the cabin) proving the measurement detects overlap and a control that lifts the slab above the name tags, bubbles and emotes. `tests/verify-worlds.mjs` covers the lift geometry and depth-band ordering.

## 0.6.0 - 2026-10-14

Version rationale: minor, presentation only. No wire protocol, plugin id, state layout, lifecycle or privacy change.

### Appearance: two complete world packs, Cyber City and Orbital System

- **Complete packs.** Appearance gains one button per pack that sets the theme, its recommended people, its map and its environment together. The People, Map and Environment controls stay independent afterwards, and Classic, Night Market, Town, Greenwood and the three older people kits are unchanged. The map still waits for Apply, which reloads the renderer scene without touching Hermes, the bridge or any resident.
- **Cyber City.** A neon cutaway district of four towers (Archive, Maker, Operations, Residential) over a street with an arcade. Every existing place has stations on a real tower floor; lifts join the floors. People: `Neon operatives`.
- **Orbital System.** A bounded diorama: Helios Station, Mercury Lab, Forge Moon, Relay Garden and a sun, in empty space. Residents walk only on the bodies and the station; shuttles join the bodies. People: `Orbital crew`. Weather options read `Clear orbit`, `Nebula haze` and `Solar-particle field`; the stored values stay clear, mist and rain, so links and saved views keep working.
- **Typed transit.** A `TransitConnector` (`lift` or `shuttle`) is a route segment for a resident who is already walking to a real mapped station. The route is walk, ride, walk. It never creates activity, never becomes a station, never changes a resident's lifecycle state, and is not part of the wire contract or persisted. Maps without connectors keep the original A* walking unchanged. Rides are drawn by a pooled layer beneath every name tag, bubble and emote; under reduced motion the car stands at the floor or the craft at the dock with a text cue.
- **Depth bands.** `src/scenes/depthBands.ts` names the scene's depth bands: world (y-sorted), transport, effects, building signs, lifecycle. Every decorative layer, including the night multiply, cloud shadow, colour grade, wash, haze, motes, fog, rain or solar particles, work sparks, ambient world effects and the lift and shuttle visuals, now draws below building signs, name tags, bubbles and emotes. Earlier builds drew the night, cloud, grade and haze layers above them (depth 197500 to 200000), which the Cyber City and Orbital System grades made visible; the Town, Greenwood and the other themes are corrected the same way. `TownScene.decorativeLayers()` lists every such layer.
- **Verification.** `tests/verify-worlds.mjs` (part of `npm run test:contracts`) covers connectors, reachability, void space, routes, validation, the simulator on lifts and shuttles, and replay. `scripts/verify-transit-worlds.mjs` (`npm run verify:worlds`, part of `npm test`) drives a real browser through rides, reduced motion, the solar-particle weather, pack buttons, repeated map switching and Reset. It also audits every decorative layer against the lifecycle floor and checks that no canvas, scene, texture, emitter, listener, animation-frame loop or running game accumulates across repeated switching and mid-ride remounts. `scripts/verify-worlds-rendered.mjs` (also `npm run verify:worlds`) measures rendered pixels: name tags, bubbles and emotes look the same with every decorative layer on as with them off, in both worlds at night and by day, and the same measurement fails when the layers are raised above them; the profile colour is prominent for every chromatic profile slot in Neon operatives and Orbital crew; a share link and a saved view each open both packs in a fresh page and draw the same minimap, with Reset restoring the exact Town minimap; and a live map remount in the middle of a lift or shuttle ride returns the same residents, state and history without replaying the ride or writing anything.

## 0.5.4 - 2026-10-14

Version rationale: patch release; presentation only. No wire protocol, plugin id, state layout, lifecycle or privacy change.

### Fix: rain no longer draws over name tags, bubbles or emotes

- v0.5.3 drew the rain sheets above the resident name tags, speech bubbles and emotes, so rain could cover the lifecycle state a resident shows. Rain now draws at depth 99500: still over the residents and buildings, so it reads as weather, but under building signs, name tags, bubbles and emotes (100000 and up), like fog (99000). Rain and ripple strength, fog, reduced-motion behaviour and the maps are unchanged.
- `scripts/verify-legibility.mjs` now holds this ordering as a regression contract: it checks the display depths of the rain and fog layers against a real name tag, bubble and emote, then compares rendered pixels of those indicators with and without rain falling (they must match), and runs the same measurement with the rain lifted above them to prove the check fails when the ordering is wrong. It also proves ground ripples by rendered pixels at the normal view (ripple emitter on versus off), not only by emitter configuration.

## 0.5.3 - 2026-10-14

Version rationale: patch release; presentation only. No wire protocol, plugin id, state layout, lifecycle or privacy change.

### Appearance: the choices are now bold at normal viewing scale

- **People kits read at a glance.** `Market folk` get a wide plumed hat with a tall crimson plume, a gold sash and a crimson hem band on a gold-edged coat; `Plain clothes` are bare-headed, short-haired, in a cropped jacket over linen sleeves and pale trousers. New optional kit fields (`hairStyle`, `sash`, `hemBand`, `sleeve`) are validated by the registry. Profile colour is still applied last and is the body colour in every kit; resident ids, state and history are untouched.
- **Mist is layered fog.** Three seamless, procedurally painted fog banks of different scale drift in different directions over the whole visible world, with clear gaps, below name tags, bubbles and emotes, plus a pale wash. Under reduced motion the banks hold still but stay on screen.
- **Rain is dense and coherent.** Two sheets of slanted streaks fall across the whole world, with ground ripples over the camera area and a cool wash. Under reduced motion the sheets hold still at half strength as a static cue; streaks and ripples stop falling. All decorative.
- **Greenwood is a different place.** A great lake across the south-west plus the west meadow lake, open flower meadows with painted blossoms, sparser groves, relocated orchards, glades and hedgerow, a map-specific ground colour (`MapPreset.terrain`) and minimap colours (`MapPreset.minimap`). Buildings, homes, stations, doors, porches and the entrance are unchanged (asserted), the Town map is byte-identical, and every station stays reachable.
- **Verification.** New `scripts/verify-legibility.mjs` (run by `npm run verify:appearance`) measures the canvas and minimap at a live-style viewport and the default overview. `tests/verify-themes.mjs` checks the visible lake and flower share of Greenwood's opening camera.

## 0.5.2 - 2026-10-14

Version rationale: patch release; minimap redraw fix only. No wire protocol, plugin id, state layout or lifecycle-privacy change.

### Fix: the minimap redraws from the mounted map after Apply and Reset

- The minimap was drawn only from `requestAnimationFrame`. A background or occluded tab pauses frames while the Town renderer (timer driven) keeps running, so a Greenwood Apply or a Reset left the previous map on the minimap. A timer now redraws when no frame has, a failed draw cannot end the loop, and a map reload redraws immediately. No map, renderer, resident, legend or bridge behaviour changes.
- `npm run verify:appearance` now pauses frames in demo and live, and compares the full `#minimap` PNG data (residents removed, overview camera) across Apply, Reset, a share link and a saved view: Greenwood must differ materially from Town and Reset must restore the exact Town data.

## 0.5.1 - 2026-10-14

Version rationale: patch release; Appearance bug fix only. No wire protocol, plugin id, state layout or lifecycle-privacy change.

### Appearance: people and map changes are now visible

- **People kits restyle every resident visibly.** `Market folk` get a dark plum brimmed hat with a gold band and plume and a gold-edged coat; `Plain clothes` drop hats, aprons, beards, the satchel strap and the belt and gain a linen collar and hem. New optional kit fields (`trim`, `hatColor`, `plume`, `satchel`, `belt`) are validated by the registry. Trim is edging only: the profile colour stays the body colour, so a shared Town still reads by profile. Resident ids, state, place and history are unchanged by a kit switch.
- **Greenwood is a materially different map.** Same streets, buildings, homes, stations and entrance (asserted), but a broad lake in the west meadow, denser groves, two orchards in offset rows, a hedgerow, flower glades, no parched grass, more trees and flowers inside the walls, a green map tone (`MapPreset.tone`) and a slightly wider opening view. `buildCountryside` takes an explicit style; the original Town map is byte-identical.
- The minimap now counts lily and stone water tiles as water, so a lake no longer shows holes.
- **Reset** now also rebuilds the default map when a different one is mounted.
- A map chosen in the drawer but not yet applied no longer tints the mounted scene.
- Verification: `tests/verify-themes.mjs` checks Greenwood's structure and the kit outfits; `npm run verify:appearance` checks rendered sprite sheets, controlled canvas pixels, minimap and canvas pixel change, reachability, and live rehydration of the same resident ids.

## 0.5.0 - 2026-10-14

Version rationale: pre-1.0 semver; the distributable plugin identity (manifest name, install/enable/update/remove ids, install directory, metadata key) changes from `hermes-town` to `hermes-town-brent`, which is a breaking change for anyone scripting the old id, so the minor version is bumped. No runtime behaviour, wire protocol or state layout changes.

### Hermes Town Brent identity

- Plugin id is now **`hermes-town-brent`** (`plugin.yaml`, `package.json`, developer installer target `plugins/hermes-town-brent`, install-metadata key, docs, tests). The `hermes town` command, `$HERMES_HOME/hermes-town/` and `hermes-town-shared/` state, the `hermes-town.*.v1` wire/registry versions, `HERMES_TOWN_*` environment variables and the `hermes-town.appearance` browser key are deliberately unchanged, so existing tokens and journals keep working and nothing is migrated or deleted automatically.
- Source of record is `brent-at-realty/hermes-town`. Documentation no longer links to the earlier source; provenance is stated in the README and the original copyright notice remains in `LICENSE`.
- Legacy-plugin guard (`integrations/hermes-town-plugin/legacy_guard.py`): when the legacy `hermes-town` plugin is enabled in the same Hermes home, `hermes-town-brent` logs how to switch and registers nothing, and the developer installer refuses before writing anything. An installed-but-disabled legacy plugin is reported and left untouched. Both checks are read-only.
- Tests: `tests/verify-town-cli.py` (`LegacyPluginGuard`) and `tests/verify-package.mjs` (installer legacy cases).

## 0.4.0 - 2026-10-14

### Town Appearance

- New **Appearance** drawer: theme, people kit, map, time of day, decorative weather and motion; Reset, Save as my view, Copy share link. Visual choices preview live without touching the simulator, source or bridge; a map change reloads only the renderer scene and re-reads the current snapshot.
- Typed registries in `src/themes/` (`TownTheme`, `PeopleKit`, `MapPreset`). The original look moved unchanged into the `classic` theme, which stays the default. `night-market` (HUD palette, people, colour grade, lantern motes) and a second map, `greenwood` (same buildings, different groves and countryside), ship as the first extra entries.
- Per-browser, versioned preference (`hermes-town.appearance`, `v: 1`), a canonical share-link query (`theme`, `people`, `map`, `time`, `weather`, `motion`), safe per-field fallback with an on-screen notice, and an operator build-time default (`VITE_DEFAULT_APPEARANCE`). No server endpoint or Hermes setting stores appearance.
- `prefers-reduced-motion` is honoured by default with an in-drawer override. It lowers wind, cloud drift and decorative particles and drops rain streaks; residents animate as before.
- The renderer reads one resolved appearance instead of literals: HUD and minimap palettes, label colours, tints, colour grade, haze, lamp glow, wind, clouds, fountains and motes. Prop art is a data table (`src/art/propArt.ts`) shared with map validation.
- `buildTownMap(variant)` and `buildTownLocal(seed)` take optional parameters; the defaults are the original map.
- Verification: `tests/verify-themes.mjs` (part of `test:contracts`) and `npm run verify:appearance` (Chromium, against the production build).

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
