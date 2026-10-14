import { TILE } from './tiles';
import type { Building, TownMap } from '../world/map';
import { DOCKS, FORGE_MOON, HELIOS, MERCURY, ORBIT_H, ORBIT_W, RELAY_GARDEN, SUN, type Body } from '../world/orbitalSystem';
import { glow, rect, rng, surface, vgrad } from './artKit';
import { shade } from './painter';

/**
 * Orbital System art, all procedural and local. The sky (starfield, nebula, orbit lines, the sun) and the bodies
 * (planets, moons, station, docks) are two canvases, so the animated starfield and sun bloom sit between them.
 * Nothing drawn here is an agent.
 */

const W = ORBIT_W * TILE, H = ORBIT_H * TILE;
const centre = (b: Body): { x: number; y: number; rx: number; ry: number } => ({ x: (b.x + b.w / 2) * TILE, y: (b.y + b.h / 2) * TILE, rx: (b.w / 2) * TILE, ry: (b.h / 2) * TILE });

export const SUN_CENTRE = centre(SUN);

/** World-pixel anchors for the animated layers. */
export function orbitalAnchors(): { sun: { x: number; y: number; r: number }; docks: { x: number; y: number }[]; bodies: { id: string; x: number; y: number; r: number }[] } {
  const c = (b: Body) => { const k = centre(b); return { id: b.id, x: k.x, y: k.y, r: k.rx }; };
  return {
    sun: { x: SUN_CENTRE.x, y: SUN_CENTRE.y, r: SUN_CENTRE.rx },
    docks: Object.values(DOCKS).map((d) => ({ x: d.x * TILE + TILE / 2, y: d.y * TILE + TILE / 2 })),
    bodies: [c(MERCURY), c(FORGE_MOON), c(RELAY_GARDEN)],
  };
}

