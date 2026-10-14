import Phaser from 'phaser';
import { TILE } from '../art/tiles';
import { cyberAnchors } from '../art/cyberCity';
import { orbitalAnchors } from '../art/orbitalSystem';
import { glow, surface, rect, rng } from '../art/artKit';
import type { TownMap } from '../world/map';
import { CYBER_W } from '../world/cyberCity';
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

export interface Ambient { objects: Phaser.GameObjects.GameObject[]; update(dt: number): void }

function ensureTexture(scene: Phaser.Scene, key: string, make: () => HTMLCanvasElement): void {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, make());
}

export function buildCyberAmbient(scene: Phaser.Scene, reduced: boolean): Ambient {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const a = cyberAnchors();
  ensureTexture(scene, 'cy-car', () => { const s = surface(22, 8); rect(s.ctx, 1, 2, 20, 5, '#e8f6ff'); rect(s.ctx, 5, 0, 11, 3, '#9fd8ff'); rect(s.ctx, 0, 4, 2, 2, '#ffd36b'); rect(s.ctx, 20, 4, 2, 2, '#ff3a5a'); rect(s.ctx, 2, 7, 18, 1, 'rgba(255,255,255,0.6)'); return s.canvas; });
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
  const lanes = [a.road.y0 + 8, a.road.y0 + 22, a.road.y0 + 36];
  const cars = Array.from({ length: 6 }, (_, i) => {
    const dir = i % 2 === 0 ? 1 : -1;
    const y = lanes[i % lanes.length]!;
    const o = scene.add.image(r() * CYBER_W * TILE, y, 'cy-car').setScale(0.5).setDepth(AMBIENT_DEPTHS.road).setAlpha(0.95).setFlipX(dir < 0)
      .setTint([0xffffff, 0xffb8e0, 0xb8e8ff, 0xffe0a0][i % 4]!);
    objects.push(o); return { o, v: dir * (26 + (i * 9) % 24) };
  });
  const drones = Array.from({ length: 4 }, (_, i) => {
    const o = scene.add.image(r() * CYBER_W * TILE, a.skyLane.y + 16 + i * 12, 'cy-drone').setScale(0.5).setDepth(AMBIENT_DEPTHS.behindCity).setAlpha(0.85);
    objects.push(o); return { o, v: (i % 2 ? 1 : -1) * (6 + i * 2), base: a.skyLane.y + 16 + i * 12, phase: i * 1.3 };
  });
  let clock = 0;
  const W = CYBER_W * TILE;
  return {
    objects,
    update(dt) {
      clock += dt;
      if (reduced) return; // static: lit signs, parked cars, hovering drones
      for (const s of signs) s.o.setAlpha(0.18 + 0.05 * Math.sin(clock * 0.9 + s.phase));
      for (const b of beacons) b.o.setAlpha(0.55 + 0.35 * Math.sin(clock * 1.6 + b.phase));
      for (const c of cars) { c.o.x += c.v * dt; if (c.v > 0 && c.o.x > W + 20) c.o.x = -20; if (c.v < 0 && c.o.x < -20) c.o.x = W + 20; }
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
