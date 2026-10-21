import Phaser from 'phaser';
import { TILE } from '../art/tiles';
import { cyberAnchors, paintRoadCar } from '../art/cyberCity';
import { orbitalAnchors } from '../art/orbitalSystem';
import { glow, surface, rect, rng } from '../art/artKit';
import type { TownMap } from '../world/map';
import { CAR_SIZE, CYBER_W, ROAD } from '../world/cyberCity';
import { ORBIT_H, ORBIT_W } from '../world/orbitalSystem';

/**
 * Decorative atmosphere for the skinned worlds: neon sign glow, road traffic and drones over Cyber City; a parallax
 * starfield, nebula drift, sun bloom and dock beacons around the Orbital System.
 *
 * None of this is an agent. It has no name tags, no emotes and no profile colours; it never reads the simulator.
 * Every object sits at a negative depth (behind the towers, in front of the sky), which is far below every name tag,
 * bubble and emote, so it cannot cover lifecycle information. Under reduced motion nothing animates: the signs keep
 * their glow, the traffic is parked and the stars hold still, so a static cue remains.
 */

export const AMBIENT_DEPTHS = { sky: -12.5, behindCity: -12, road: -10.5, glow: -10 } as const;

/** One decorative road car, for verification: where it is, which lane it keeps, and which way it travels. */
export interface TrafficCar { x: number; y: number; w: number; h: number; lane: 'east' | 'west'; dir: 1 | -1; speed: number; moving: boolean }
export interface Ambient { objects: Phaser.GameObjects.GameObject[]; update(dt: number): void; traffic?(): TrafficCar[] }

function ensureTexture(scene: Phaser.Scene, key: string, make: () => HTMLCanvasElement): void {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make());
}

/** Cars per lane. Same-lane cars share one speed and are evenly spaced, so they never pass through each other. */
const CARS_PER_LANE = 4;
const LANE_SPEED = { east: 104, west: 92 } as const;

export function buildCyberAmbient(scene: Phaser.Scene, reduced: boolean): Ambient {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const a = cyberAnchors();
  ensureTexture(scene, 'cy-car', () => paintRoadCar(false));
  ensureTexture(scene, 'cy-drone', () => { const s = surface(10, 6); rect(s.ctx, 2, 2, 6, 3, '#9fb4e0'); rect(s.ctx, 0, 1, 10, 1, '#6a78a8'); rect(s.ctx, 4, 5, 2, 1, '#35e6ff'); return s.canvas; });

  const signs = a.signs.map((sg, i) => {
    const o = scene.add.rectangle(sg.x + sg.w / 2, sg.y + sg.h / 2, sg.w, sg.h, Phaser.Display.Color.HexStringToColor(sg.color).color).setBlendMode(Phaser.BlendModes.ADD).setDepth(AMBIENT_DEPTHS.glow).setAlpha(0.2);
    objects.push(o); return { o, phase: i * 1.7 };
  });
  const beacons = a.beacons.map((b, i) => {
    const o = scene.add.image(b.x, b.y, 'glow').setTint(Phaser.Display.Color.HexStringToColor(b.color).color).setScale(0.5).setBlendMode(Phaser.BlendModes.ADD).setDepth(AMBIENT_DEPTHS.glow).setAlpha(0.8);
    objects.push(o); return { o, phase: i * 0.9 };
  });
  const r = rng(321);
  const W = CYBER_W * TILE;
  // Traffic: two directional lanes either side of the dashed divider. Each car is fixed to its lane's centre line for
  // its whole life; the east lane (nearer the curb) drives east, the west lane drives west, as in Brisbane.
  const tints = [0xffffff, 0xffb8e0, 0xb8e8ff, 0xffe0a0];
  const cars = Array.from({ length: 2 * CARS_PER_LANE }, (_, i) => {
    const lane = i < CARS_PER_LANE ? 'east' as const : 'west' as const;
    const k = i % CARS_PER_LANE, dir = lane === 'east' ? 1 as const : -1 as const;
    const spacing = (W + 2 * CAR_SIZE.w) / CARS_PER_LANE;
    const x = -CAR_SIZE.w + (k + (lane === 'east' ? 0.25 : 0.7)) * spacing;
    const y = (lane === 'east' ? ROAD.eastLaneY : ROAD.westLaneY) + CAR_SIZE.h / 2;
    const o = scene.add.image(x, y, 'cy-car').setOrigin(0.5, 1).setScale(0.5).setDepth(AMBIENT_DEPTHS.road).setAlpha(0.95).setFlipX(dir < 0).setTint(tints[(i + Math.floor(r() * 4)) % tints.length]!);
    objects.push(o); return { o, lane, dir, v: dir * LANE_SPEED[lane] };
  });
  const drones = Array.from({ length: 4 }, (_, i) => {
    const o = scene.add.image(r() * CYBER_W * TILE, a.skyLane.y + 16 + i * 12, 'cy-drone').setScale(0.5).setDepth(AMBIENT_DEPTHS.behindCity).setAlpha(0.85);
    objects.push(o); return { o, v: (i % 2 ? 1 : -1) * (6 + i * 2), base: a.skyLane.y + 16 + i * 12, phase: i * 1.3 };
  });
  let clock = 0;
  const wrapLeft = -CAR_SIZE.w, wrapRight = W + CAR_SIZE.w;
  return {
    objects,
    traffic: () => cars.map((c) => ({ x: c.o.x, y: c.o.y - CAR_SIZE.h / 2, w: CAR_SIZE.w, h: CAR_SIZE.h, lane: c.lane, dir: c.dir, speed: Math.abs(c.v), moving: !reduced })),
    update(dt) {
      clock += dt;
      if (reduced) return; // static: lit signs, parked cars on their lanes, hovering drones
      for (const s of signs) s.o.setAlpha(0.18 + 0.05 * Math.sin(clock * 0.9 + s.phase));
      for (const b of beacons) b.o.setAlpha(0.55 + 0.35 * Math.sin(clock * 1.6 + b.phase));
      for (const c of cars) { c.o.x += c.v * dt; if (c.v > 0 && c.o.x > wrapRight) c.o.x = wrapLeft; if (c.v < 0 && c.o.x < wrapLeft) c.o.x = wrapRight; }
      for (const d of drones) { d.o.x += d.v * dt; d.o.y = d.base + Math.sin(clock * 0.8 + d.phase) * 3; if (d.o.x > W + 10) d.o.x = -10; if (d.o.x < -10) d.o.x = W + 10; }
    },
  };
}

