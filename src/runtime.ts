import Phaser from 'phaser';
import { createDemoSource } from './live/demoSource';
import { createLiveSource } from './live/liveSource';
import type { Source } from './live/events';
import { TownScene } from './scenes/TownScene';
import { TownSim } from './sim/town';
import type { ResolvedAppearance } from './themes/resolve';
import type { MapPreset } from './themes/types';
import type { TownMap } from './world/map';

export type TownMode = 'demo' | 'live';

/**
 * One mounted Town: a map, the simulator built on it, the event source that
 * feeds the simulator, and the Phaser game that draws it.
 *
 * Appearance changes that are only visual go to {@link TownRuntime.apply} and
 * touch none of the rest. A different map needs a new simulator (its grid is
 * different), so the page remounts: the old runtime is destroyed and a new one
 * is created for the same mode. In live mode the new source re-reads the
 * server's snapshot, so the Town is rebuilt from what Hermes actually sent;
 * nothing is sent to the server and the plugin bridge is not involved.
 */
export interface TownRuntime {
  readonly mode: TownMode;
  readonly preset: MapPreset;
  readonly map: TownMap;
  readonly sim: TownSim;
  readonly source: Source;
  readonly game: Phaser.Game;
  scene(): TownScene | null;
  apply(appearance: ResolvedAppearance): void;
  destroy(): void;
}

export interface RuntimeOptions {
  mode: TownMode;
  hour: number | null;
  appearance: ResolvedAppearance;
  onSelect: (id: string | null) => void;
}

export function createTownRuntime(options: RuntimeOptions): TownRuntime {
  const preset = options.appearance.map;
  const map = preset.build();
  const sim = new TownSim(map);
  const source: Source = options.mode === 'demo' ? createDemoSource(sim) : createLiveSource(sim);
  let scene: TownScene | null = null;
  let destroyed = false;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: Math.max(640, window.innerWidth),
    height: Math.max(360, window.innerHeight),
    pixelArt: true,
    fps: { forceSetTimeOut: true, target: 60 },
    roundPixels: true,
    backgroundColor: options.appearance.ui.canvasBackground,
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
    scene: [],
  });
  const fit = (): void => {
    if (destroyed) return;
    const w = Math.max(320, window.innerWidth), h = Math.max(240, window.innerHeight);
    if (game.scale.width !== w || game.scale.height !== h) game.scale.resize(w, h);
  };
  window.addEventListener('resize', fit);
  const fitTimer = window.setInterval(fit, 1000);
  game.scene.add('town', TownScene, true, {
    map,
    view: preset.view,
    sim,
    appearance: options.appearance,
    hour: options.hour,
    onSelect: options.onSelect,
  });
  let latest = options.appearance;
  game.events.once("ready", () => { if (destroyed) return; scene = game.scene.getScene("town") as TownScene; scene.applyAppearance(latest); });
  source.start();

  return {
    mode: options.mode, preset, map, sim, source, game,
    scene: () => scene,
    apply(appearance) { latest = appearance; scene?.applyAppearance(appearance); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('resize', fit);
      window.clearInterval(fitTimer);
      source.stop();
      scene = null;
      game.destroy(true);
    },
  };
}
