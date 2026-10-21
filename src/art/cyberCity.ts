import { TILE } from './tiles';
import type { Building, TownMap } from '../world/map';
import { CYBER_H, CYBER_TOWERS, CYBER_W, LIFT_SHAFT_HALF_W, STREET_YB, TOWER_W, deckTopPx, floorBase, liftOccluderRects, vestibule, type CyberTower } from '../world/cyberCity';
import { SCALE, glow, neon, neonText, rect, rng, surface, vgrad, type Surface } from './artKit';
import { shade } from './painter';

/**
 * Cyber City art, all procedural and local. The sky and the city are two canvases so decorative traffic can pass
 * between them (behind the towers, in front of the sky). Nothing drawn here is an agent: no name tags, no profile
 * colours, no residents.
 */

const W = CYBER_W * TILE, H = CYBER_H * TILE;
export const CYBER = { cyan: '#35e6ff', magenta: '#ff3fa4', amber: '#ffb347', violet: '#8a5cff', green: '#3dff9a' } as const;

/** World-pixel anchors the ambient layer needs: neon signs, beacons, the road and the sky lanes. */
export interface CyberAnchors {
  signs: { x: number; y: number; w: number; h: number; color: string }[];
  beacons: { x: number; y: number; color: string }[];
  road: { y0: number; y1: number };
  skyLane: { y: number };
  windows: { x: number; y: number; w: number; h: number }[];
}

export function cyberAnchors(): CyberAnchors {
  const signs: CyberAnchors['signs'] = [];
  const beacons: CyberAnchors['beacons'] = [];
  for (const t of CYBER_TOWERS) {
    const top = roofTop(t);
    signs.push({ x: (t.x0 + 3) * TILE, y: top - 30, w: (TOWER_W - 6) * TILE, h: 12, color: t.accent });
    beacons.push({ x: (t.x0 + 9) * TILE + 8, y: top - 58, color: '#ff4a6a' });
  }
  signs.push({ x: 26 * TILE, y: 39 * TILE, w: 14 * TILE, h: 10, color: CYBER.magenta });
  return { signs, beacons, road: { y0: (STREET_YB + 1) * TILE + 4, y1: (STREET_YB + 4) * TILE }, skyLane: { y: 3 * TILE }, windows: [] };
}

function topFloor(t: CyberTower): number { return Math.max(...t.floors.map((f) => f.floor)); }
/** Pixel row of a tower's roofline. */
function roofTop(t: CyberTower): number { return (floorBase(topFloor(t)) - 8) * TILE; }

