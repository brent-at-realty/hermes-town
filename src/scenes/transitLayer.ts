import Phaser from 'phaser';
import { glow, rect, surface } from '../art/artKit';
import { profileColorFor } from '../art/profileColors';
import type { Resident, TownSim } from '../sim/town';
import type { TownMap } from '../world/map';
import { riderVisible, transitPhase, type TransitConnector } from '../world/transit';

/**
 * Draws the lifts and shuttles that residents ride.
 *
 * A ride is a visual route segment for a resident that is already moving to a real workstation. This layer reads the
 * simulator and never writes to it: it creates no resident, no state, no event and no request. Each rider gets one car
 * or one craft, keyed by its resident id; while the rider is inside, its own sprite is hidden (the scene asks
 * `hidesRider`), so a resident is never in two places. Visuals come from a small pool and are returned to it when the
 * ride ends, and everything is destroyed with the scene.
 *
 * Depth: lift cars follow the rider's own depth, shuttles sit at {@link TRANSIT_DEPTH}. Both are far below every name
 * tag (150000), bubble (160000) and emote (160002), and below the weather layers.
 */
export const TRANSIT_DEPTH = 96000;
const MAX_RIDES = 16;
const PUFFS = 10;

interface RideVisual {
  rider: string | null;
  connectorId: string | null;
  body: Phaser.GameObjects.Image;
  open: Phaser.GameObjects.Image;
  passenger: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  puffs: Phaser.GameObjects.Image[];
  trail: { x: number; y: number; at: number }[];
  lastTrail: number;
  labelText: string;
}

export interface RideSnapshot {
  rider: string;
  kind: 'lift' | 'shuttle';
  x: number; y: number;
  depth: number;
  phase: 'board' | 'ride' | 'exit';
  riderHidden: boolean;
  label: string;
  reduced: boolean;
}

