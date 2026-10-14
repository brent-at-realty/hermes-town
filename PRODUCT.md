# Hermes Town Brent

## Product thesis

Hermes Town is a spatial interface for persistent AI agents. Residents, buildings, motion, and visible world changes represent real work rather than fictional NPC activity. A glance should show what the runtime is doing.

## What the viewer should understand

- Each resident is one real Hermes execution context.
- Location and animation show the current class of work.
- Thinking, waiting, completion, failure, and departure are visually distinct.
- An empty runtime produces an empty town with an explicit disconnected or waiting state.
- Demo activity is always labeled as demo activity.

## Work vocabulary

| Place | Tools and events | Animation |
|---|---|---|
| Library | Read, search, file discovery | reading at a lectern |
| Workshop | Edit, write, patch | working at a bench |
| Forge | shell, tests, package commands | hammering at an anvil |
| Post office | git and GitHub | parcel at the post box |
| Observatory | web search and browser work | telescope |
| Town hall | delegation, planning, LLM turns | desk and thinking emote |
| Tavern | completed or idle work | resting |
| Market | unrecognized tools | market stall |
| Houses | departed sessions | returns home |

## System model

```text
Hermes lifecycle hooks or scripted demo
                 ↓
        allowlisted Town events
                 ↓
      resident simulation and paths
                 ↓
          Phaser town renderer
```

## Viewer appearance

A viewer may choose how Town looks: a theme, a people kit, a compatible map, the time of day, decorative weather and motion. This is presentation only.

- A resident's place, animation, state and emote come only from allowlisted lifecycle events and the simulator, in every theme. Lighting, weather, smoke, water, cloud shadows, haze and motes are decoration and never imply work, success, failure, or a resident.
- Appearance is client-side view state, stored per browser and shareable by URL. It is not Hermes configuration, it is not sent to Hermes or to the Town server, and the browser has no control that writes a Town-wide default. A host may set a build-time default.
- Changing a visual setting never restarts the bridge or changes the event source. Changing the map rebuilds the renderer scene and re-reads the current snapshot; it never manufactures events.
- `prefers-reduced-motion` is honoured by default and can be overridden in the drawer. Reduced motion lowers decoration only; residents' own movement is part of the message and is not reduced.
- Themes, people kits and maps are typed registry entries. Nothing in a theme may load a remote or arbitrary asset.

## Non-goals

Simulated social chatter, public live hosting, an economy, multiplayer, combat, infinite terrain, or direct browser access to Hermes control surfaces.

## Next milestones

1. Publish the packaged v0.6.0 release and, where the catalog admission rules allow, submit a distinct `hermes-town-brent` catalog entry. The bundled runtime and explicit `hermes town setup/start/status/stop/open` path are implemented; publication is separate.
2. Optional Hermes Desktop page or launcher after the local server lifecycle is packaged.
3. Waiting-for-user state with an explicit, privacy-safe lifecycle signal.
4. Day history and stable session-to-home continuity across restarts.