export function paintOrbitalSky(map: TownMap): HTMLCanvasElement {
  const { canvas, ctx } = surface(W, H);
  rect(ctx, 0, 0, W, H, vgrad(ctx, 0, H, [[0, '#04061a'], [0.5, '#050716'], [1, '#02030a']]));
  const r = rng(9001);
  // nebula: layered soft clouds
  for (const [x, y, rad, c, a] of [[W * 0.55, H * 0.78, 360, '#5a2a8a', 0.28], [W * 0.82, H * 0.5, 300, '#1a6a8a', 0.22], [W * 0.4, H * 0.12, 280, '#8a2a5a', 0.16], [W * 0.15, H * 0.8, 260, '#2a3a9a', 0.2]] as const) glow(ctx, x, y, rad, c, a);
  // stars: many faint, a few bright with a cross flare
  for (let i = 0; i < 520; i++) {
    const a = 0.2 + r() * 0.7, big = r() < 0.05;
    ctx.fillStyle = r() < 0.2 ? `rgba(255,220,180,${a})` : r() < 0.3 ? `rgba(170,200,255,${a})` : `rgba(235,240,255,${a})`;
    const x = r() * W, y = r() * H;
    ctx.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
    if (big) { ctx.fillRect(x - 3, y + 0.5, 8, 0.6); ctx.fillRect(x + 0.7, y - 3, 0.6, 8); }
  }
  // orbit paths around the sun: faint dashed ellipses
  ctx.save(); ctx.strokeStyle = 'rgba(140,170,255,0.22)'; ctx.lineWidth = 1; ctx.setLineDash([6, 8]);
  for (const rad of [300, 520, 760, 1000]) { ctx.beginPath(); ctx.arc(SUN_CENTRE.x, SUN_CENTRE.y, rad, 0, Math.PI / 2); ctx.stroke(); }
  ctx.restore();
  // the authored shuttle routes, drawn faintly so a viewer can see how the bodies are joined
  ctx.save(); ctx.strokeStyle = 'rgba(255,200,120,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
  for (const c of map.transit?.connectors ?? []) {
    if (!c.id.endsWith('-out') || c.visual.kind !== 'shuttle') continue;
    ctx.beginPath(); ctx.moveTo(c.boarding.x * TILE + 8, c.boarding.y * TILE + 8);
    ctx.quadraticCurveTo(c.visual.control.x, c.visual.control.y, c.exit.x * TILE + 8, c.exit.y * TILE + 8); ctx.stroke();
  }
  ctx.restore();
  // the sun: corona, then a hot disk with granulation. It is a decoration at the corner of the composition.
  const s = SUN_CENTRE;
  glow(ctx, s.x, s.y, s.rx * 2.6, '#ff8a2a', 0.5);
  glow(ctx, s.x, s.y, s.rx * 1.6, '#ffc45a', 0.7);
  ctx.save(); ctx.beginPath(); ctx.arc(s.x, s.y, s.rx, 0, Math.PI * 2); ctx.clip();
  rect(ctx, s.x - s.rx, s.y - s.ry, s.rx * 2, s.ry * 2, vgrad(ctx, s.y - s.ry, s.y + s.ry, [[0, '#fff1b0'], [0.5, '#ffc84a'], [1, '#ff8a1a']]));
  for (let i = 0; i < 160; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(255,120,20,0.25)' : 'rgba(255,255,200,0.25)'; ctx.beginPath(); ctx.arc(s.x + (r() - 0.5) * s.rx * 2, s.y + (r() - 0.5) * s.rx * 2, 3 + r() * 9, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  return canvas;
}

function body(ctx: CanvasRenderingContext2D, b: Body, base: [string, string, string], seed: number, craters: boolean): void {
  const c = centre(b);
  // atmosphere / rim light on the side facing the sun (top-left)
  glow(ctx, c.x - c.rx * 0.2, c.y - c.ry * 0.2, c.rx * 1.35, base[0], 0.25);
  ctx.save(); ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createRadialGradient(c.x - c.rx * 0.4, c.y - c.ry * 0.4, c.rx * 0.1, c.x, c.y, c.rx * 1.15);
  g.addColorStop(0, base[0]); g.addColorStop(0.65, base[1]); g.addColorStop(1, base[2]);
  ctx.fillStyle = g; ctx.fillRect(c.x - c.rx, c.y - c.ry, c.rx * 2, c.ry * 2);
  const r = rng(seed);
  if (craters) for (let i = 0; i < 26; i++) {
    const x = c.x + (r() - 0.5) * c.rx * 1.8, y = c.y + (r() - 0.5) * c.ry * 1.8, rad = 4 + r() * 12;
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x, y, rad, rad * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x - 0.8, y - 0.8, rad, rad * 0.8, 0, Math.PI, Math.PI * 1.8); ctx.stroke();
  }
  // night side shading
  const shadow = ctx.createLinearGradient(c.x - c.rx, c.y - c.ry, c.x + c.rx, c.y + c.ry);
  shadow.addColorStop(0.45, 'rgba(0,0,0,0)'); shadow.addColorStop(1, 'rgba(0,0,10,0.55)');
  ctx.fillStyle = shadow; ctx.fillRect(c.x - c.rx, c.y - c.ry, c.rx * 2, c.ry * 2);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx, c.ry, 0, Math.PI * 0.95, Math.PI * 1.6); ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save(); ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(210,225,255,0.8)'; ctx.fillText(text, x, y);
  ctx.fillStyle = 'rgba(255,179,71,0.9)'; ctx.fillRect(x - ctx.measureText(text).width / 2, y + 2, ctx.measureText(text).width, 1); ctx.restore();
}

function pad(ctx: CanvasRenderingContext2D, d: { x: number; y: number }): void {
  const x = d.x * TILE + TILE / 2, y = d.y * TILE + TILE / 2;
  ctx.fillStyle = 'rgba(20,28,50,0.85)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 17, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y + 2, 17, 11, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,179,71,0.5)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 10, 6, 0, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; glow(ctx, x + Math.cos(a) * 17, y + 2 + Math.sin(a) * 11, 4, '#ffd36b', 0.8); }
}