export function paintTransitTextures(scene: Phaser.Scene): void {
  const tex = scene.textures;
  const add = (key: string, c: HTMLCanvasElement) => { if (!tex.exists(key)) tex.addCanvas(key, c); };
  for (const open of [false, true]) {
    const s = surface(30, 50); const { ctx } = s;
    rect(ctx, 0, 0, 30, 50, '#1a2448'); rect(ctx, 0, 0, 30, 2, '#46547e'); rect(ctx, 0, 48, 30, 2, '#0a0e1e');
    rect(ctx, 2, 4, 26, 42, open ? '#fff3c8' : '#26326a');
    if (open) { rect(ctx, 3, 5, 24, 40, '#ffe39a'); rect(ctx, 3, 5, 24, 4, '#fffbe8'); rect(ctx, 3, 40, 24, 5, '#d8b46a'); }
    else { rect(ctx, 14.2, 4, 1.6, 42, '#0a0e1e'); rect(ctx, 3, 8, 10, 1, 'rgba(160,190,255,0.35)'); rect(ctx, 17, 8, 10, 1, 'rgba(160,190,255,0.35)'); }
    rect(ctx, 0, 0, 1.5, 50, '#35e6ff'); rect(ctx, 28.5, 0, 1.5, 50, '#35e6ff');
    glow(ctx, 15, 3, 9, '#35e6ff', 0.8);
    add(open ? 'transit-car-open' : 'transit-car', s.canvas);
  }
  {
    const s = surface(8, 14); const { ctx } = s;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(4, 3, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(1, 6, 6, 7);
    add('transit-passenger', s.canvas);
  }
  {
    const s = surface(30, 14); const { ctx } = s;
    glow(ctx, 3, 7, 10, '#ffb347', 0.9);
    ctx.fillStyle = '#dfe5ee'; ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(24, 4); ctx.quadraticCurveTo(30, 7, 24, 10); ctx.lineTo(6, 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8c96a8'; ctx.fillRect(6, 8.5, 18, 1.5);
    ctx.fillStyle = '#1a3a6a'; ctx.beginPath(); ctx.ellipse(19, 6.2, 4.2, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6fb4ff'; ctx.fillRect(17, 5, 3, 1);
    ctx.fillStyle = '#6a78a8'; ctx.fillRect(7, 1, 7, 3); ctx.fillRect(7, 10, 7, 3);
    ctx.fillStyle = '#ffb347'; ctx.fillRect(2, 5.5, 4, 3);
    add('transit-craft', s.canvas);
  }
  {
    const s = surface(10, 10); const { ctx } = s;
    glow(ctx, 5, 5, 5, '#ffe2a8', 1);
    add('transit-puff', s.canvas);
  }
}

function regionName(map: TownMap, id: string): string {
  if (id === 'helios') return 'Helios Station';
  if (id === 'street') return 'Street';
  const region = map.regions?.find((r) => r.id === id);
  if (region) return region.label.replace(/^.*· /, '');
  const floor = /-f(\d+)$/.exec(id);
  return floor ? `F${floor[1]}` : id;
}

export class TransitLayer {
  private readonly pool: RideVisual[] = [];
  private readonly active = new Map<string, RideVisual>();
  private clock = 0;
  private reduced = false;

  constructor(private readonly scene: Phaser.Scene, private readonly map: TownMap, private readonly sim: TownSim) {
    paintTransitTextures(scene);
  }

  setReducedMotion(reduced: boolean): void { this.reduced = reduced; }

  private make(): RideVisual {
    const s = this.scene;
    const body = s.add.image(0, 0, 'transit-car').setOrigin(0.5, 1).setScale(0.5).setVisible(false);
    const open = s.add.image(0, 0, 'transit-car-open').setOrigin(0.5, 1).setScale(0.5).setVisible(false);
    const passenger = s.add.image(0, 0, 'transit-passenger').setOrigin(0.5, 1).setScale(0.5).setVisible(false);
    const label = s.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '5px', color: '#eef8ff', backgroundColor: 'rgba(6,10,24,0.82)', padding: { x: 2, y: 1 } })
      .setOrigin(0.5, 1).setResolution(6).setVisible(false);
    const puffs: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < PUFFS; i++) puffs.push(s.add.image(0, 0, 'transit-puff').setScale(0.5).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
    return { rider: null, connectorId: null, body, open, passenger, label, puffs, trail: [], lastTrail: 0, labelText: '' };
  }

  private acquire(rider: string): RideVisual | null {
    if (this.active.size >= MAX_RIDES) return null;
    const v = this.pool.pop() ?? this.make();
    v.rider = rider; v.trail.length = 0; v.lastTrail = 0; v.labelText = '';
    this.active.set(rider, v);
    return v;
  }

  private release(v: RideVisual): void {
    if (v.rider) this.active.delete(v.rider);
    v.rider = null; v.connectorId = null;
    for (const o of [v.body, v.open, v.passenger, v.label, ...v.puffs]) o.setVisible(false);
    this.pool.push(v);
  }

  /** Whether this rider's own sprite must be hidden right now: it is inside the car or the craft. */
  hidesRider(r: Resident): boolean {
    if (!r.transit || !this.active.has(r.id)) return false;
    return !riderVisible(r.transit.elapsed, r.transit.duration);
  }

  update(dt: number): void {
    this.clock += dt;
    const net = this.map.transit;
    if (!net) return;
    const seen = new Set<string>();
    for (const r of this.sim.residents.values()) {
      const ride = r.transit;
      if (!ride) continue;
      const connector = net.byId(ride.connectorId);
      if (!connector) continue;
      let v = this.active.get(r.id);
      if (!v) v = this.acquire(r.id) ?? undefined;
      if (!v) continue;
      seen.add(r.id);
      if (connector.kind === 'lift') this.drawLift(v, r, connector); else this.drawShuttle(v, r, connector);
    }
    for (const v of [...this.active.values()]) if (v.rider && !seen.has(v.rider)) this.release(v);
  }

  private tint(v: RideVisual, r: Resident): void {
    const colour = profileColorFor(r.profile, r.profileSlot);
    v.passenger.setTint(colour ? Phaser.Display.Color.HexStringToColor(colour.cloth).color : 0xffffff);
  }

  private setLabel(v: RideVisual, text: string): void {
    if (v.labelText !== text) { v.labelText = text; v.label.setText(text); }
  }

  private drawLift(v: RideVisual, r: Resident, c: TransitConnector): void {
    const ride = r.transit!;
    const ph = transitPhase(ride.elapsed, ride.duration);
    const visual = c.visual.kind === 'lift' ? c.visual : null;
    const floorLabel = (n: number) => (n === 0 ? 'G' : `F${n}`);
    const reduced = this.reduced;
    // Reduced motion: no gliding. The car stands at the boarding floor, then at the destination floor, with a short fade between.
    const atDestination = reduced ? ph.t >= 0.5 : true;
    const y = reduced ? (atDestination ? ride.to.y : ride.from.y) : r.y;
    const x = r.x;
    const bottom = y + 9;
    const fade = reduced ? (ph.phase === 'ride' ? 0.35 + 0.65 * Math.abs(ph.t - 0.5) * 2 : 1) : 1;
    v.connectorId = c.id;
    v.body.setTexture('transit-car').setOrigin(0.5, 1).setRotation(0).setScale(0.5).setPosition(x, bottom).setDepth(bottom + 2).setAlpha(fade).setVisible(true);
    const showOpen = ph.open > 0.05;
    v.open.setTexture('transit-car-open').setOrigin(0.5, 1).clearTint().setBlendMode(Phaser.BlendModes.NORMAL).setScale(0.5)
      .setPosition(x, bottom).setDepth(bottom + 2.1).setAlpha(Math.min(1, ph.open * 1.4) * fade).setVisible(showOpen);
    const inside = !riderVisible(ride.elapsed, ride.duration);
    this.tint(v, r);
    v.passenger.setScale(0.5).setPosition(x, bottom - 4).setDepth(bottom + 2.2).setAlpha(1).setVisible(inside);
    if (visual) this.setLabel(v, reduced ? `${floorLabel(visual.floorFrom)} → ${floorLabel(visual.floorTo)}` : `${visual.floorTo > visual.floorFrom ? '▲' : '▼'} ${floorLabel(visual.floorTo)}`);
    v.label.setPosition(x, bottom - 72).setDepth(bottom + 2.3).setVisible(true);
    for (const p of v.puffs) p.setVisible(false);
  }

  private drawShuttle(v: RideVisual, r: Resident, c: TransitConnector): void {
    const ride = r.transit!;
    const ph = transitPhase(ride.elapsed, ride.duration);
    const control = c.visual.kind === 'shuttle' ? c.visual.control : { x: r.x, y: r.y };
    const reduced = this.reduced;
    const origin = ride.from, dest = ride.to;
    // heading along the authored curve (derivative of the quadratic Bezier)
    const t = ph.t;
    const dx = 2 * (1 - t) * (control.x - origin.x) + 2 * t * (dest.x - control.x);
    const dy = 2 * (1 - t) * (control.y - origin.y) + 2 * t * (dest.y - control.y);
    const angle = Math.atan2(dy, dx);
    // Reduced motion: no flight. The craft stays docked at the origin, then is docked at the destination, with a short fade between.
    const px = reduced ? (t >= 0.5 ? dest.x : origin.x) : r.x;
    const py = reduced ? (t >= 0.5 ? dest.y : origin.y) : r.y;
    const fade = reduced ? (ph.phase === 'ride' ? 0.35 + 0.65 * Math.abs(t - 0.5) * 2 : 1) : 1;
    v.connectorId = c.id;
    const lift = ph.phase === 'ride' ? 1 : 0.9;
    v.body.setTexture('transit-craft').setOrigin(0.5, 0.5).setPosition(px, py - 2).setRotation(reduced ? 0 : angle).setScale(0.5 * lift).setDepth(TRANSIT_DEPTH).setAlpha(fade).setVisible(true);
    v.open.setTexture('glow').setOrigin(0.5, 0.5).setPosition(px, py + 3).setScale(0.35).setTint(0xffe2a8).setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(TRANSIT_DEPTH - 1).setAlpha(Math.min(1, ph.open * 1.3) * fade).setVisible(ph.open > 0.05);
    const inside = !riderVisible(ride.elapsed, ride.duration);
    this.tint(v, r);
    v.passenger.setPosition(px - (reduced ? 0 : Math.cos(angle) * -2), py - 4).setDepth(TRANSIT_DEPTH + 1).setScale(0.38).setAlpha(fade).setVisible(inside);
    this.setLabel(v, `→ ${regionName(this.map, c.toRegion)}`);
    v.label.setPosition(px, py - 12).setDepth(TRANSIT_DEPTH + 2).setVisible(true);
    // a short fading trail behind the craft in flight; none under reduced motion
    for (const p of v.puffs) p.setVisible(false);
    if (!reduced && ph.phase === 'ride') {
      if (this.clock - v.lastTrail > 0.05) { v.lastTrail = this.clock; v.trail.push({ x: r.x, y: r.y, at: this.clock }); if (v.trail.length > PUFFS) v.trail.shift(); }
    } else v.trail.length = 0;
    v.trail.forEach((p, i) => {
      const age = Math.min(1, (this.clock - p.at) / 0.5);
      v.puffs[i]?.setPosition(p.x, p.y).setDepth(TRANSIT_DEPTH - 2).setAlpha(0.7 * (1 - age)).setScale(0.35 + age * 0.5).setVisible(true);
    });
  }

  /** What is on screen now, for verification. */
  snapshot(): RideSnapshot[] {
    const out: RideSnapshot[] = [];
    for (const v of this.active.values()) {
      const r = v.rider ? this.sim.residents.get(v.rider) : null;
      const ride = r?.transit;
      const c = ride ? this.map.transit?.byId(ride.connectorId) : null;
      if (!r || !ride || !c) continue;
      out.push({ rider: r.id, kind: c.kind, x: v.body.x, y: v.body.y, depth: v.body.depth, phase: transitPhase(ride.elapsed, ride.duration).phase, riderHidden: this.hidesRider(r), label: v.labelText, reduced: this.reduced });
    }
    return out;
  }

  /** Counts of live display objects, for leak checks. */
  stats(): { active: number; pooled: number; objects: number } {
    return { active: this.active.size, pooled: this.pool.length, objects: (this.active.size + this.pool.length) * (4 + PUFFS) };
  }

  destroy(): void {
    for (const v of [...this.active.values(), ...this.pool]) for (const o of [v.body, v.open, v.passenger, v.label, ...v.puffs]) o.destroy();
    this.active.clear(); this.pool.length = 0;
  }
}