export function buildOrbitAmbient(scene: Phaser.Scene, reduced: boolean): Ambient {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const a = orbitalAnchors();
  const W = ORBIT_W * TILE, H = ORBIT_H * TILE;
  const stars = (seed: number, n: number, bigShare: number) => () => {
    const s = surface(256, 256); const g = rng(seed);
    for (let i = 0; i < n; i++) { const big = g() < bigShare; s.ctx.fillStyle = `rgba(235,240,255,${0.35 + g() * 0.6})`; s.ctx.fillRect(g() * 256, g() * 256, big ? 1.6 : 0.9, big ? 1.6 : 0.9); }
    return s.canvas;
  };
  ensureTexture(scene, 'or-stars-a', stars(41, 90, 0.08));
  ensureTexture(scene, 'or-stars-b', stars(77, 60, 0.12));
  ensureTexture(scene, 'or-nebula', () => { const s = surface(300, 200); glow(s.ctx, 150, 100, 140, '#7a4aff', 0.55); glow(s.ctx, 110, 90, 90, '#2ab8d8', 0.4); return s.canvas; });
  const far = scene.add.tileSprite(0, 0, W, H, 'or-stars-a').setOrigin(0, 0).setTileScale(0.5, 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55).setDepth(AMBIENT_DEPTHS.sky);
  const near = scene.add.tileSprite(0, 0, W, H, 'or-stars-b').setOrigin(0, 0).setTileScale(0.5, 0.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7).setDepth(AMBIENT_DEPTHS.sky + 0.1);
  const nebula = scene.add.image(W * 0.62, H * 0.62, 'or-nebula').setScale(1.4).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.28).setDepth(AMBIENT_DEPTHS.sky + 0.2);
  const bloom = scene.add.image(a.sun.x, a.sun.y, 'glow').setTint(0xffb347).setScale(a.sun.r / 30).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55).setDepth(AMBIENT_DEPTHS.sky + 0.3);
  const beacons = a.docks.map((d, i) => {
    const o = scene.add.image(d.x, d.y + 2, 'glow').setTint(0xffd36b).setScale(0.55).setBlendMode(Phaser.BlendModes.ADD).setDepth(AMBIENT_DEPTHS.glow).setAlpha(0.7);
    objects.push(o); return { o, phase: i * 1.1 };
  });
  objects.push(far, near, nebula, bloom);
  let clock = 0;
  return {
    objects,
    update(dt) {
      clock += dt;
      if (reduced) return; // static stars, nebula, bloom and beacons
      far.tilePositionX += dt * 1.2; far.tilePositionY += dt * 0.4;
      near.tilePositionX += dt * 2.6; near.tilePositionY += dt * 0.9;
      nebula.setAlpha(0.24 + 0.06 * Math.sin(clock * 0.25));
      bloom.setScale(a.sun.r / 30 * (1 + 0.03 * Math.sin(clock * 0.5)));
      for (const b of beacons) b.o.setAlpha(0.5 + 0.35 * Math.sin(clock * 1.4 + b.phase));
    },
  };
}

export function buildWorldAmbient(scene: Phaser.Scene, map: TownMap, reduced: boolean): Ambient | null {
  if (map.skin === 'cyber-city') return buildCyberAmbient(scene, reduced);
  if (map.skin === 'orbital-system') return buildOrbitAmbient(scene, reduced);
  return null;
}