export function paintOrbitalBodies(map: TownMap): HTMLCanvasElement {
  const { canvas, ctx } = surface(W, H);
  body(ctx, MERCURY, ['#c2b8a6', '#8a8070', '#3a342c'], 9101, true);
  body(ctx, FORGE_MOON, ['#c08a6a', '#7a4a3a', '#2a1812'], 9102, true);
  body(ctx, RELAY_GARDEN, ['#7ad8a0', '#2f8a6a', '#0f3a3a'], 9103, false);
  // Relay Garden: lawns and glasshouses over the habitat floor
  { const c = centre(RELAY_GARDEN); const r = rng(9201);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = r() < 0.5 ? 'rgba(120,230,150,0.35)' : 'rgba(60,160,110,0.4)'; ctx.beginPath(); ctx.ellipse(c.x + (r() - 0.5) * c.rx * 1.5, c.y + (r() - 0.5) * c.ry * 1.5, 6 + r() * 14, 4 + r() * 9, 0, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 14; i++) { const x = c.x + (r() - 0.5) * c.rx * 1.5, y = c.y + (r() - 0.5) * c.ry * 1.5; ctx.fillStyle = '#1f6a3a'; ctx.beginPath(); ctx.arc(x, y, 5 + r() * 3, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5adc8a'; ctx.beginPath(); ctx.arc(x - 1, y - 1.5, 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); ctx.strokeStyle = 'rgba(190,255,230,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx - 3, c.ry - 3, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
  // Forge Moon: glowing fissures where the foundry works the crust
  { const c = centre(FORGE_MOON); const r = rng(9301); ctx.save(); ctx.strokeStyle = 'rgba(255,120,40,0.55)'; ctx.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) { ctx.beginPath(); let x = c.x + (r() - 0.5) * c.rx * 1.4, y = c.y + (r() - 0.5) * c.ry * 1.4; ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 26; y += (r() - 0.5) * 26; ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.restore();
    // a thin ring around the moon, behind and in front of the surface
    ctx.save(); ctx.strokeStyle = 'rgba(220,180,150,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(c.x, c.y, c.rx * 1.2, c.ry * 0.28, -0.35, Math.PI * 0.05, Math.PI * 0.95); ctx.stroke(); ctx.restore(); }
  // Mercury Lab: the walkable plain between the domes is a little paler
  { const c = centre(MERCURY); glow(ctx, c.x, c.y + c.ry * 0.2, c.rx * 0.9, '#e6dcc4', 0.12); }
  paintStation(ctx);
  for (const d of Object.values(DOCKS)) pad(ctx, d);
  label(ctx, 'MERCURY LAB', centre(MERCURY).x, centre(MERCURY).y - centre(MERCURY).ry - 8);
  label(ctx, 'FORGE MOON', centre(FORGE_MOON).x, centre(FORGE_MOON).y - centre(FORGE_MOON).ry - 8);
  label(ctx, 'RELAY GARDEN', centre(RELAY_GARDEN).x, centre(RELAY_GARDEN).y - centre(RELAY_GARDEN).ry - 6);
  label(ctx, 'HELIOS STATION', (HELIOS.top.x + HELIOS.top.w / 2) * TILE, (HELIOS.top.y - 9) * TILE - 12);
  void map;
  return canvas;
}

function paintStation(ctx: CanvasRenderingContext2D): void {
  const r = rng(9401);
  const deckRect = (d: { x: number; y: number; w: number; h: number }, tone: string) => {
    const x = d.x * TILE, y = d.y * TILE, w = d.w * TILE, h = d.h * TILE;
    // outer hull frame, then the lit deck plating
    rect(ctx, x - 6, y - 6, w + 12, h + 12, '#1b2340'); rect(ctx, x - 6, y - 6, w + 12, 2, '#6a78a8'); rect(ctx, x - 6, y + h + 4, w + 12, 2, '#0a0e1e');
    rect(ctx, x, y, w, h, vgrad(ctx, y, y + h, [[0, shade(tone, 1.15)], [1, shade(tone, 0.8)]]));
    for (let px = x; px < x + w; px += TILE) rect(ctx, px, y, 1, h, 'rgba(150,170,220,0.12)');
    for (let py = y; py < y + h; py += TILE) rect(ctx, x, py, w, 1, 'rgba(150,170,220,0.1)');
    for (let px = x + 8; px < x + w; px += 32) { ctx.fillStyle = r() < 0.5 ? '#ffd36b' : '#6fb4ff'; ctx.fillRect(px, y - 5, 3, 2); }
  };
  // solar arrays and trusses beyond the hull, behind the decks
  for (const [x, y, w] of [[HELIOS.top.x - 3, HELIOS.top.y - 8.4, 1.6], [HELIOS.top.x + HELIOS.top.w + 1.4, HELIOS.top.y - 8.4, 1.6]] as const) {
    rect(ctx, x * TILE, y * TILE, w * TILE, 6 * TILE, '#1a2a5a');
    for (let i = 0; i < 6; i++) rect(ctx, x * TILE, (y + i) * TILE, w * TILE, 1, 'rgba(120,170,255,0.5)');
    rect(ctx, (x + w / 2) * TILE - 1, y * TILE, 2, 6 * TILE, 'rgba(255,255,255,0.18)');
  }
  rect(ctx, HELIOS.spineA.x * TILE - 6, HELIOS.spineA.y * TILE, HELIOS.spineA.w * TILE + 12, HELIOS.spineA.h * TILE, '#1b2340');
  rect(ctx, HELIOS.spineB.x * TILE - 6, HELIOS.spineB.y * TILE, HELIOS.spineB.w * TILE + 12, HELIOS.spineB.h * TILE, '#1b2340');
  deckRect(HELIOS.top, '#38466e'); deckRect(HELIOS.mid, '#323f66'); deckRect(HELIOS.low, '#2e3a5e');
  for (const d of [HELIOS.spineA, HELIOS.spineB]) {
    const x = d.x * TILE, y = d.y * TILE, w = d.w * TILE, h = d.h * TILE;
    rect(ctx, x, y, w, h, '#2a3558');
    for (let py = y; py < y + h; py += 8) rect(ctx, x, py, w, 1, 'rgba(255,255,255,0.08)');
    rect(ctx, x + w / 2 - 1, y, 2, h, 'rgba(111,180,255,0.35)');
  }
  // a comm mast over the top deck
  rect(ctx, (HELIOS.top.x + HELIOS.top.w / 2) * TILE - 1, (HELIOS.top.y - 12) * TILE, 3, 3 * TILE, '#6a78a8'); glow(ctx, (HELIOS.top.x + HELIOS.top.w / 2) * TILE + 0.5, (HELIOS.top.y - 12) * TILE, 8, '#ff4a6a', 0.9);
}

// ---------------------------------------------------------------- modules

/** A module, dome or pod for a building of the Orbital System. Lit or dark; the image is the footprint plus a three-pixel margin. */
export function paintOrbitalModule(b: Building, lit: boolean): HTMLCanvasElement {
  const w = b.w * TILE + 6, h = b.h * TILE;
  const { canvas, ctx } = surface(w, h);
  const k = lit ? 1 : 0.55;
  const dim = (c: string) => (lit ? c : shade(c, 0.55));
  const r = rng(b.x * 97 + b.y * 13);
  const dome = b.kind === 'library' || b.kind === 'observatory' || b.kind === 'workshop' || b.kind === 'forge';
  const hull = b.kind === 'forge' ? '#4a3a40' : b.kind === 'workshop' ? '#5a4a46' : '#aab4c8';
  if (dome) {
    // a dome standing on the surface
    ctx.fillStyle = dim(hull); ctx.beginPath(); ctx.moveTo(3, h); ctx.quadraticCurveTo(3, 2, w / 2, 2); ctx.quadraticCurveTo(w - 3, 2, w - 3, h); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = dim('#e8eefc'); ctx.lineWidth = 1.2; ctx.stroke();
    rect(ctx, 3, h - 5, w - 6, 5, dim('#46547e'));
  } else {
    // a station module or pod: a rounded hull
    ctx.fillStyle = dim(b.kind === 'house' ? '#c4ccdc' : '#9aa6c0'); ctx.beginPath(); ctx.roundRect(3, 2, w - 6, h - 2, b.kind === 'house' ? 10 : 8); ctx.fill();
    ctx.strokeStyle = dim('#e8eefc'); ctx.lineWidth = 1.2; ctx.stroke();
    rect(ctx, 6, h - 5, w - 12, 5, dim('#46547e'));
  }
  ctx.save(); ctx.globalAlpha = k;
  const glass = '#1a3a6a', warm = '#ffd88a';
  switch (b.kind) {
    case 'library':
      for (let i = 0; i < 4; i++) { rect(ctx, 14 + i * 20, 22, 10, h - 34, '#0c1a38'); rect(ctx, 15 + i * 20, 24, 8, 4, '#6fb4ff'); rect(ctx, 15 + i * 20, 32, 8, 3, '#ffb347'); }
      break;
    case 'observatory':
      rect(ctx, w / 2 - 3, 4, 6, h * 0.55, '#05081a'); ctx.save(); ctx.strokeStyle = '#6fb4ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w / 2 - 14, h - 14); ctx.lineTo(w / 2 + 18, 14); ctx.stroke(); ctx.restore();
      break;
    case 'workshop':
      rect(ctx, 14, 18, w - 28, h - 26, '#1a1418'); for (let i = 0; i < 5; i++) rect(ctx, 16 + i * 14, 20, 10, 3, '#ff8a3a'); glow(ctx, w * 0.7, h * 0.7, 18, '#ffb347', 0.6);
      break;
    case 'forge':
      rect(ctx, w / 2 - 14, 4, 8, 12, '#2a2024'); rect(ctx, w / 2 + 6, 8, 6, 8, '#2a2024'); rect(ctx, 14, h - 24, w - 28, 16, '#0a0608'); rect(ctx, 18, h - 22, w - 36, 12, '#ff6a2a'); glow(ctx, w / 2, h - 16, 28, '#ff7a2a', 0.85);
      break;
    case 'post':
      rect(ctx, 12, 16, w - 24, h - 28, glass); rect(ctx, w - 30, 2, 2, 14, '#e8eefc'); ctx.fillStyle = '#e8eefc'; ctx.beginPath(); ctx.ellipse(w - 29, 3, 11, 4, 0.4, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 6; i++) rect(ctx, 16 + i * 14, 22, 8, 6, i % 2 ? '#ff3fa4' : '#ffb347');
      break;
    case 'hall':
      rect(ctx, 12, 14, w - 24, h - 26, glass); for (let x = 14; x < w - 14; x += 12) rect(ctx, x, 14, 1, h - 26, '#8fb0e0');
      rect(ctx, w / 2 - 14, 22, 28, 12, '#05081a'); rect(ctx, w / 2 - 12, 24, 24, 2, '#6fb4ff'); rect(ctx, w / 2 - 12, 29, 16, 2, '#ffb347');
      break;
    case 'tavern':
      for (let i = 0; i < 4; i++) { ctx.fillStyle = lit ? warm : '#506080'; ctx.beginPath(); ctx.arc(20 + i * ((w - 40) / 3), h / 2 - 2, 6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#e8eefc'; ctx.stroke(); }
      rect(ctx, 16, h - 24, w - 32, 6, '#ff3fa4');
      break;
    case 'house':
      ctx.fillStyle = lit ? warm : '#3a4a6a'; ctx.beginPath(); ctx.arc(w / 2, 20, 8, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#e8eefc'; ctx.lineWidth = 1.5; ctx.stroke();
      rect(ctx, w / 2 - 6, h - 18, 12, 14, '#46547e'); rect(ctx, w / 2 - 4, h - 16, 8, 10, '#6a78a8');
      break;
    default: break;
  }
  ctx.restore();
  void r;
  if (lit) glow(ctx, w / 2, h * 0.5, w * 0.6, '#6fb4ff', 0.12);
  return canvas;
}

export function paintOrbitalMinimap(map: TownMap, bg: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = map.grid.w; c.height = map.grid.h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  // the sun's bloom in the corner
  const sun = g.createRadialGradient(3, 3, 1, 3, 3, 13); sun.addColorStop(0, '#fff1b0'); sun.addColorStop(0.6, '#ffb347'); sun.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 16, 16);
  const bodies: [Body, string][] = [[MERCURY, '#9a8e7a'], [FORGE_MOON, '#9a5a42'], [RELAY_GARDEN, '#3fb87a']];
  for (const [b, col] of bodies) { const k = centre(b); g.fillStyle = col; g.beginPath(); g.ellipse(k.x / TILE, k.y / TILE, k.rx / TILE, k.ry / TILE, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#6a78a8'; for (const d of Object.values(HELIOS)) g.fillRect(d.x, d.y, d.w, d.h);
  for (const b of [...map.buildings, ...map.homes]) { g.fillStyle = b.kind === 'house' ? '#6fb4ff' : '#dfe5ee'; g.fillRect(b.x, b.y, b.w, b.h); }
  g.fillStyle = '#ffb347'; for (const d of Object.values(DOCKS)) g.fillRect(d.x - 1, d.y - 1, 3, 3);
  g.strokeStyle = 'rgba(255,200,120,0.55)'; g.lineWidth = 0.7;
  for (const t of map.transit?.connectors ?? []) {
    if (!t.id.endsWith('-out') || t.visual.kind !== 'shuttle') continue;
    g.beginPath(); g.moveTo(t.boarding.x + 0.5, t.boarding.y + 0.5); g.quadraticCurveTo(t.visual.control.x / TILE, t.visual.control.y / TILE, t.exit.x + 0.5, t.exit.y + 0.5); g.stroke();
  }
  return c;
}