export function paintCyberSky(): HTMLCanvasElement {
  const { canvas, ctx } = surface(W, H);
  rect(ctx, 0, 0, W, H, vgrad(ctx, 0, H, [[0, '#04050d'], [0.35, '#0a0f2c'], [0.62, '#241046'], [0.8, '#3d1456'], [1, '#12081e']]));
  const r = rng(7001);
  for (let i = 0; i < 220; i++) { ctx.fillStyle = `rgba(210,230,255,${0.2 + r() * 0.5})`; ctx.fillRect(r() * W, r() * H * 0.45, 1, 1); }
  glow(ctx, W * 0.78, H * 0.16, 190, '#8a5cff', 0.35);
  glow(ctx, W * 0.2, H * 0.42, 240, '#ff3fa4', 0.18);
  // a distant moon behind the haze
  ctx.fillStyle = 'rgba(200,215,255,0.5)'; ctx.beginPath(); ctx.arc(W * 0.9, H * 0.09, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(30,40,90,0.45)'; ctx.beginPath(); ctx.arc(W * 0.9 + 6, H * 0.09 - 3, 18, 0, Math.PI * 2); ctx.fill();
  // far skyline layers: rising blocks with a few lit windows
  const layers: [string, number, number, number][] = [['#0b1230', 0.2, 52, 90], ['#0e1840', 0.14, 36, 70], ['#142052', 0.08, 26, 52]];
  for (const [colour, topShare, minW, maxW] of layers) {
    let x = -10;
    while (x < W) {
      const w = minW + r() * (maxW - minW), top = H * (topShare + r() * 0.1);
      rect(ctx, x, top, w, H - top, colour);
      rect(ctx, x, top, w, 2, 'rgba(120,160,255,0.18)');
      for (let wy = top + 8; wy < H * 0.8; wy += 7) for (let wx = x + 4; wx < x + w - 4; wx += 6) {
        if (r() < 0.16) { ctx.fillStyle = r() < 0.5 ? 'rgba(255,220,140,0.55)' : 'rgba(120,230,255,0.55)'; ctx.fillRect(wx, wy, 2, 3); }
      }
      if (r() < 0.25) neon(ctx, x + 4, top + 10, w - 8, 3, [CYBER.magenta, CYBER.cyan, CYBER.violet][Math.floor(r() * 3)]!);
      x += w + 2 + r() * 4;
    }
  }
  return canvas;
}

export function paintCyberCity(map: TownMap): HTMLCanvasElement {
  const { canvas, ctx } = surface(W, H);
  paintAlleys(ctx);
  for (const t of CYBER_TOWERS) paintTower(ctx, t);
  paintStreet(ctx);
  paintArcade(ctx);
  paintLiftLandings(ctx);
  paintCables(ctx);
  void map;
  return canvas;
}

function paintAlleys(ctx: CanvasRenderingContext2D): void {
  // service alleys between the towers and the outer margins: dark back structure with pipes and a faint neon seam
  const r = rng(8101);
  const gaps: [number, number][] = [[0, CYBER_TOWERS[0]!.x0 * TILE]];
  for (let i = 0; i + 1 < CYBER_TOWERS.length; i++) gaps.push([(CYBER_TOWERS[i]!.x0 + TOWER_W) * TILE, CYBER_TOWERS[i + 1]!.x0 * TILE]);
  const last = CYBER_TOWERS[CYBER_TOWERS.length - 1]!;
  gaps.push([(last.x0 + TOWER_W) * TILE, W]);
  const bottom = (STREET_YB + 1) * TILE;
  for (const [x0, x1] of gaps) {
    const top = 12 * TILE;
    rect(ctx, x0, top, x1 - x0, bottom - top, '#090d1e');
    for (let x = x0 + 4; x < x1 - 2; x += 10) { rect(ctx, x, top, 2, bottom - top, 'rgba(70,90,160,0.3)'); if (r() < 0.5) rect(ctx, x + 4, top, 1, bottom - top, 'rgba(255,63,164,0.18)'); }
  }
}

function paintTower(ctx: CanvasRenderingContext2D, t: CyberTower): void {
  const L = t.x0 * TILE, Wd = TOWER_W * TILE;
  const floors = [0, ...t.floors.map((f) => f.floor)];
  const top = roofTop(t), bottom = (STREET_YB + 1) * TILE;
  // body
  rect(ctx, L, top, Wd, bottom - top, '#0d1328');
  // roof: parapet, mast and beacon
  rect(ctx, L - 4, top - 8, Wd + 8, 8, '#1a2448'); rect(ctx, L - 4, top - 8, Wd + 8, 2, shade(t.accent, 0.8));
  rect(ctx, L + Wd / 2 - 2, top - 56, 4, 48, '#1a2448'); rect(ctx, L + Wd / 2 - 8, top - 40, 16, 2, '#1a2448'); rect(ctx, L + Wd / 2 - 5, top - 28, 10, 2, '#1a2448');
  glow(ctx, L + Wd / 2, top - 56, 14, '#ff4a6a', 0.9);
  // the tower's name in neon on the parapet
  const name = t.id === 'archive' ? 'ARCHIVE' : t.id === 'maker' ? 'MAKER' : t.id === 'operations' ? 'OPERATIONS' : 'RESIDENCE';
  neon(ctx, L + 3 * TILE, top - 30, Wd - 6 * TILE, 12, shade(t.accent, 0.35));
  neonText(ctx, name, L + Wd / 2, top - 24, t.accent, 9);
  rect(ctx, L + 2 * TILE, top - 14, 4, 6, '#1a2448'); rect(ctx, L + Wd - 2 * TILE - 4, top - 14, 4, 6, '#1a2448');
  // outer pillars and neon edge lines
  rect(ctx, L, top, TILE, bottom - top, '#141c3a'); rect(ctx, L + Wd - TILE, top, TILE, bottom - top, '#141c3a');
  neon(ctx, L + 1, top, 2, bottom - top, shade(t.accent, 0.8)); neon(ctx, L + Wd - 3, top, 2, bottom - top, shade(t.accent, 0.8));
  rect(ctx, L + TILE - 2, top, 2, bottom - top, 'rgba(0,0,0,0.5)'); rect(ctx, L + Wd - TILE, top, 2, bottom - top, 'rgba(0,0,0,0.5)');
  for (const f of floors) paintFloor(ctx, t, f);
}

function paintFloor(ctx: CanvasRenderingContext2D, t: CyberTower, floor: number): void {
  const yb = floor === 0 ? STREET_YB : floorBase(floor);
  const L = (t.x0 + 1) * TILE, iw = (TOWER_W - 2) * TILE;
  const roomTop = (yb - 8) * TILE, deckTop = (yb - 2) * TILE, deckBottom = (yb + 1) * TILE;
  // interior back wall
  rect(ctx, L, roomTop, iw, deckTop - roomTop, vgrad(ctx, roomTop, deckTop, [[0, '#101833'], [1, '#0b1128']]));
  neon(ctx, L, roomTop + 2, iw, 2, shade(t.accent, 0.5));
  // wall panels
  for (let x = L + 5 * TILE; x < L + iw; x += 3 * TILE) rect(ctx, x, roomTop + 8, 1, deckTop - roomTop - 10, 'rgba(90,120,200,0.18)');
  // the deck: three tiles of lit floor in perspective, a slab edge below it
  rect(ctx, L, deckTop, iw, deckBottom - deckTop, vgrad(ctx, deckTop, deckBottom, [[0, '#212c52'], [1, '#161f3e']]));
  for (let x = L; x < L + iw; x += TILE) rect(ctx, x, deckTop, 1, deckBottom - deckTop, 'rgba(110,140,220,0.12)');
  rect(ctx, L, deckTop + TILE, iw, 1, 'rgba(110,140,220,0.1)');
  rect(ctx, L - TILE, deckBottom - 5, iw + 2 * TILE, 5, '#222c55');
  neon(ctx, L - TILE, deckBottom - 5, iw + 2 * TILE, 1.4, shade(t.accent, 0.7));
  // The lift shaft opening: backing, rails, door frame and an indicator. The shaft lies BEHIND the deck slabs. Its opening
  // is the wall between this deck's back edge and the slab of the floor above; the slab itself is solid, so the rails and
  // the backing stop at the deck's back edge and the cabin (a sprite in the shaft band) shows only in this opening.
  // The cabin's floor stands exactly on the deck's back edge (see LIFT_CAR_BASE_OFFSET), so it is clear of the deck art.
  const cx = vestibule(t, floor).x * TILE + TILE / 2;
  const doorTop = deckTop - 52, doorBottom = deckTop;
  rect(ctx, cx - 20, roomTop + 6, 40, deckTop - roomTop - 6, '#0a0e1e');
  rect(ctx, cx - 20, roomTop + 6, 40, 2, '#2a3560');
  for (const dx of [-LIFT_SHAFT_HALF_W, LIFT_SHAFT_HALF_W - 3]) { rect(ctx, cx + dx, roomTop + 6, 3, deckTop - roomTop - 6, '#2a3560'); rect(ctx, cx + dx, roomTop + 6, 1, deckTop - roomTop - 6, 'rgba(160,190,255,0.35)'); }
  rect(ctx, cx - 17, doorTop - 2, 34, doorBottom - doorTop + 2, '#1b2547');
  rect(ctx, cx - 15, doorTop, 14.4, doorBottom - doorTop, '#26326a'); rect(ctx, cx + 0.6, doorTop, 14.4, doorBottom - doorTop, '#26326a');
  rect(ctx, cx - 0.5, doorTop, 1, doorBottom - doorTop, '#0a0e1e');
  neon(ctx, cx - 17, doorTop - 3, 34, 1.5, t.accent);
  neonText(ctx, floor === 0 ? 'G' : `F${floor}`, cx, doorTop - 10, t.accent, 7);
}

/**
 * The lift landing of every floor, drawn after the street so the sidewalk cannot paint over it: the door sill on the
 * deck's back edge and a lit landing plate on the deck at the vestibule tile, so a resident visibly walks the ordinary
 * deck line up to the threshold. Floor art only; the cabin itself is a sprite.
 */
function paintLiftLandings(ctx: CanvasRenderingContext2D): void {
  for (const t of CYBER_TOWERS) for (const floor of [0, ...t.floors.map((f) => f.floor)]) {
    const cx = vestibule(t, floor).x * TILE + TILE / 2, deckTop = deckTopPx(floor);
    rect(ctx, cx - 18, deckTop - 2, 36, 3, '#46547e');
    neon(ctx, cx - 18, deckTop + 1, 36, 1.5, t.accent);
    rect(ctx, cx - 18, deckTop + 3, 36, 2 * TILE - 3, 'rgba(53,230,255,0.07)');
    rect(ctx, cx - 18, deckTop + 3, 1, 2 * TILE - 3, 'rgba(53,230,255,0.28)'); rect(ctx, cx + 17, deckTop + 3, 1, 2 * TILE - 3, 'rgba(53,230,255,0.28)');
    // chevrons point up the walk line into the lift
    ctx.save(); ctx.strokeStyle = t.accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.4;
    for (const dy of [0, 6]) { ctx.beginPath(); ctx.moveTo(cx - 5, deckTop + 16 + dy); ctx.lineTo(cx, deckTop + 11 + dy); ctx.lineTo(cx + 5, deckTop + 16 + dy); ctx.stroke(); }
    ctx.restore();
  }
}

export interface LiftOccluder { id: string; x: number; y: number; canvas: HTMLCanvasElement }

/**
 * The solid deck slab across each upper shaft, cut from the painted city so it matches it pixel for pixel. The scene
 * draws these over the lift cabins and under every resident: a cabin passing a floor goes behind the slab and shows
 * only in the openings between decks. Each piece is the slab and nothing else, so residents, names and bubbles are
 * never covered, and the lit shaft openings stay visible.
 */
export function cyberLiftOccluders(city: HTMLCanvasElement): LiftOccluder[] {
  return liftOccluderRects().map((r) => {
    const { canvas, ctx } = surface(r.w, r.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(city, r.x * SCALE, r.y * SCALE, r.w * SCALE, r.h * SCALE, 0, 0, canvas.width, canvas.height);
    return { id: r.id, x: r.x, y: r.y, canvas };
  });
}

function paintStreet(ctx: CanvasRenderingContext2D): void {
  const y0 = (STREET_YB - 2) * TILE, y1 = (STREET_YB + 1) * TILE;
  // the sidewalk deck of the street level
  rect(ctx, 0, y0 - 2, W, y1 - y0 + 2, vgrad(ctx, y0, y1, [[0, '#2a3358'], [1, '#1a2242']]));
  const r = rng(8301);
  for (let x = 0; x < W; x += 16) { rect(ctx, x, y0, 1, y1 - y0, 'rgba(140,170,255,0.1)'); if (r() < 0.18) rect(ctx, x + 3, y0 + 4 + r() * 30, 8, 1, 'rgba(255,255,255,0.08)'); }
  rect(ctx, 0, y0 + TILE, W, 1, 'rgba(140,170,255,0.08)');
  // the road: wet asphalt, lane dashes, curb and reflected neon
  const ry = y1, rh = H - y1;
  rect(ctx, 0, ry, W, rh, vgrad(ctx, ry, H, [[0, '#0b0e1c'], [1, '#05060f']]));
  rect(ctx, 0, ry, W, 3, '#3a4678'); neon(ctx, 0, ry + 3, W, 1, 'rgba(53,230,255,0.45)');
  for (let x = 6; x < W; x += 36) rect(ctx, x, ry + rh / 2, 18, 1.5, 'rgba(255,230,150,0.55)');
  for (const t of CYBER_TOWERS) for (const dx of [0.4, 0.6, 0.8]) {
    ctx.save(); ctx.globalAlpha = 0.16; ctx.fillStyle = t.accent;
    ctx.fillRect(t.x0 * TILE + dx * TOWER_W * TILE, ry + 4, 3, rh - 8); ctx.restore();
  }
  // street lamps
  for (const x of [5, 15, 35, 55, 75].map((n) => n * TILE)) {
    rect(ctx, x, y0 - 26, 2, 26, '#26326a'); rect(ctx, x - 6, y0 - 28, 14, 2, '#26326a');
    glow(ctx, x + 1, y0 - 26, 18, '#9fe8ff', 0.7);
  }
}

function paintArcade(ctx: CanvasRenderingContext2D): void {
  // the neon arcade: a glass-fronted concourse under the Maker Tower where the kiosks stand
  const x0 = 26 * TILE, w = 14 * TILE, y = (STREET_YB - 6) * TILE;
  rect(ctx, x0, y, w, 4 * TILE, '#0a1028'); rect(ctx, x0, y, w, 3, '#2a3560');
  neon(ctx, x0, y + 3, w, 2, CYBER.magenta);
  neonText(ctx, 'NEON ARCADE', x0 + w / 2, y + 16, CYBER.magenta, 9);
  for (let x = x0 + 8; x < x0 + w - 8; x += 24) { rect(ctx, x, y + 26, 16, 24, 'rgba(255,63,164,0.12)'); rect(ctx, x, y + 26, 16, 1, 'rgba(255,63,164,0.5)'); }
}

function paintCables(ctx: CanvasRenderingContext2D): void {
  ctx.save(); ctx.strokeStyle = 'rgba(70,90,160,0.55)'; ctx.lineWidth = 1.2;
  for (let i = 0; i < CYBER_TOWERS.length - 1; i++) {
    const a = CYBER_TOWERS[i]!, b = CYBER_TOWERS[i + 1]!;
    const ax = (a.x0 + TOWER_W) * TILE, bx = b.x0 * TILE, y = Math.min(roofTop(a), roofTop(b)) + 12 + i * 6;
    for (const dy of [0, 7]) { ctx.beginPath(); ctx.moveTo(ax, y + dy); ctx.quadraticCurveTo((ax + bx) / 2, y + dy + 14, bx, y + dy); ctx.stroke(); }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- rooms

const ROOM_ACCENT: Record<string, string> = {
  library: CYBER.cyan, observatory: CYBER.cyan, workshop: CYBER.amber, forge: '#ff7a2a',
  post: CYBER.magenta, hall: CYBER.magenta, tavern: CYBER.violet, house: CYBER.violet, market: CYBER.magenta,
};

/** A room's interior, lit or dark. The image is the room's width plus a three-pixel margin each side, and its height. */
export function paintCyberRoom(b: Building, lit: boolean): HTMLCanvasElement {
  const w = b.w * TILE + 6, h = b.h * TILE;
  const s: Surface = surface(w, h);
  const { ctx } = s;
  const accent = ROOM_ACCENT[b.kind] ?? CYBER.cyan;
  const k = lit ? 1 : 0.55;
  const dim = (c: string) => (lit ? c : shade(c, 0.55));
  const isPod = b.kind === 'house';
  rect(ctx, 3, 0, w - 6, h, vgrad(ctx, 0, h, [[0, dim('#18224a')], [1, dim('#0d1430')]]));
  rect(ctx, 3, 0, w - 6, 3, dim('#2a3560'));
  neon(ctx, 3, 3, w - 6, 1.6, lit ? accent : shade(accent, 0.45));
  rect(ctx, 3, h - 3, w - 6, 3, dim('#222c55'));
  const r = rng(b.x * 131 + b.y * 17);
  ctx.save(); ctx.globalAlpha = k;
  switch (b.kind) {
    case 'library': {
      for (let row = 0; row < 3; row++) for (let x = 8; x < w - 12; x += 7) {
        rect(ctx, x, 10 + row * 14, 5, 11, '#152044');
        rect(ctx, x + 1, 11 + row * 14, 3, 9, [CYBER.cyan, '#1e9bb8', '#9fe8ff', CYBER.violet][Math.floor(r() * 4)]!);
      }
      for (let row = 0; row < 3; row++) rect(ctx, 6, 21 + row * 14, w - 12, 1.5, '#2a3560');
      glow(ctx, w - 28, h - 24, 18, CYBER.cyan, 0.6);
      break;
    }
    case 'observatory': {
      ctx.fillStyle = '#05081a'; ctx.beginPath(); ctx.arc(w / 2, h * 0.62, h * 0.52, Math.PI, 0); ctx.fill();
      for (let i = 0; i < 30; i++) { ctx.fillStyle = `rgba(220,240,255,${0.3 + r() * 0.6})`; ctx.fillRect(w / 2 + (r() - 0.5) * h, h * 0.62 - r() * h * 0.5, 1, 1); }
      ctx.strokeStyle = CYBER.cyan; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(w / 2, h * 0.62, h * 0.52, Math.PI, 0); ctx.stroke();
      rect(ctx, w / 2 - 22, h * 0.5, 40, 4, '#46547e'); rect(ctx, w / 2 + 14, h * 0.44, 18, 6, '#8fa4d8');
      break;
    }
    case 'workshop': {
      for (let x = 8; x < w - 14; x += 12) { rect(ctx, x, 12, 1.5, 30, '#46547e'); rect(ctx, x - 3, 12, 8, 3, '#ff8a3a'); }
      rect(ctx, 6, 46, w - 12, 2, '#2a3560');
      for (let i = 0; i < 4; i++) { rect(ctx, 14 + i * 28, 52, 3, 20, '#2a3560'); rect(ctx, 14 + i * 28, 52, 14, 3, CYBER.amber); }
      for (let i = 0; i < 14; i++) { ctx.fillStyle = `rgba(255,200,100,${0.4 + r() * 0.5})`; ctx.fillRect(w * 0.7 + r() * 24, 56 + r() * 18, 1, 1); }
      break;
    }
    case 'forge': {
      rect(ctx, w * 0.26, 28, w * 0.48, 46, '#06080f'); rect(ctx, w * 0.3, 34, w * 0.4, 36, '#ff6a2a'); rect(ctx, w * 0.36, 42, w * 0.28, 22, '#ffd36b');
      glow(ctx, w / 2, 56, 60, '#ff7a2a', 0.85);
      for (let i = 0; i < 4; i++) rect(ctx, 8 + i * 6, 14, 3, 30, '#46547e');
      for (let i = 0; i < 4; i++) rect(ctx, w - 30 + i * 6, 14, 3, 30, '#46547e');
      break;
    }
    case 'post': {
      for (let row = 0; row < 4; row++) for (let x = 8; x < w - 12; x += 11) {
        rect(ctx, x, 10 + row * 13, 9, 10, '#152044');
        if (r() < 0.6) rect(ctx, x + 1, 13 + row * 13, 7, 6, [CYBER.magenta, CYBER.amber, CYBER.cyan][Math.floor(r() * 3)]!);
      }
      rect(ctx, w - 40, h - 26, 24, 10, '#2a3560'); rect(ctx, w - 36, h - 36, 6, 10, CYBER.magenta);
      break;
    }
    case 'hall': {
      rect(ctx, 14, 10, w - 28, 44, '#05081a'); rect(ctx, 14, 10, w - 28, 2, CYBER.magenta);
      ctx.strokeStyle = CYBER.cyan; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(20, 46); for (let x = 24; x < w - 20; x += 12) ctx.lineTo(x, 22 + r() * 24); ctx.stroke();
      ctx.strokeStyle = CYBER.magenta; ctx.beginPath(); ctx.moveTo(20, 50); for (let x = 24; x < w - 20; x += 12) ctx.lineTo(x, 28 + r() * 22); ctx.stroke();
      for (let i = 0; i < 3; i++) rect(ctx, 18 + i * ((w - 40) / 2.5), 58, 8, 22, [CYBER.magenta, CYBER.cyan, CYBER.amber][i]!);
      break;
    }
    case 'tavern': {
      rect(ctx, 8, h - 34, w - 16, 5, '#46347e'); rect(ctx, 8, h - 29, w - 16, 26, '#201a44');
      for (let x = 12; x < w - 16; x += 9) { rect(ctx, x, h - 48, 4, 13, [CYBER.violet, CYBER.magenta, CYBER.cyan, CYBER.amber][Math.floor(r() * 4)]!); }
      neonText(ctx, 'BAR', w / 2, 16, CYBER.magenta, 10);
      for (let i = 0; i < 3; i++) glow(ctx, 20 + i * (w / 3), 40, 14, CYBER.violet, 0.5);
      break;
    }
    case 'house': {
      // a resident pod: a window on the skyline, a bunk and a door plate
      rect(ctx, 8, 8, w - 22, 22, '#05081a'); rect(ctx, 8, 8, w - 22, 1.5, CYBER.violet);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = lit && r() < 0.5 ? '#ffd88a' : '#26326a'; ctx.fillRect(10 + r() * (w - 28), 12 + r() * 14, 2, 3); }
      rect(ctx, 8, h - 20, w - 24, 8, '#3a2a6a'); rect(ctx, 8, h - 22, 14, 4, '#c8b8ff');
      rect(ctx, w / 2 - 6, h - 16, 12, 16, '#1b2547'); neon(ctx, w / 2 - 6, h - 17, 12, 1.2, lit ? CYBER.violet : '#4a3a7a');
      break;
    }
    default: break;
  }
  ctx.restore();
  if (lit && !isPod) glow(ctx, w / 2, h * 0.5, w * 0.55, accent, 0.18);
  return s.canvas;
}

/** The minimap of Cyber City: towers as stacked decks, the street, and the lifts. One canvas pixel per map tile. */
export function paintCyberMinimap(map: TownMap, bg: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = map.grid.w; c.height = map.grid.h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  for (const t of CYBER_TOWERS) {
    const top = floorBase(topFloor(t)) - 8, bottom = STREET_YB + 1;
    g.fillStyle = '#16204a'; g.fillRect(t.x0, top, TOWER_W, bottom - top);
    g.fillStyle = t.accent; g.globalAlpha = 0.55; g.fillRect(t.x0, top, TOWER_W, 1); g.globalAlpha = 1;
  }
  for (const b of [...map.buildings, ...map.homes]) { g.fillStyle = b.kind === 'house' ? '#8a5cff' : '#35e6ff'; g.fillRect(b.x, b.y, b.w, b.h); }
  for (let y = 0; y < map.grid.h; y++) for (let x = 0; x < map.grid.w; x++) if (map.grid.cost[y * map.grid.w + x] !== 0) { g.fillStyle = '#9fb4e0'; g.fillRect(x, y, 1, 1); }
  for (const t of CYBER_TOWERS) { g.fillStyle = '#ffd36b'; g.fillRect(t.x0 + 2, floorBase(topFloor(t)) - 8, 1, STREET_YB - floorBase(topFloor(t)) + 8); }
  g.fillStyle = '#ff3fa4'; g.fillRect(1, STREET_YB + 1, 82, 1);
  return c;
}
