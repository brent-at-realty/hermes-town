import Phaser from 'phaser';
import { ReferenceArt, REFERENCE_ATLASES } from '../art/reference';
import { paintTerrain } from '../art/terrain';
import { paintStructures } from '../art/structures';
import { PROP_ANCHORS, TREE_ANCHORS } from '../world/dressing';
import {
  CHARACTER_BASELINE, CHARACTER_SCALE, FRAME_COUNT, FRAME_H, FRAME_W, idleFrame, lookFor, paintCharacterSheet, paintEmote,
} from '../art/characters';
import { residentPose } from './residentAnimation';
import { hashString } from '../art/painter';
import { profileColorFor } from '../art/profileColors';
import { PROP_ART, propArtKey } from '../art/propArt';
import { T, TILE, paintGlow, paintShadow, paintSpark } from '../art/tiles';
import type { Resident, TownSim } from '../sim/town';
import type { Place } from '../sim/toolMap';
import type { Building, TownMap } from '../world/map';
import { applyPeopleKit } from '../themes/people';
import type { ResolvedAppearance } from '../themes/resolve';
import type { MapView } from '../themes/types';

const ZOOMS = [1, 1.5, 2, 3, 4, 5];

/** Channel-wise product of two 0xRRGGBB tints. */
function multiplyTint(a: number, b: number): number {
  const ch = (shift: number) => Math.round((((a >> shift) & 255) * ((b >> shift) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

interface ResidentView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  name: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  bubbleBg: Phaser.GameObjects.Rectangle;
  emote: Phaser.GameObjects.Image;
  key: string;
  striking: boolean;
}

interface BuildingView {
  building: Building;
  image: Phaser.GameObjects.Image;
  litKey: string;
  darkKey: string;
  lit: boolean;
  smoke: Phaser.GameObjects.Particles.ParticleEmitter | null;
  glowX: number;
  glowY: number;
}

export interface SceneOptions {
  map: TownMap;
  /** Overview framing for this map. */
  view: MapView;
  sim: TownSim;
  /** The fully resolved theme, kit, map and environment. The scene never looks a theme up by id. */
  appearance: ResolvedAppearance;
  /** A fixed hour from the `?hour=` debug parameter, which wins over the environment's time. */
  hour: number | null;
  onSelect: (id: string | null) => void;
}

export class TownScene extends Phaser.Scene {
  private opts!: SceneOptions;
  private app!: ResolvedAppearance;
  /** The mounted map's own tone. A map chosen in the drawer but not yet applied must not tint this scene. */
  private mapTone = 0xffffff;
  private mapW = 0;
  private mapH = 0;
  private views = new Map<string, ResidentView>();
  private buildingViews: BuildingView[] = [];
  private night!: Phaser.GameObjects.RenderTexture;
  private lampPositions: { x: number; y: number }[] = [];
  private zoomIndex = 0;
  private dragging = false;
  private dragStart = { x: 0, y: 0, sx: 0, sy: 0 };
  private dragMoved = false;
  private userMoved = false;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private selected: string | null = null;
  private following = false;
  /** Re-attach the follow camera once resident sprites have been rebuilt. */
  private refollow = false;
  /** The director picks the camera when there is little happening and nobody has touched it. */
  private director = true;
  private directorTarget: string | null = null;
  private userTouchedAt = -1e9;
  private sceneClock = 0;
  private windClock = 0;
  private swaying: { obj: Phaser.GameObjects.Image; phase: number; amount: number }[] = [];
  private clouds!: Phaser.GameObjects.RenderTexture;
  private cloudBlobs: { x: number; y: number; r: number; a: number }[] = [];
  private cloudClock = 0;
  private dayLights: { x: number; y: number; scale: number; tint: number; alpha: number }[] = [];
  /** Everything the environment profile draws: rebuilt whenever the environment changes. */
  private decor: { destroy(): void }[] = [];
  private fountains: { x: number; y: number; foot: number }[] = [];
  private terrainImages: Phaser.GameObjects.Image[] = [];
  private buildingImages: Phaser.GameObjects.Image[] = [];
  private treeImages: { img: Phaser.GameObjects.Image; variation: number }[] = [];
  private shadows: { img: Phaser.GameObjects.Image; alpha: number }[] = [];
  private sceneLabels: Phaser.GameObjects.Text[] = [];
  private hazeSerial = 0;
  private created = false;
  /** One reusable image for stamping glows into render textures. */
  private stamp!: Phaser.GameObjects.Image;
  private frameParity = 0;
  /** A label over each market stall that a skill has claimed. */
  private stallLabels = new Map<string, Phaser.GameObjects.Text>();

  constructor() { super('town'); }

  init(opts: SceneOptions): void {
    this.opts = opts;
    this.app = opts.appearance;
    this.mapTone = opts.appearance.map.tone ?? 0xffffff;
    this.mapW = opts.map.grid.w;
    this.mapH = opts.map.grid.h;
  }

  preload(): void {
    for (const [key, url] of Object.entries(REFERENCE_ATLASES)) this.load.image(`reference-${key}`, url);
  }

  create(): void {
    const { map } = this.opts;
    const tex = this.textures;
    const add = (key: string, c: HTMLCanvasElement) => tex.addCanvas(key, c);
    const art = new ReferenceArt(Object.fromEntries(Object.keys(REFERENCE_ATLASES).map(key => [key, tex.get(`reference-${key}`).getSourceImage()])) as Record<keyof typeof REFERENCE_ATLASES, HTMLImageElement>);
    add('terrain', paintTerrain(map));
    add('glow', paintGlow()); add('spark', paintSpark());
    add('shadow-tree', paintShadow(26, 10)); add('shadow-char', paintShadow(12, 5));
    for (const e of ['ok', 'fail', 'think', 'zzz', 'wait'] as const) add(`emote-${e}`, paintEmote(e));

    // Detailed sprites retain their authored feet; navigation is still in world pixels.
    // The table is data (`PROP_ART`), shared with the map validation.
    for (const s of PROP_ART) {
      const canvas = s.source === 'tree' ? art.tree(s.index)
        : s.source === 'bush' ? art.bush()
        : s.source === 'prop' ? art.prop(s.index, s.w, s.h)
        : s.source === 'furniture' ? art.furniture(s.index, s.w, s.h)
        : art.equipment(s.index, s.w, s.h);
      add(`art-${s.key}`, canvas);
    }

    this.terrainImages.push(this.add.image(0, 0, 'terrain').setOrigin(0, 0).setScale(0.5).setDepth(-11));
    add('structures', paintStructures(map, art));
    this.terrainImages.push(this.add.image(0, 0, 'structures').setOrigin(0, 0).setScale(0.5).setDepth(-2));

    // buildings
    for (const b of [...map.buildings, ...map.homes]) {
      const lit = art.building(b.kind, b.w * TILE + 6, true);
      const dark = art.building(b.kind, b.w * TILE + 6, false);
      const litKey = `b-${b.id}-lit`, darkKey = `b-${b.id}-dark`;
      add(litKey, lit); add(darkKey, dark);
      const baseY = (b.y + b.h) * TILE;
      // a soft pool of shadow under the wall, never a box
      this.shadow(this.add.image((b.x + b.w / 2) * TILE, baseY + 2, 'shadow-tree').setScale((b.w * TILE) / 22, 1.1).setDepth(-5), 0.35);
      if (b.kind === 'forge') this.dayLights.push({ x: (b.x + b.w / 2) * TILE, y: baseY + 6, scale: 1.1, tint: 0xf28b3c, alpha: 0.35 });
      else if (b.kind === 'tavern') this.dayLights.push({ x: (b.x + b.w / 2) * TILE, y: baseY + 4, scale: 0.9, tint: 0xf2c063, alpha: 0.22 });
      else if (b.kind === 'house') this.dayLights.push({ x: (b.x + b.w / 2) * TILE, y: baseY - 6, scale: 0.5, tint: 0xf6c15a, alpha: 0.12 });
      else this.dayLights.push({ x: (b.x + b.w / 2) * TILE, y: baseY - 4, scale: 0.8, tint: 0xf6c15a, alpha: 0.14 });
      const image = this.add.image(b.x * TILE - 3, baseY, darkKey).setOrigin(0, 1).setScale(0.5).setDepth(baseY - 4);
      this.buildingImages.push(image);
      let smoke: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
      // Workplace smoke follows the simulator's activity for that building (see update);
      // it is lifecycle-derived, so neither a theme nor reduced motion alters it.
      if (b.kind === 'forge' || b.kind === 'workshop' || b.kind === 'tavern') {
        const cx = (b.x + b.w) * TILE - (b.kind === 'forge' ? 8 : 11);
        const cy = baseY - lit.height / 2 + (b.kind === 'forge' ? 0 : 4);
        smoke = this.add.particles(cx, cy, 'spark', {
          speedY: { min: -14, max: -22 }, speedX: { min: -4, max: 4 }, lifespan: 2600,
          scale: { start: 1.2, end: 3.2 }, alpha: { start: 0.55, end: 0 }, tint: 0x9a9aa0,
          frequency: 260, quantity: 1, emitting: false,
        }).setDepth(baseY - 3);
      }
      this.buildingViews.push({ building: b, image, litKey, darkKey, lit: false, smoke, glowX: (b.x + b.w / 2) * TILE, glowY: baseY - 10 });
      if (b.kind !== 'house') {
        this.sceneLabels.push(this.add.text((b.x + b.w / 2) * TILE, baseY + 3, b.label, { fontFamily: 'monospace', fontSize: '6px', color: this.app.ui.scene.label, backgroundColor: this.app.ui.scene.labelBackground, padding: { x: 2, y: 1 } })
          .setOrigin(0.5, 0).setResolution(6).setDepth(100000).setAlpha(0.9));
      }
    }

    // Every visible environment prop comes from the same atlas family.
    // The map catalog removes unsupported props before collision construction.
    for (const placed of map.props) {
      const key = `art-${propArtKey(placed.kind, placed.variant ?? 0)}`;
      const src = tex.get(key).getSourceImage();
      const h = src.height / 2, w = src.width / 2;
      const [oldW, oldH] = placed.kind === 'tree' ? TREE_ANCHORS[(placed.variant ?? 0) % 6]! : PROP_ANCHORS[placed.kind]!;
      const x = placed.x + oldW / 2, foot = placed.y + oldH;
      const img = this.add.image(x, foot, key).setOrigin(0.5, 1).setScale(0.5).setDepth(foot - (placed.kind === 'tree' ? 6 : 2));
      const variation = hashString(`${placed.x},${placed.y}`);
      if (placed.kind === 'tree') {
        img.setFlipX(variation % 3 === 0);
        this.treeImages.push({ img, variation });
        this.swaying.push({ obj: img, phase: variation % 100 / 100, amount: 0.008 });
        this.shadow(this.add.image(x - 5, foot - 4, 'shadow-tree').setScale(w / 23, 1.5).setDepth(-4), 0.65);
      } else if (placed.kind === 'bush' || placed.kind === 'hedge' || placed.kind === 'banner') {
        this.swaying.push({ obj: img, phase: variation % 100 / 100, amount: placed.kind === 'banner' ? 0.025 : 0.015 });
      }
      if (placed.kind === 'lamp') {
        this.lampPositions.push({ x, y: foot - h + 8 });
        this.dayLights.push({ x, y: foot, scale: 0.85, tint: 0xf2c063, alpha: 0.3 });
      }
      if (placed.kind === 'fountain') this.fountains.push({ x, y: foot - h * 0.33, foot });
      if (placed.kind === 'fountain' || placed.kind === 'chapel' || placed.kind === 'cart' || placed.kind.startsWith('marketStall')) {
        this.shadow(this.add.image(x, foot - 2, 'shadow-tree').setScale(w / 22, 0.9).setDepth(-3), 0.3);
      }
    }

    // One complete bridge per crossing, instead of tiled plank ladders.
    const bridgeTiles = new Set<number>();
    const MW = this.mapW, MH = this.mapH;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (map.ground[y]![x] !== T.bridge || bridgeTiles.has(y * MW + x)) continue;
      const pending = [{ x, y }];
      let left = x, right = x, top = y, bottom = y;
      bridgeTiles.add(y * MW + x);
      for (let i = 0; i < pending.length; i++) {
        const cell = pending[i]!;
        left = Math.min(left, cell.x); right = Math.max(right, cell.x);
        top = Math.min(top, cell.y); bottom = Math.max(bottom, cell.y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cell.x + dx!, ny = cell.y + dy!, key = ny * MW + nx;
          if (map.ground[ny]?.[nx] !== T.bridge || bridgeTiles.has(key)) continue;
          bridgeTiles.add(key); pending.push({ x: nx, y: ny });
        }
      }
      this.add.image((left - 0.65) * TILE, (top - 0.45) * TILE, 'art-bridge').setOrigin(0, 0)
        .setDisplaySize((right - left + 2.3) * TILE, (bottom - top + 1.8) * TILE).setDepth(-1);
    }

    this.sparks = this.add.particles(0, 0, 'spark', {
      speed: { min: 20, max: 50 }, angle: { min: 200, max: 340 }, gravityY: 120, lifespan: { min: 250, max: 500 },
      scale: { start: 0.8, end: 0.2 }, tint: [0xffd36b, 0xf28b3c, 0xffffff], emitting: false, quantity: 3,
    }).setDepth(99999);

    this.stamp = this.make.image({ key: 'glow', add: false });
    this.night = this.add.renderTexture(0, 0, MW * TILE, MH * TILE).setOrigin(0, 0).setDepth(200000);
    this.night.setBlendMode(Phaser.BlendModes.MULTIPLY);
    // cloud shadows: broad soft patches drifting with the wind
    this.clouds = this.add.renderTexture(0, 0, MW * TILE, MH * TILE).setOrigin(0, 0).setDepth(199000);
    this.clouds.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.buildDecor();
    this.paintTheme();

    // camera
    const cam = this.cameras.main;
    cam.setBounds(0, 0, MW * TILE, MH * TILE);
    cam.setBackgroundColor(this.app.ui.canvasBackground);
    cam.setZoom(ZOOMS[this.zoomIndex]!);
    cam.setRoundPixels(true);
    this.scale.on('resize', () => this.recenter());
    this.recenter();
    for (const key of Object.keys(REFERENCE_ATLASES)) tex.remove(`reference-${key}`);
    this.created = true;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true; this.dragMoved = false;
      this.dragStart = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const dx = p.x - this.dragStart.x, dy = p.y - this.dragStart.y;
      if (Math.hypot(dx, dy) > 3) this.dragMoved = true;
      if (this.dragMoved) {
        this.userMoved = true;
        this.userTouchedAt = this.sceneClock;
        if (this.following) this.setFollow(false);
        cam.setScroll(this.dragStart.sx - dx / cam.zoom, this.dragStart.sy - dy / cam.zoom);
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.dragging = false;
      if (this.dragMoved) return;
      const w = cam.getWorldPoint(p.x, p.y);
      let best: string | null = null, bestD = 16;
      for (const r of this.opts.sim.residents.values()) {
        const d = Math.hypot(r.x - w.x, r.y - 12 - w.y);
        if (d < bestD) { bestD = d; best = r.id; }
      }
      this.select(best);
    });
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.userMoved = true;
      this.setFollow(false);
      const next = dy < 0 ? ZOOMS.find(z => z > cam.zoom + 0.01) ?? ZOOMS[ZOOMS.length - 1]! : [...ZOOMS].reverse().find(z => z < cam.zoom - 0.01) ?? ZOOMS[0]!;
      this.zoomIndex = ZOOMS.indexOf(next);
      this.tweens.killTweensOf(cam);
      this.tweens.add({ targets: cam, zoom: ZOOMS[this.zoomIndex]!, duration: 180, ease: 'Quad.easeOut' });
    });
  }

  private shadow(img: Phaser.GameObjects.Image, alpha: number): void {
    this.shadows.push({ img, alpha });
    img.setAlpha(alpha * this.app.art.shadow);
  }

  // ------------------------------------------------------------ appearance

  appearance(): ResolvedAppearance { return this.app; }

  /**
   * Apply a new look to the running scene. Presentation only: it does not
   * touch the simulator, the source, the resident list or the camera
   * (unless resident sprites have to be rebuilt, in which case follow is
   * re-attached). The map must be the one this scene was created with.
   */
  applyAppearance(next: ResolvedAppearance): void {
    const previous = this.app;
    this.app = next;
    if (!this.created) return; // create() will read the latest look when it runs
    this.cameras.main.setBackgroundColor(next.ui.canvasBackground);
    this.paintTheme();
    this.buildDecor();
    if (previous.people !== next.people || previous.ui !== next.ui) this.rebuildResidentViews(previous.people.textureTag !== next.people.textureTag);
  }

  /** Tints, shadows and label colours: everything that is a property of the static scene. */
  private paintTheme(): void {
    const { art, ui } = this.app;
    const tone = this.mapTone;
    for (const img of this.terrainImages) img.setTint(multiplyTint(art.worldTint, tone));
    for (const img of this.buildingImages) img.setTint(art.buildingTint);
    for (const t of this.treeImages) t.img.setTint(multiplyTint(art.treeTints[t.variation % art.treeTints.length]!, tone));
    for (const s of this.shadows) s.img.setAlpha(s.alpha * art.shadow);
    for (const label of this.sceneLabels) label.setColor(ui.scene.label).setBackgroundColor(ui.scene.labelBackground);
    for (const label of this.stallLabels.values()) label.setColor(ui.scene.stallLabel).setBackgroundColor(ui.scene.labelBackground);
  }

  private rebuildResidentViews(dropSheets: boolean): void {
    this.refollow = this.following;
    for (const v of this.views.values()) { v.sprite.destroy(); v.shadow.destroy(); v.name.destroy(); v.bubble.destroy(); v.bubbleBg.destroy(); v.emote.destroy(); }
    this.views.clear();
    this.cameras.main.stopFollow();
    this.directorTarget = null;
    if (dropSheets) for (const key of this.textures.getTextureKeys()) if (key.startsWith('char-')) this.textures.remove(key);
  }

  /**
   * Rebuild every decorative object the environment profile controls. These
   * are lighting, wind, water, cloud, haze and mote effects: none of them
   * reads the simulator, and none represents a resident or an event.
   */
  private buildDecor(): void {
    for (const d of this.decor) d.destroy();
    this.decor = [];
    const env = this.app.environment;
    const keep = <O extends { destroy(): void }>(o: O): O => { this.decor.push(o); return o; };
    const rate = Math.max(0.05, env.particleRate);

    for (const l of this.dayLights) {
      keep(this.add.image(l.x, l.y, 'glow').setScale(l.scale, l.scale * 0.55).setTint(l.tint).setAlpha(Math.min(1, l.alpha * env.lampGlow)).setBlendMode(Phaser.BlendModes.ADD).setDepth(-2));
    }
    // the colour grade over the whole world
    const g = env.grade;
    keep(this.add.rectangle(0, 0, this.mapW * TILE, this.mapH * TILE, g.multiplyColor, 1).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.MULTIPLY).setDepth(197500).setAlpha(g.multiplyAlpha));
    keep(this.add.rectangle(0, 0, this.mapW * TILE, this.mapH * TILE, g.addColor, 1).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD).setDepth(197501).setAlpha(g.addAlpha));

    // edge haze: the far countryside softens toward the world's edge
    const hazeKey = `haze-${this.hazeSerial++}`;
    const hz = document.createElement('canvas');
    hz.width = 256; hz.height = 256;
    const hctx = hz.getContext('2d')!;
    const [hr, hg, hb] = env.hazeColor;
    const grad = hctx.createRadialGradient(128, 128, 40, 128, 128, 150);
    grad.addColorStop(0, `rgba(${hr},${hg},${hb},0)`);
    grad.addColorStop(0.75, `rgba(${hr},${hg},${hb},0.18)`);
    grad.addColorStop(1, `rgba(${hr},${hg},${hb},0.55)`);
    hctx.fillStyle = grad; hctx.fillRect(0, 0, 256, 256);
    this.textures.addCanvas(hazeKey, hz);
    keep(this.add.image(0, 0, hazeKey).setOrigin(0, 0).setDisplaySize(this.mapW * TILE, this.mapH * TILE).setDepth(198000).setAlpha(env.hazeAlpha));
    this.decor.push({ destroy: () => { this.textures.remove(hazeKey); } });

    if (env.fountain) {
      for (const f of this.fountains) {
        keep(this.add.particles(f.x, f.y, 'spark', {
          speedX: { min: -9, max: 9 }, speedY: { min: -10, max: -4 }, gravityY: 20,
          lifespan: 600, frequency: 160 / rate, scale: { start: 0.35, end: 0.1 },
          alpha: { start: 0.7, end: 0 }, tint: [0xa9d0d1, 0xe5e9d7],
        }).setDepth(f.foot + 1));
      }
    }
    if (env.idleSmoke) {
      for (const c of this.opts.map.idleSmoke ?? []) {
        keep(this.add.particles(c.x, c.y, 'spark', {
          speedY: { min: -6, max: -10 }, speedX: { min: -2, max: 3 }, lifespan: 3200,
          scale: { start: 0.8, end: 2.4 }, alpha: { start: 0.3, end: 0 }, tint: 0xa9a9ae, frequency: 700 / rate, quantity: 1,
        }).setDepth(c.y + 200));
      }
    }

    const v = this.opts.view;
    const zone = new Phaser.Geom.Rectangle((v.centerX - v.fitW / 2) * TILE, (v.centerY - v.fitH / 2) * TILE, v.fitW * TILE, v.fitH * TILE);
    const emitZone = { type: 'random', source: zone, quantity: 1 } as Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig;
    if (env.rain) {
      keep(this.add.particles(0, 0, 'spark', {
        emitZone, speedY: { min: 150, max: 190 }, speedX: -30, lifespan: 450, frequency: 10,
        scaleX: 0.35, scaleY: 2.4, alpha: { start: 0.35, end: 0.1 }, tint: 0xbfd0e6,
      }).setDepth(198500));
    }
    if (env.motes) {
      keep(this.add.particles(0, 0, 'spark', {
        emitZone, speedX: { min: -4, max: 4 }, speedY: { min: -7, max: -2 }, lifespan: 7000,
        frequency: 7000 / env.motes.count, scale: { start: 0.5, end: 0.2 },
        alpha: { start: env.motes.alpha, end: 0 }, tint: env.motes.color, blendMode: Phaser.BlendModes.ADD,
      }).setDepth(198500));
    }

    // cloud shadows follow the profile's count; blobs are decorative texture, not weather the town reports
    while (this.cloudBlobs.length > env.cloudCount) this.cloudBlobs.pop();
    while (this.cloudBlobs.length < env.cloudCount) this.cloudBlobs.push({ x: Math.random() * this.mapW * TILE, y: Math.random() * this.mapH * TILE, r: 3.5 + Math.random() * 3, a: 0.16 + Math.random() * 0.12 });
  }

  private recenter(): void {
    if (this.userMoved) return;
    this.overview();
  }

  overview(): void {
    this.setFollow(false);
    this.select(null);
    this.userMoved = false;
    // asking for the town view is a choice: the director stands back for a while
    this.userTouchedAt = this.sceneClock;
    this.directorTarget = null;
    const cam = this.cameras.main;
    const v = this.opts.view;
    this.tweens.killTweensOf(cam);
    cam.panEffect.reset();
    cam.setZoom(Math.min(cam.width / (v.fitW * TILE), cam.height / (v.fitH * TILE)));
    cam.centerOn(v.centerX * TILE, v.centerY * TILE);
  }

  select(id: string | null): void {
    this.selected = id;
    this.opts.onSelect(id);
    if (this.following) this.setFollow(true);
  }

  selectedId(): string | null { return this.selected; }

  setDirector(on: boolean): void {
    this.director = on;
    if (!on) { this.directorTarget = null; if (!this.following) this.cameras.main.stopFollow(); }
  }

  isDirector(): boolean { return this.director; }

  /**
   * With a few residents the camera should be where the action is. The
   * director follows whoever most recently had something happen, at 3x,
   * unless the user has moved the camera in the last 45 seconds or is
   * following someone themselves.
   */
  private direct(): void {
    const sim = this.opts.sim;
    if (!this.director || this.following) return;
    if (this.sceneClock - this.userTouchedAt < 45) return;
    if (sim.active().length > 3) { if (this.directorTarget) { this.directorTarget = null; this.cameras.main.stopFollow(); } return; }
    const pick = sim.mostRecent();
    if (!pick) return;
    // a runner on the move is the story; otherwise its session
    let target = pick;
    const runners = sim.runners().filter((r) => r.parentId === pick.id || pick.parentId === r.parentId);
    const moving = runners.find((r) => r.state === 'moving' || r.state === 'returning');
    if (moving) target = moving;
    if (target.id === this.directorTarget) return;
    const v = this.views.get(target.id);
    if (!v) return;
    this.directorTarget = target.id;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    if (cam.zoom < 2.5) this.tweens.add({ targets: cam, zoom: 3, duration: 700, ease: 'Quad.easeInOut' });
    cam.startFollow(v.sprite, true, 0.04, 0.04);
  }

  setFollow(on: boolean): void {
    const cam = this.cameras.main;
    if (on) this.userMoved = true;
    this.directorTarget = null;
    this.following = on;
    cam.stopFollow();
    if (!on) return;
    const v = this.selected ? this.views.get(this.selected) : null;
    if (v) { this.tweens.killTweensOf(cam); cam.panEffect.reset(); cam.setZoom(3); cam.startFollow(v.sprite, true, 0.08, 0.08); }
  }

  isFollowing(): boolean { return this.following; }

  goTo(place: Place | string): void {
    const b = this.opts.map.buildings.find((x) => x.id === place);
    if (!b) return;
    this.userMoved = true;
    this.userTouchedAt = this.sceneClock;
    this.directorTarget = null;
    this.setFollow(false);
    this.tweens.killTweensOf(this.cameras.main);
    this.tweens.add({ targets: this.cameras.main, zoom: 2.5, duration: 500, ease: 'Quad.easeInOut' });
    this.cameras.main.pan((b.x + b.w / 2) * TILE, (b.y + b.h) * TILE + 16, 500, 'Quad.easeInOut');
  }

  centerOn(x: number, y: number): void {
    this.userMoved = true;
    this.userTouchedAt = this.sceneClock;
    this.directorTarget = null;
    this.setFollow(false);
    this.cameras.main.pan(x, y, 300, 'Quad.easeOut');
  }

  getCameraRect(): { x: number; y: number; w: number; h: number } {
    const v = this.cameras.main.worldView;
    return { x: v.x, y: v.y, w: v.width, h: v.height };
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    const { sim } = this.opts;
    sim.update(dt);
    this.sceneClock += dt;

    const seen = new Set<string>();
    const view = this.cameras.main.worldView;
    const crowd = sim.residents.size;
    const zoom = this.cameras.main.zoom;
    for (const r of sim.residents.values()) {
      seen.add(r.id);
      let v = this.views.get(r.id);
      if (!v) v = this.makeView(r);
      // off-screen residents keep simulating but cost nothing to draw
      const onScreen = r.x > view.x - 48 && r.x < view.right + 48 && r.y > view.y - 64 && r.y < view.bottom + 48;
      if (!onScreen) {
        if (v.sprite.visible) { v.sprite.setVisible(false); v.shadow.setVisible(false); v.name.setVisible(false); v.bubble.setVisible(false); v.bubbleBg.setVisible(false); v.emote.setVisible(false); }
        continue;
      }
      if (!v.sprite.visible) { v.sprite.setVisible(true); v.shadow.setVisible(true); }
      this.syncView(v, r);
      // name tags are a budget: past a crowd, or zoomed out, only the selected one keeps its tag
      v.name.setVisible(this.selected === r.id || (zoom >= 2 && crowd <= 80 && !(r.kind === 'runner' && zoom < 3)));
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.sprite.destroy(); v.shadow.destroy(); v.name.destroy(); v.bubble.destroy(); v.bubbleBg.destroy(); v.emote.destroy();
      this.views.delete(id);
      if (this.selected === id) this.select(null);
      if (this.directorTarget === id) { this.directorTarget = null; this.cameras.main.stopFollow(); }
    }
    if (this.refollow) { this.refollow = false; if (this.following && this.selected && this.views.has(this.selected)) this.setFollow(true); }
    this.direct();

    const dark = this.darkness();
    for (const bv of this.buildingViews) {
      const place = bv.building.kind as Place;
      const act = bv.building.kind === 'house' ? 0 : sim.activity.get(place) ?? 0;
      const homeUsed = bv.building.kind === 'house' && [...sim.residents.values()].some((r) => r.home === bv.building && r.state === 'resting');
      const lit = act > 0.15 || homeUsed || bv.building.kind !== 'house' || dark > 0.3 || hashString(bv.building.id) % 3 === 0;
      if (lit !== bv.lit) { bv.lit = lit; bv.image.setTexture(lit ? bv.litKey : bv.darkKey); }
      if (bv.smoke) bv.smoke.emitting = act > 0.2;
    }

    this.updateStallLabels();
    this.updateWind(dt);
    this.frameParity ^= 1;
    if (this.frameParity) this.drawClouds(dt * 2); else this.drawNight();
  }

  // ----------------------------------------------------------------- wind

  /** One coherent wave travelling across the whole world, sampled per tile. */
  private updateWind(dt: number): void {
    this.windClock += dt;
    const sway = this.app.environment.windSway;
    // trees and bushes: slow, heavy
    for (const s of this.swaying) {
      s.obj.setRotation(Math.sin(this.windClock * 1.1 + s.phase * 6.28 + s.obj.x * 0.004) * s.amount * sway);
    }
  }

  private drawClouds(dt: number): void {
    const env = this.app.environment;
    this.cloudClock += dt;
    const cam = this.cameras.main.worldView;
    this.clouds.clear();
    this.clouds.fill(0xffffff, 1, cam.x - 8, cam.y - 8, cam.width + 16, cam.height + 16);
    const d = this.darkness();
    const strength = 1 - d * 0.7;
    const W = this.mapW * TILE, H = this.mapH * TILE;
    for (const b of this.cloudBlobs) {
      b.x += dt * 5.5 * env.cloudDrift; b.y += dt * 2.2 * env.cloudDrift;
      if (b.x > W + 300) b.x = -300;
      if (b.y > H + 300) b.y = -300;
      if (b.x < cam.x - 400 || b.x > cam.right + 400 || b.y < cam.y - 400 || b.y > cam.bottom + 400) continue;
      this.stamp.setBlendMode(Phaser.BlendModes.NORMAL).setTint(0x2a3040).setPosition(b.x, b.y).setScale(b.r, b.r * 0.6).setAlpha(b.a * strength * env.cloudAlpha);
      this.clouds.draw(this.stamp);
    }
    // sunlit rises: a faint warm lift where the ground is high
    if (d < 0.5) {
      const h = this.opts.map.height;
      const step = 4;
      for (let ty = Math.max(0, Math.floor(cam.y / TILE / step) * step); ty < Math.min(this.mapH, cam.bottom / TILE + step); ty += step) {
        for (let tx = Math.max(0, Math.floor(cam.x / TILE / step) * step); tx < Math.min(this.mapW, cam.right / TILE + step); tx += step) {
          const v = h[ty * this.mapW + tx]!;
          if (v < 0.6) continue;
          this.stamp.setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe2a8).setPosition(tx * TILE + step * 8, ty * TILE + step * 8).setScale(1.6).setAlpha((v - 0.6) * 0.35 * (1 - d));
          this.clouds.draw(this.stamp);
        }
      }
    }
  }

  /** Skills own stalls: name each claimed stall, clear the ones given up. */
  private updateStallLabels(): void {
    const sim = this.opts.sim;
    const seen = new Set<string>();
    for (const [skill, stationId] of sim.stalls) {
      seen.add(stationId);
      let label = this.stallLabels.get(stationId);
      const station = this.opts.map.stations.find((s) => s.id === stationId);
      if (!station) continue;
      if (!label) {
        label = this.add.text(station.prop.x + 12, station.prop.y - 16, '', { fontFamily: 'monospace', fontSize: '6px', color: this.app.ui.scene.stallLabel, backgroundColor: this.app.ui.scene.labelBackground, padding: { x: 2, y: 1 } })
          .setOrigin(0.5, 1).setResolution(6).setDepth(100001).setAlpha(0.95);
        this.stallLabels.set(stationId, label);
      }
      if (label.text !== skill) label.setText(skill);
      label.setVisible(true);
    }
    for (const [stationId, label] of this.stallLabels) if (!seen.has(stationId)) label.setVisible(false);
  }

  // ------------------------------------------------------------ residents

  private makeView(r: Resident): ResidentView {
    // Looks are bucketed so a crowd shares sprite sheets: at most 16 per role,
    // times one per profile colour in a shared Town, times one per people kit.
    // The kit restyles the figure; the profile colour is applied last and always survives.
    const colour = profileColorFor(r.profile, r.profileSlot);
    const kit = this.app.people;
    const bucket = `${r.role}-${hashString(r.parentId ?? r.id) % 16}`;
    const key = `char-${bucket}${colour ? `-p${colour.slot}` : ''}${kit.textureTag ? `-${kit.textureTag}` : ''}`;
    if (!this.textures.exists(key)) {
      const look = applyPeopleKit(lookFor(bucket, r.role, colour?.cloth), kit, bucket, colour?.cloth);
      this.textures.addSpriteSheet(key, paintCharacterSheet(look) as unknown as HTMLImageElement, { frameWidth: FRAME_W * CHARACTER_SCALE, frameHeight: FRAME_H * CHARACTER_SCALE, endFrame: FRAME_COUNT - 1 });
    }
    const scene = this.app.ui.scene;
    const sprite = this.add.sprite(r.x, r.y, key, idleFrame('down', 0)).setOrigin(0.5, CHARACTER_BASELINE / FRAME_H).setScale((r.kind === 'runner' ? 0.8 : 1) / CHARACTER_SCALE);
    const shadow = this.add.image(r.x, r.y, 'shadow-char').setOrigin(0.5, 0.5);
    const name = this.add.text(r.x, r.y + 3, r.name, { fontFamily: 'monospace', fontSize: '5px', color: scene.name }).setOrigin(0.5, 0).setResolution(6);
    const bubble = this.add.text(r.x, r.y - 30, '', { fontFamily: 'monospace', fontSize: '6px', color: scene.bubbleText }).setOrigin(0.5, 1).setResolution(6);
    const bubbleBg = this.add.rectangle(r.x, r.y - 30, 10, 8, scene.bubbleFill).setOrigin(0.5, 1).setStrokeStyle(0.5, scene.bubbleStroke);
    const emote = this.add.image(r.x + 9, r.y - 30, 'emote-ok').setOrigin(0.5, 1).setVisible(false);
    const v: ResidentView = { sprite, shadow, name, bubble, bubbleBg, emote, key, striking: false };
    this.views.set(r.id, v);
    return v;
  }

  private syncView(v: ResidentView, r: Resident): void {
    const x = Math.round(r.x), y = Math.round(r.y + 7);
    v.sprite.setPosition(x, y).setDepth(y);
    v.shadow.setPosition(x, y - 1).setDepth(y - 1);
    v.name.setPosition(x, y + 1).setDepth(150000);
    const alpha = r.state === 'resting' ? 0.85 : r.fade;
    v.sprite.setAlpha(alpha);
    v.shadow.setAlpha(0.9 * alpha);
    v.name.setAlpha(0.9 * alpha);
    const selected = this.selected === r.id;
    const c = this.app.ui.scene;
    v.name.setColor(selected ? c.nameSelected : r.kind === 'runner' ? c.nameRunner : r.role === 'scheduled' ? c.nameScheduled : r.isChild ? c.nameChild : r.memory ? c.nameMemory : c.name);

    const pose = residentPose(r, this.opts.sim.now());
    if (Number(v.sprite.frame.name) !== pose.frame) v.sprite.setFrame(pose.frame);
    v.sprite.setFlipX(pose.flipX);
    if (pose.striking && !v.striking && r.station) this.sparks.emitParticleAt(r.station.prop.x + 8, r.station.prop.y + 2, 3);
    v.striking = pose.striking;
    const text = r.bubble && r.fade > 0.9 && r.state !== 'resting' ? r.bubble : '';
    if (v.bubble.text !== text) v.bubble.setText(text);
    const show = text.length > 0;
    v.bubble.setVisible(show); v.bubbleBg.setVisible(show);
    if (show) {
      const by = y - FRAME_H - 2;
      v.bubble.setPosition(x, by - 1).setDepth(160001);
      v.bubbleBg.setPosition(x, by).setSize(v.bubble.width + 4, v.bubble.height + 2).setDepth(160000);
    }
    if (r.emote) {
      v.emote.setTexture(`emote-${r.emote}`).setVisible(true).setPosition(x + (show ? v.bubbleBg.width / 2 + 7 : 0), y - FRAME_H - 3 - Math.sin(r.clock * 6)).setDepth(160002);
    } else {
      v.emote.setVisible(false);
    }
  }

  // ---------------------------------------------------------------- light

  darkness(): number {
    const env = this.app.environment;
    const h = this.opts.hour ?? env.hour ?? (new Date().getHours() + new Date().getMinutes() / 60);
    const t = Math.cos(((h - 13) / 24) * Math.PI * 2);
    return Phaser.Math.Clamp((0.5 - t * 0.5) * env.night.strength + env.extraDim, 0, 0.9);
  }

  private drawNight(): void {
    const d = this.darkness();
    const env = this.app.environment;
    const cam = this.cameras.main.worldView;
    this.night.clear();
    if (d < 0.05) { this.night.setVisible(false); return; }
    this.night.setVisible(true);
    const warm = Phaser.Display.Color.ValueToColor(env.night.warm);
    const cold = Phaser.Display.Color.ValueToColor(env.night.cold);
    const mix = Phaser.Display.Color.Interpolate.ColorWithColor(warm, cold, 100, Math.round(Phaser.Math.Clamp((d - 0.2) / 0.6, 0, 1) * 100));
    const base = Phaser.Display.Color.GetColor(mix.r, mix.g, mix.b);
    const bright = Phaser.Display.Color.ValueToColor(0xffffff);
    const tint = Phaser.Display.Color.Interpolate.ColorWithColor(bright, Phaser.Display.Color.ValueToColor(base), 100, Math.round(d * 100));
    this.night.fill(Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b), 1, cam.x - 8, cam.y - 8, cam.width + 16, cam.height + 16);
    const stamp = this.stamp.setBlendMode(Phaser.BlendModes.ADD).setTint(0xf2c063);
    const glow = env.lampGlow;
    const draw = (x: number, y: number, scale: number, alpha: number) => {
      if (x < cam.x - 80 || x > cam.right + 80 || y < cam.y - 80 || y > cam.bottom + 80) return;
      stamp.setPosition(x, y).setScale(scale).setAlpha(Math.min(1, alpha * glow));
      this.night.draw(stamp);
    };
    for (const l of this.lampPositions) draw(l.x, l.y, 0.9, d * 0.9);
    for (const bv of this.buildingViews) if (bv.lit) draw(bv.glowX, bv.glowY, bv.building.kind === 'house' ? 0.7 : bv.building.kind === 'tavern' || bv.building.kind === 'forge' ? 1.7 : 1.3, d * (bv.building.kind === 'tavern' || bv.building.kind === 'forge' ? 0.8 : 0.55));
    for (const r of this.opts.sim.residents.values()) if (r.anim === 'work' && r.station && r.station.prop.kind === 'anvil') draw(r.x, r.y, 0.6, d * 0.8);
  }
}
