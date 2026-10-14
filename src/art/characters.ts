import { CLOTH, HAIR, PAL } from './palette';
import { Painter, hashString, mulberry, outline, shade } from './painter';

/**
 * Original 20×30 resident, NOT enlarged to fill its cell. Six pixels of
 * horizontal gutter and five above the body leave room for tools and ink.
 * Native texels, row-major grid; scene scale is independent of atlas scale.
 * Side work is authored left and mirrored by the renderer for right.
 */
export const FRAME_W = 32;
export const FRAME_H = 40;
export const CHARACTER_SCALE = 1;
export const FRAME_COLUMNS = 16;
/** Bottom edge of the grounded boot outline, measured from the cell top. */
export const CHARACTER_BASELINE = 35;
export const WALK_FRAME_COUNT = 8;
export const IDLE_FRAME_COUNT = 4;
export const WORK_FRAME_COUNT = 4;
export const REACTION_FRAME_COUNT = 4;
export const REACTION_DURATION = 1.2;

export type Facing = 'down' | 'left' | 'right' | 'up';
export const FACINGS: readonly Facing[] = ['down', 'left', 'right', 'up'];
export type WorkStyle = 'hammer' | 'read' | 'bellows' | 'parcel' | 'gaze' | 'desk' | 'sit' | 'haggle';
export const WORK_STYLES: readonly WorkStyle[] = ['hammer', 'read', 'bellows', 'parcel', 'gaze', 'desk', 'sit', 'haggle'];
type Orient = 'side' | 'down' | 'up';
const ORIENTS: readonly Orient[] = ['side', 'down', 'up'];
type Reaction = 'complete' | 'fail';
const REACTIONS: readonly Reaction[] = ['complete', 'fail'];
const IDLE_START = FACINGS.length * WALK_FRAME_COUNT;
const WORK_START = IDLE_START + FACINGS.length * IDLE_FRAME_COUNT;
const REACTION_START = WORK_START + WORK_STYLES.length * ORIENTS.length * WORK_FRAME_COUNT;
export const FRAME_COUNT = REACTION_START + REACTIONS.length * FACINGS.length * REACTION_FRAME_COUNT;

function wrap(index: number, count: number): number {
  return Number.isFinite(index) ? ((Math.floor(index) % count) + count) % count : 0;
}
export function walkFrame(facing: Facing, index: number): number {
  return FACINGS.indexOf(facing) * WALK_FRAME_COUNT + wrap(index, WALK_FRAME_COUNT);
}
export function idleFrame(facing: Facing, index: number): number {
  return IDLE_START + FACINGS.indexOf(facing) * IDLE_FRAME_COUNT + wrap(index, IDLE_FRAME_COUNT);
}
export function workFrame(style: WorkStyle, facing: Facing, index: number): number {
  const orient: Orient = facing === 'down' ? 'down' : facing === 'up' ? 'up' : 'side';
  return WORK_START + (WORK_STYLES.indexOf(style) * ORIENTS.length + ORIENTS.indexOf(orient)) * WORK_FRAME_COUNT + wrap(index, WORK_FRAME_COUNT);
}
export function sitFrame(facing: Facing, index: number): number { return workFrame('sit', facing, index); }
export const SIT_FRAME = sitFrame('down', 0);
export function reactionFrame(kind: Reaction, facing: Facing, index: number): number {
  return REACTION_START + (REACTIONS.indexOf(kind) * FACINGS.length + FACINGS.indexOf(facing)) * REACTION_FRAME_COUNT + wrap(index, REACTION_FRAME_COUNT);
}

// Seconds per authored pose. Hammer: prepare, anticipate, impact, recover.
// Idle holds neutral; the blink is short, and never raises/lowers the feet.
export const IDLE_DURATIONS: readonly number[] = [2.8, 0.65, 0.12, 0.65];
export const WORK_DURATIONS: Readonly<Record<WorkStyle, readonly number[]>> = {
  hammer: [0.28, 0.24, 0.12, 0.36],
  read: [0.9, 0.35, 0.24, 0.65],
  bellows: [0.4, 0.25, 0.38, 0.32],
  parcel: [0.45, 0.3, 0.4, 0.45],
  gaze: [0.7, 0.35, 0.55, 0.5],
  desk: [0.3, 0.24, 0.3, 0.55],
  sit: [2.4, 0.7, 0.12, 0.7],
  haggle: [0.55, 0.3, 0.5, 0.45],
};
export const REACTION_DURATIONS: readonly number[] = [0.15, 0.25, 0.45, 0.35];
/** Loop idle/work; reactions are one-shot and hold their recovered last pose. */
export function poseFrameAt(kind: 'idle' | 'work' | 'reaction', elapsedSeconds: number, styleOrReaction?: WorkStyle | Reaction): number {
  const durations = kind === 'idle' ? IDLE_DURATIONS : kind === 'reaction' ? REACTION_DURATIONS
    : WORK_DURATIONS[styleOrReaction && WORK_STYLES.includes(styleOrReaction as WorkStyle) ? styleOrReaction as WorkStyle : 'desk'];
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  let time = kind === 'reaction' ? Math.min(elapsed, total) : elapsed % total;
  for (let i = 0; i < durations.length - 1; i++) {
    if (time < durations[i]!) return i;
    time -= durations[i]!;
  }
  return durations.length - 1;
}

export type RoleClass = 'coordinator' | 'research' | 'fabrication' | 'review' | 'tooling' | 'general' | 'scheduled';

export interface Look {
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'mohawk';
  cloth: string;
  cloth2: string;
  pants: string;
  skin: string;
  hat: 'none' | 'cap' | 'hood' | 'band' | 'brim' | 'goggles' | 'visor' | 'helmet';
  apron: boolean;
  /** Optional for callers with hand-authored legacy looks. */
  garment?: 'jacket' | 'tunic' | 'coat';
  beard: boolean;
  belt: boolean;
  /** Edging colour for collar, lapels, hem and the hat band. Absent for the original look. */
  trim?: string;
  /** Replaces the default straw hat colour of the brimmed hat. */
  hatColor?: string;
  /** A feather in the hat. */
  plume?: string;
  /** The diagonal satchel strap. Drawn unless this is exactly false. */
  satchel?: boolean;
  /** A baldric worn from shoulder to hip, in a bold accent colour. Edged in the hat colour. */
  sash?: string;
  /** A two-pixel band along the hem of the coat. */
  hemBand?: string;
  /** Sleeve colour, when the arms are not the same cloth as the body (shirt sleeves under a coloured tunic). */
  sleeve?: string;
  /**
   * A whole-figure silhouette. 'operative' is a long, wide-hemmed coat with a high collar, shoulder panels and a
   * visor; 'crew' is a pressure suit with a round helmet and a back unit. The profile colour (`cloth`) is then worn
   * as the broad chest, shoulder, bag and helmet-ring panels over the `shell`, so it stays the most conspicuous colour.
   */
  style?: 'operative' | 'crew';
  /** The coat or suit that the profile colour is worn on, for a styled figure. */
  shell?: string;
  /** Neon, light or ring accent of a styled figure. */
  accent?: string;
  /** The resident's role, for small deterministic accessory variations of a styled figure. Never changes the animation. */
  role?: RoleClass;
}

/** A stable look from a stable id, nudged by role so jobs read at a glance. A profile colour, when given, replaces the role's cloth. */
export function lookFor(id: string, role: RoleClass, profileCloth?: string): Look {
  const r = mulberry(hashString(id));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!;
  const cloth = pick(CLOTH);
  const look: Look = {
    hair: pick(HAIR),
    hairStyle: pick(['short', 'long', 'long', 'bun', 'short', 'bald', 'mohawk'] as const),
    cloth,
    cloth2: shade(cloth, 0.72),
    pants: pick(['#4a4548', '#3f3a44', '#4a3d36', '#3a4048']),
    skin: r() < 0.7 ? PAL.skin : PAL.skin2,
    hat: r() < 0.35 ? 'brim' : 'none',
    apron: false,
    beard: r() < 0.2,
    belt: true,
  };
  switch (role) {
    case 'coordinator': look.hat = 'brim'; look.cloth = pick(['#6b4a7a', '#5e3f78', '#3f5e7a']); break;
    case 'research': look.hat = r() < 0.5 ? 'hood' : 'none'; look.cloth = pick(['#3f5e7a', '#2f6b66', '#4a4a56']); break;
    case 'fabrication': look.apron = true; look.hat = r() < 0.4 ? 'goggles' : 'none'; look.cloth = pick(['#7a3a2a', '#a0703a', '#7a6a3a']); break;
    case 'review': look.hat = 'band'; look.cloth = pick(['#4a4a56', '#7a6a3a', '#2f6b66']); break;
    case 'tooling': look.apron = r() < 0.5; look.hat = r() < 0.5 ? 'cap' : 'none'; look.cloth = pick(['#4f6b3a', '#4a4a56', '#3f5e7a']); break;
    case 'scheduled': look.hat = 'hood'; look.cloth = pick(['#2f3a5a', '#3a3350', '#2f4a4a']); look.beard = false; break;
    default: break;
  }
  look.garment = look.apron || role === 'scheduled' || role === 'coordinator' ? 'coat'
    : role === 'research' || role === 'general' ? 'tunic' : 'jacket';
  if (profileCloth !== undefined) look.cloth = profileCloth;
  look.cloth2 = shade(look.cloth, 0.72);
  look.role = role;
  return look;
}

const INK = '#2a1f1c';
const HAT = '#8a6a3f';
const HAT_DARK = '#6b4f2e';
const STRAP = '#5a3d24';
const BUCKLE = '#d9b34a';
const BOOT = '#7a4f2e';
const BOOT_DARK = '#5a3820';
const APRON = '#ad9270';
const APRON_DARK = '#8a7454';

export function paintCharacterSheet(look: Look): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_COLUMNS * FRAME_W * CHARACTER_SCALE;
  canvas.height = Math.ceil(FRAME_COUNT / FRAME_COLUMNS) * FRAME_H * CHARACTER_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const put = (index: number, facing: Facing, mode: Mode, phase: number) => {
    const frame = drawFrame(look, facing, mode, phase);
    ctx.drawImage(frame.canvas, index % FRAME_COLUMNS * FRAME_W * CHARACTER_SCALE,
      Math.floor(index / FRAME_COLUMNS) * FRAME_H * CHARACTER_SCALE,
      FRAME_W * CHARACTER_SCALE, FRAME_H * CHARACTER_SCALE);
  };
  for (const facing of FACINGS) {
    for (let i = 0; i < WALK_FRAME_COUNT; i++) put(walkFrame(facing, i), facing, 'walk', i);
    for (let i = 0; i < IDLE_FRAME_COUNT; i++) put(idleFrame(facing, i), facing, 'idle', i);
    for (const kind of REACTIONS) for (let i = 0; i < REACTION_FRAME_COUNT; i++) put(reactionFrame(kind, facing, i), facing, kind, i);
  }
  for (const style of WORK_STYLES) for (const orient of ORIENTS) for (let i = 0; i < WORK_FRAME_COUNT; i++) {
    const facing = orient === 'side' ? 'left' : orient;
    put(workFrame(style, facing, i), facing, style, i);
  }
  return canvas;
}

type Mode = 'walk' | 'idle' | WorkStyle | Reaction;
type Point = { x: number; y: number };
// Contact, recoil, passing, rise; repeat on the opposite leg. The planted
// boot stays at y=28; passing feet lift, rather than both feet sliding.
const GAIT = [
  { reach: -2, nearLift: 0, farLift: 0, bob: 0 },
  { reach: -1, nearLift: 1, farLift: 0, bob: 1 },
  { reach: 0, nearLift: 2, farLift: 0, bob: 0 },
  { reach: 1, nearLift: 1, farLift: 0, bob: -1 },
  { reach: 2, nearLift: 0, farLift: 0, bob: 0 },
  { reach: 1, nearLift: 0, farLift: 1, bob: 1 },
  { reach: 0, nearLift: 0, farLift: 2, bob: 0 },
  { reach: -1, nearLift: 0, farLift: 1, bob: -1 },
] as const;

/** All coordinates below stay on the original 20×30 body grid. */
function drawFrame(look: Look, facing: Facing, mode: Mode, phase: number): Painter {
  const p = new Painter(FRAME_W, FRAME_H);
  const mirror = facing === 'right';
  const f = mirror ? 'left' : facing;
  const side = f === 'left', back = f === 'up';
  let lean = 0;
  const px = (x: number, y: number, c: string) => {
    const sourceX = x + 6 + lean;
    p.px(mirror ? FRAME_W - 1 - sourceX : sourceX, y + 5, c);
  };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) px(x + k, y + j, c);
  };
  const stroke = (a: Point, b: Point, color: string, width = 2) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let i = 0; i <= steps; i++) rect(Math.round(a.x + (b.x - a.x) * i / steps), Math.round(a.y + (b.y - a.y) * i / steps), width, width, color);
  };
  const walking = mode === 'walk', idle = mode === 'idle', sitting = mode === 'sit';
  const reaction = mode === 'complete' || mode === 'fail';
  const working = !walking && !idle && !sitting && !reaction;
  const gait = GAIT[walking ? phase : 2]!;
  const oy = sitting ? 3 : walking ? gait.bob : mode === 'fail' ? [0, 1, 2, 0][phase]! : 0;
  const headDip = mode === 'complete' ? [0, -1, -1, 0][phase]!
    : mode === 'fail' ? [0, 1, 1, 1][phase]!
    : working && (mode === 'read' || mode === 'desk') && phase === 2 ? 1 : 0;
  const blink = (idle || sitting) && phase === 2 || reaction && phase === 2;
  const hairDark = shade(look.hair, 0.7);
  const skinDark = shade(look.skin, 0.82);
  const pantsDark = shade(look.pants, 0.78);
  const hand = (point: Point, far = false) => rect(point.x, point.y, 2, 2, far ? skinDark : look.skin);

  // Legs keep the original foot spacing and grounded baseline. Side legs
  // separate fore/aft; front/back legs instead project that depth vertically.
  const leg = (hipX: number, footX: number, lift: number, far: boolean) => {
    stroke({ x: hipX, y: 21 }, { x: footX, y: 26 - lift }, far ? pantsDark : look.pants, 3);
    rect(footX - (side ? 1 : 0), 26 - lift, 4, 3, far ? BOOT_DARK : BOOT);
    rect(footX - (side ? 1 : 0), 28 - lift, 4, 1, BOOT_DARK);
  };
  if (sitting) {
    rect(side ? 4 : 5, 24, side ? 9 : 10, 3, look.pants);
    rect(side ? 3 : 5, 26, 3, 3, BOOT);
    rect(side ? 8 : 12, 26, 3, 3, BOOT);
    rect(side ? 3 : 5, 28, 3, 1, BOOT_DARK);
    rect(side ? 8 : 12, 28, 3, 1, BOOT_DARK);
  } else if (side) {
    leg(10, 10 - (walking ? gait.reach : 0), walking ? gait.farLift : 0, true);
    leg(7, 7 + (walking ? gait.reach : 0), walking ? gait.nearLift : 0, false);
  } else {
    leg(5, 5, walking ? gait.nearLift : 0, back);
    leg(11, 11, walking ? gait.farLift : 0, !back);
  }

  // A weight transfer, not a perpetual vertical idle bounce.
  lean = idle && (phase === 1 || phase === 2) ? (side ? -1 : 1)
    : mode === 'fail' && phase === 2 && side ? -1 : 0;
  const shoulder = 13 + oy;
  let handL: Point = { x: side ? 5 : 3, y: shoulder + 6 };
  let handR: Point = { x: side ? 12 : 15, y: shoulder + 6 };
  if (walking) {
    if (side) {
      // Oppose the near leg. Far arm is the same length, only shaded/occluded.
      handL = { x: 5 - gait.reach, y: shoulder + (Math.abs(gait.reach) === 2 ? 5 : 6) };
      handR = { x: 12 + gait.reach, y: handL.y };
    } else {
      const swing = [1, 1, 0, -1, -1, -1, 0, 1][phase]!;
      handL = { x: 3 - swing, y: shoulder + 6 - Math.abs(swing) };
      handR = { x: 15 - swing, y: shoulder + 6 - Math.abs(swing) };
    }
  } else if (sitting) {
    handL = { x: side ? 3 : 5, y: 22 };
    handR = { x: side ? 9 : 13, y: 22 };
  } else if (reaction) {
    // Completion: chin up and one open-hand acknowledgement. Failure:
    // both shoulders fold inward with the head down. Never the same shrug.
    const lift = [0, 1, 2, 0][phase]!;
    if (mode === 'complete') {
      const raised = phase === 1 || phase === 2;
      if (side) handL = { x: raised ? 2 : 5, y: shoulder + [5, 3, 2, 6][phase]! };
      else handR = { x: raised ? 18 : 15, y: shoulder + [5, 3, 2, 6][phase]! };
    } else {
      handL = { x: (side ? 5 : 3) + lift, y: shoulder + 6 - lift };
      handR = { x: (side ? 12 : 15) - lift, y: shoulder + 6 - lift };
    }
  } else if (working) {
    // Hands are authored with the prop, not independent decorative pixels.
    // Up-facing work is offset at the shoulder so the action is not hidden
    // under a large hat or painted implausibly across the resident's back.
    if (side) {
      switch (mode) {
        case 'hammer': handL = [{x:0,y:13},{x:-1,y:10},{x:0,y:17},{x:2,y:16}][phase]!; break;
        case 'read': handL = [{x:1,y:17},{x:1,y:16},{x:2,y:15},{x:2,y:18}][phase]!; break;
        case 'bellows': handL = [{x:1,y:14},{x:0,y:15},{x:2,y:18},{x:2,y:16}][phase]!; break;
        case 'parcel': handL = [{x:3,y:18},{x:2,y:16},{x:0,y:16},{x:2,y:18}][phase]!; break;
        case 'gaze': handL = [{x:3,y:11},{x:3,y:10},{x:2,y:10},{x:4,y:12}][phase]!; break;
        case 'desk': handL = [{x:1,y:17},{x:0,y:16},{x:2,y:17},{x:3,y:15}][phase]!; break;
        case 'haggle': handL = [{x:3,y:18},{x:0,y:16},{x:1,y:14},{x:4,y:17}][phase]!; break;
      }
      if (mode === 'read' || mode === 'parcel' || mode === 'bellows') handR = { x: handL.x + 4, y: handL.y };
    } else {
      switch (mode) {
        case 'hammer': handR = [{x:18,y:13},{x:20,y:10},{x:17,y:18},{x:18,y:16}][phase]!; break;
        case 'read':
          handL = {x:back ? 3 : 5,y:[17,16,17,18][phase]!};
          handR = {x:back ? 16 : [13,13,12,13][phase]!,y:[17,16,14,18][phase]!}; break;
        case 'bellows':
          handL = {x:back ? 3 : 5,y:[15,16,18,17][phase]!};
          handR = {x:back ? 17 : 13,y:[15,16,18,17][phase]!}; break;
        case 'parcel':
          handL = {x:back ? 3 : 5,y:[18,17,16,18][phase]!};
          handR = {x:back ? [16,16,17,16][phase]! : 13,y:handL.y}; break;
        case 'gaze': handR = [{x:15,y:12},{x:15,y:10},{x:16,y:10},{x:16,y:13}][phase]!; break;
        case 'desk': handR = [{x:15,y:17},{x:16,y:16},{x:14,y:17},{x:16,y:14}][phase]!; handL = {x:5,y:18}; break;
        case 'haggle': handR = [{x:15,y:18},{x:18,y:16},{x:17,y:14},{x:14,y:17}][phase]!; break;
      }
    }
  }

  // Equal upper-arm and forearm segments. Bend the elbow with a fixed-length
  // two-link construction; projection may shorten reach, never the anatomy.
  const arm = (start: Point, end: Point, far: boolean) => {
    const dx = end.x - start.x, dy = end.y - start.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const bend = Math.sqrt(Math.max(0, 3 * 3 - distance * distance / 4));
    const direction = start.x < 10 ? 1 : -1;
    const elbow = { x: Math.round((start.x + end.x) / 2 - direction * dy / distance * bend),
      y: Math.round((start.y + end.y) / 2 + direction * dx / distance * bend) };
    const color = look.sleeve ? (far ? shade(look.sleeve, 0.8) : look.sleeve) : far ? look.cloth2 : look.cloth;
    stroke(start, elbow, color);
    stroke(elbow, end, color);
    hand(end, far);
  };
  // Side arm is behind the torso; equal sleeve/hand length, darker plane.
  if (side) arm({x:working && (mode === 'read' || mode === 'parcel' || mode === 'bellows') ? 9 : 12,y:shoulder}, handR, true);

  const torsoTop = 12 + oy;
  const garment = look.garment ?? (look.apron ? 'coat' : 'tunic');
  const hem = garment === 'jacket' ? 19 : garment === 'tunic' ? 21 : 24;
  const tx = side ? 6 : 5, tw = side ? 8 : 10;
  const hemFollow = walking ? [0,0,-1,-1,0,0,1,1][phase]! : 0;
  // A styled figure wears its shell on the body and keeps the profile colour for the panels drawn over it.
  const baseCloth = look.style ? (look.shell ?? look.cloth) : look.cloth;
  const baseCloth2 = look.style ? shade(baseCloth, 0.72) : look.cloth2;
  rect(tx, torsoTop, tw, hem - 12, baseCloth);
  rect(tx + tw - 2, torsoTop + 1, 2, hem - 13, baseCloth2);
  if (garment === 'jacket') {
    // Cropped square hem, lapels and a visible trouser waistband.
    rect(tx, 18 + oy, tw, 1, baseCloth2);
    rect(tx, 19 + oy, tw, 2, look.pants);
    if (!back) { rect(side ? 6 : 8, 13 + oy, 1, 3, baseCloth2); rect(side ? 7 : 11, 13 + oy, 1, 2, baseCloth2); }
  } else {
    // Tunic flares once; coat has a longer split skirt, not a larger body.
    const follow = hemFollow;
    rect(tx - 1 + follow, hem - 3 + oy, tw + 2, 2, baseCloth);
    rect(tx - 1 + follow, hem - 1 + oy, tw + 2, 1, baseCloth2);
    if (garment === 'coat') rect(side ? 9 : 9 + follow, 21 + oy, 2, 3, look.pants);
  }
  if (look.apron && !back) {
    rect(side ? 6 : 7, torsoTop + 2, side ? 5 : 6, 9, APRON);
    rect(side ? 6 : 7, torsoTop + 2, side ? 5 : 6, 1, APRON_DARK);
    rect(side ? 6 : 7, torsoTop + 10, side ? 5 : 6, 1, APRON_DARK);
  }
  const follow = walking ? [0,1,1,0,0,-1,-1,0][phase]! : 0;
  if (look.satchel !== false) {
    if (!side) {
      for (let i = 0; i < 7; i++) px(back ? 6 + i : 13 - i, torsoTop + i, STRAP);
      rect(back ? 13 : 4, torsoTop + 6 + follow, 3, 3, STRAP);
      px(back ? 14 : 5, torsoTop + 6 + follow, HAT);
    } else {
      rect(11, torsoTop, 2, 7, STRAP);
      rect(12, torsoTop + 6 + follow, 3, 3, STRAP);
      px(13, torsoTop + 6 + follow, HAT);
    }
  }
  if (look.belt) {
    rect(tx, torsoTop + 6, tw, 1, STRAP);
    if (!back) rect(side ? 8 : 9, torsoTop + 6, side ? 1 : 2, 1, BUCKLE);
  }
  if (look.sash) {
    // A baldric from one shoulder to the opposite hip: a bold two-tone band that reads at overview scale.
    const edge = look.hatColor ?? INK;
    const span = side ? 4 : tw - 5, rows = 10;
    for (let i = 0; i < rows; i++) {
      const sx = (back ? tx + 1 + span - Math.round((i * span) / (rows - 1)) : tx + 1 + Math.round((i * span) / (rows - 1)));
      rect(sx, torsoTop + i, 3, 1, look.sash);
      px(back ? sx + 3 : sx - 1, torsoTop + i, edge);
    }
  }
  if (look.hemBand && garment === 'coat') {
    rect(tx - 1 + hemFollow, hem - 3 + oy, tw + 2, 2, look.hemBand);
    rect(tx - 1 + hemFollow, hem - 1 + oy, tw + 2, 1, look.hatColor ?? INK);
  }
  if (look.trim) {
    // Collar, lapels and hem in the kit's edging colour. The body colour is untouched.
    const trim = look.trim;
    if (!back) {
      rect(tx + (side ? 0 : 2), torsoTop, tw - (side ? 0 : 4), 1, trim);
      if (garment !== 'tunic') { rect(tx, torsoTop, 1, hem - 14, trim); if (!side) rect(tx + tw - 1, torsoTop, 1, hem - 14, trim); }
      else if (!side) { px(tx + 4, torsoTop + 1, trim); px(tx + 5, torsoTop + 1, trim); }
    }
    // The hem line follows the garment's own sway; a jacket has no flare, so its edge stays on the torso.
    if (garment === 'jacket') rect(tx, hem - 1 + oy, tw, 1, trim);
    else rect(tx - 1 + hemFollow, hem - 1 + oy, tw + 2, 1, trim);
  }
  if (look.style) drawStyledTorso(look, { px, rect, side, back, torsoTop, tx, tw, oy, hemFollow, walking });
  if (!side) arm({x:15,y:shoulder}, handR, false);
  arm({x:side ? 5 : 3,y:shoulder}, handL, false);

  // ------------------------------------------------------------- head
  const headTop = 2 + oy + headDip;
  const faceX = side ? 6 : 5, faceW = side ? 8 : 10;
  if (back) {
    rect(5, headTop, 10, 10, look.hairStyle === 'bald' ? look.skin : look.hair);
    rect(5, headTop + 8, 10, 2, look.hairStyle === 'bald' ? skinDark : hairDark);
    if (look.hairStyle === 'long') { rect(5, headTop + 10, 10, 3, look.hair); rect(5, headTop + 12, 10, 1, hairDark); }
    if (look.hairStyle === 'bun') rect(8, headTop - 2, 4, 2, look.hair);
  } else {
    rect(faceX, headTop + 1, faceW, 9, look.skin);
    rect(faceX + faceW - 1, headTop + 2, 1, 7, skinDark);
    rect(faceX, headTop + 9, faceW, 1, skinDark);
    if (side) rect(faceX + 1, headTop + 5 + (blink ? 1 : 0), blink ? 2 : 1, blink ? 1 : 2, INK);
    else { rect(faceX + 2, headTop + 5 + (blink ? 1 : 0), blink ? 2 : 1, blink ? 1 : 2, INK); rect(faceX + faceW - 3, headTop + 5 + (blink ? 1 : 0), blink ? 2 : 1, blink ? 1 : 2, INK); }
    if (look.beard) { rect(faceX + 1, headTop + 8, faceW - 2, 2, look.hair); rect(faceX + 1, headTop + 9, faceW - 2, 1, hairDark); }
    if (look.hairStyle !== 'bald') {
      rect(faceX, headTop, faceW, 2, look.hair);
      rect(faceX, headTop, faceW, 1, hairDark);
      const drape = look.hairStyle === 'long' ? 10 : 4;
      if (side) { rect(faceX + faceW - 1, headTop + 1, 2, drape + 1, look.hair); px(faceX + faceW, headTop + 1, hairDark); }
      else { rect(faceX - 1, headTop + 1, 1, drape, look.hair); rect(faceX + faceW, headTop + 1, 1, drape, look.hair); }
      if (look.hairStyle === 'bun') rect(side ? faceX + faceW : faceX + 2, headTop - 2, 3, 2, look.hair);
      if (look.hairStyle === 'mohawk') rect(faceX + 3, headTop - 2, 2, 3, look.hair);
    } else {
      rect(faceX, headTop, faceW, 1, skinDark);
    }
  }
  const brimY = headTop + 1;
  switch (look.hat) {
    case 'brim': {
      const hat = look.hatColor ?? HAT, hatDark = look.hatColor ? shade(hat, 0.7) : HAT_DARK, hatLight = shade(hat, 1.15);
      // A plumed hat is the festive one: a wider brim and a taller crown than the plain straw hat.
      const wide = look.plume ? 2 : 0, tall = look.plume ? 1 : 0;
      rect((side ? 1 : 2) - wide / 2, brimY, (side ? 17 : 16) + wide, 2, hat);
      rect((side ? 1 : 2) - wide / 2, brimY + 1, (side ? 17 : 16) + wide, 1, hatDark);
      rect(5, headTop - 2 - tall, 10, 3 + tall, hat);
      rect(5, headTop - 2 - tall, 10, 1, hatLight);
      rect(5, headTop, 10, 1, look.trim ?? hatDark);
      if (look.plume) { rect(12, headTop - 5, 2, 4, look.plume); px(13, headTop - 6, look.plume); px(11, headTop - 3, shade(look.plume, 0.7)); px(14, headTop - 4, shade(look.plume, 0.7)); }
      break;
    }
    case 'cap':
      rect(faceX - 1, headTop - 1, faceW + 2, 3, look.cloth2);
      if (side) rect(faceX - 3, headTop + 1, 3, 1, look.cloth2); else rect(faceX - 1, headTop + 2, faceW + 2, 1, look.cloth2);
      break;
    case 'hood':
      rect(faceX - 1, headTop - 1, faceW + 2, 3, look.cloth2);
      rect(faceX - 1, headTop + 2, 1, 7, look.cloth2); rect(faceX + faceW, headTop + 2, 1, 7, look.cloth2);
      break;
    case 'band':
      rect(faceX, headTop + 2, faceW, 1, BUCKLE);
      break;
    case 'goggles':
      rect(faceX, headTop + 1, faceW, 2, INK);
      px(faceX + 1, headTop + 1, '#7fb2dd'); if (!side) px(faceX + 5, headTop + 1, '#7fb2dd');
      break;
    case 'visor':
    case 'helmet':
      drawStyledHead(look, { px, rect, side, back, headTop, faceX, faceW });
      break;
    default:
      break;
  }

  // Props share the exact wrist coordinates above. No detached dust/spark
  // substitutes for hand motion. Bellows has leather folds, not a hammer.
  if (working) {
    const grip = side ? handL : handR;
    if (mode === 'hammer') {
      if (phase <= 1) {
        rect(grip.x, grip.y - 5, 1, 6, STRAP);
        rect(grip.x - 2, grip.y - 7, side ? 4 : 5, 3, '#8b9090');
        rect(grip.x - 2, grip.y - 7, side ? 4 : 5, 1, '#b5b8b8');
      } else if (phase === 2) {
        if (side) {
          rect(grip.x - 3, grip.y, 4, 1, STRAP);
          rect(grip.x - 4, grip.y - 1, 3, 4, '#8b9090');
          rect(grip.x - 4, grip.y - 1, 3, 1, '#b5b8b8');
        } else {
          rect(grip.x, grip.y, 1, 5, STRAP);
          rect(grip.x - 1, grip.y + 4, 5, 3, '#8b9090');
          rect(grip.x - 1, grip.y + 4, 5, 1, '#b5b8b8');
        }
      } else {
        stroke(grip, {x:grip.x - 2,y:grip.y - 3}, STRAP, 1);
        rect(grip.x - 4, grip.y - 5, 4, 3, '#8b9090');
        rect(grip.x - 4, grip.y - 5, 4, 1, '#b5b8b8');
      }
    } else if (mode === 'read') {
      const bx = side ? handL.x - 3 : back ? handR.x - 1 : handL.x;
      const by = (back ? handR.y : handL.y) - 2;
      const width = side || back ? 7 : 10;
      rect(bx, by, width, 6, STRAP);
      rect(bx, by, width, 5, '#d8caa2');
      rect(bx + Math.floor(width / 2), by, 1, 5, '#a89a74');
      rect(bx + 1, by + 1, 2, 1, '#a89a74');
      if (phase === 1 || phase === 2) {
        // A page lifted by the moving wrist, then laid over the spine.
        rect(bx + (phase === 1 ? width - 3 : 2), by - (phase === 1 ? 1 : 2), 3, 4, '#f1ead8');
      }
    } else if (mode === 'bellows') {
      const bx = side ? grip.x - 2 : back ? grip.x - 1 : 6;
      const by = grip.y - 1;
      const height = 23 - by;
      rect(bx, by, 6, height, '#78503a');
      for (let y = by + 2; y < 22; y += 2) rect(bx + 1, y, 4, 1, STRAP);
      rect(bx - 1, by, 8, 1, HAT);
      rect(bx - 1, 22, 8, 1, HAT_DARK);
      rect(bx - 2, 21, 2, 1, '#8b9090');
    } else if (mode === 'parcel') {
      const bx = side ? handL.x - 3 : back ? handR.x - 1 : 5;
      const by = (back ? handR.y : handL.y) - 4;
      const width = side || back ? 7 : 10;
      rect(bx, by, width, 6, '#9f7950');
      rect(bx, by, width, 1, '#c0955f');
      rect(bx + Math.floor(width / 2), by, 1, 6, '#d5be89');
      rect(bx, by + 3, width, 1, '#d5be89');
    } else if (mode === 'gaze') {
      if (side) {
        // Bring to eye, focus, scan left, lower. The eyepiece meets the face.
        const gy = grip.y - 1;
        rect(grip.x - 5, gy, 9, 2, '#b99a58');
        rect(grip.x - 6, gy - 1, 2, 4, '#8a7a3a');
        rect(grip.x - 6, gy, 1, 2, '#7fb2dd');
        rect(grip.x + 2, gy, 1, 2, STRAP);
      } else {
        // End-on telescope is shorter through perspective, same moving grip.
        rect(grip.x - 1, grip.y - 2, 4, 4, '#8a7a3a');
        rect(grip.x, grip.y - 1, 2, 2, '#b99a58');
        rect(grip.x, grip.y - 1, 1, 1, '#7fb2dd');
        rect(grip.x + 1, grip.y + 1, 1, 2, STRAP);
      }
    } else if (mode === 'desk') {
      // Quill strokes travel with the wrist; phase 3 lifts clear of the page.
      rect(grip.x, grip.y - 4, 1, 6, '#c9b58f');
      rect(grip.x + 1, grip.y - 4, 1, 3, '#e0d3a0');
      px(grip.x, grip.y + 2, INK);
    } else if (mode === 'haggle') {
      // A held coin offered, turned in the palm, considered, withdrawn.
      rect(grip.x, grip.y - 2, phase === 2 ? 1 : 2, 2, BUCKLE);
      px(grip.x, grip.y - 2, '#f0d68b');
    }
    // Fingers overlap the held object, preserving its wrist attachment.
    hand(grip);
    if (mode === 'read' || mode === 'parcel' || mode === 'bellows') {
      hand(side ? handR : handL, side);
    }
  }

  outline(p, INK);
  return p;
}

interface StyledDraw {
  px: (x: number, y: number, c: string) => void;
  rect: (x: number, y: number, w: number, h: number, c: string) => void;
  side: boolean; back: boolean;
}

const GOLD = '#ffd36b';

/** The coat, panels, bag and accessories of the 'operative' and 'crew' silhouettes. */
function drawStyledTorso(look: Look, d: StyledDraw & { torsoTop: number; tx: number; tw: number; oy: number; hemFollow: number; walking: boolean }): void {
  const { rect, px, side, back, torsoTop, tx, tw, oy, hemFollow } = d;
  const prof = look.cloth;
  const shell = look.shell ?? look.cloth;
  const dark = shade(shell, 0.55);
  const neon = look.accent ?? '#35e6ff';
  const role = look.role ?? 'general';
  if (look.style === 'operative') {
    // Long coat: tails flare well past the hips and are edged with a neon line, so the figure reads as a tall wedge.
    rect(tx - 2 + hemFollow, 20 + oy, tw + 4, 5, shell);
    rect(tx - 2 + hemFollow, 24 + oy, tw + 4, 1, neon);
    rect(tx - 2 + hemFollow, 23 + oy, tw + 4, 1, dark);
    // Broad shoulder panels, then the chest stripe in the profile colour.
    if (side) rect(tx, torsoTop - 1, 6, 3, prof);
    else { rect(tx - 2, torsoTop - 1, 4, 3, prof); rect(tx + tw - 2, torsoTop - 1, 4, 3, prof); }
    if (back) rect(tx + 1, torsoTop + 3, tw - 2, 9, prof);
    else rect(tx + (side ? 4 : 3), torsoTop + 2, side ? 3 : 4, 11, prof);
    if (!back) { rect(tx + (side ? 4 : 3), torsoTop + 2, side ? 3 : 4, 1, shade(prof, 1.25)); }
    // Belt lights and a hip bag in the profile colour.
    rect(tx, torsoTop + 7, tw, 1, dark);
    px(tx + 1, torsoTop + 7, neon); px(tx + tw - 2, torsoTop + 7, neon);
    if (!back) { rect(tx + tw - (side ? 0 : 1), torsoTop + 9, 3, 4, prof); rect(tx + tw - (side ? 0 : 1), torsoTop + 9, 3, 1, shade(prof, 0.7)); }
    // Role accessories: visual only.
    if (role === 'coordinator') { rect(tx - 2, torsoTop - 2, side ? 6 : 4, 1, GOLD); if (!side) rect(tx + tw - 2, torsoTop - 2, 4, 1, GOLD); }
    else if (role === 'research' && !back) rect(tx + (side ? 0 : 1), torsoTop + 9, 4, 3, '#bfeaff');
    else if (role === 'fabrication') rect(tx - (side ? 0 : 3), torsoTop + 5, 3, 2, '#ff8a3a');
    else if (role === 'review' && !back) { px(tx + 1, torsoTop + 3, GOLD); px(tx + 2, torsoTop + 4, GOLD); }
    else if (role === 'tooling' && !back) { for (let i = 0; i < 6; i++) px(tx + 1 + (i % 6), torsoTop + 2 + i, neon); }
    return;
  }
  // 'crew': a pressure suit with the profile colour as the chest panel, shoulder patches and call-sign stripe.
  if (back) {
    // Back unit: the oxygen pack covers the back and carries the profile stripe.
    rect(tx - 1, torsoTop + 1, tw + 2, 10, '#8c96a8');
    rect(tx - 1, torsoTop + 1, tw + 2, 1, '#c3cbd8');
    rect(tx + 1, torsoTop + 3, tw - 2, 4, prof);
    rect(tx + 2, torsoTop + 8, 2, 3, '#555e70'); rect(tx + tw - 4, torsoTop + 8, 2, 3, '#555e70');
  } else {
    rect(tx + 1, torsoTop + 2, tw - 2, 7, prof);
    rect(tx + 1, torsoTop + 2, tw - 2, 1, shade(prof, 1.25));
    rect(tx + 2, torsoTop + 4, 3, 2, dark); px(tx + 3, torsoTop + 5, neon); px(tx + tw - 4, torsoTop + 5, '#ffd36b');
    rect(tx, torsoTop + 10, tw, 1, prof);
    if (side) rect(tx + tw, torsoTop + 1, 3, 10, '#8c96a8'); // pack behind the shoulder in profile
    else { rect(tx - 2, torsoTop - 1, 2, 4, '#8c96a8'); rect(tx + tw, torsoTop - 1, 2, 4, '#8c96a8'); } // pack top either side of the neck
  }
  rect(tx, torsoTop, side ? 3 : 2, 2, prof); if (!side) rect(tx + tw - 2, torsoTop, 2, 2, prof); // shoulder patches
  rect(tx, 18 + oy, tw, 1, dark); // belt
  if (role === 'research') { rect(tx + tw, torsoTop - 4 - (side ? 0 : 1), 1, 5, '#bfeaff'); px(tx + tw, torsoTop - 5, neon); }
  else if (role === 'fabrication') rect(tx - (side ? 0 : 2), 16 + oy, 3, 2, '#ff8a3a');
  else if (role === 'review' && !back) rect(tx + tw - 4, torsoTop + 11, 4, 2, '#bfeaff');
  else if (role === 'tooling' && !back) { for (let i = 0; i < 7; i++) px(tx + i, torsoTop + 1 + i, neon); }
}

/** The visor of an operative, or the round helmet of a crew member. */
function drawStyledHead(look: Look, d: StyledDraw & { headTop: number; faceX: number; faceW: number }): void {
  const { rect, px, side, back, headTop, faceX, faceW } = d;
  const prof = look.cloth;
  const role = look.role ?? 'general';
  const neon = look.accent ?? '#35e6ff';
  if (look.style === 'crew') {
    const shell = look.shell ?? '#dfe5ee';
    const shellDark = shade(shell, 0.78);
    // A round helmet, wider and taller than a head: rows grow and shrink to a disc.
    const widths = [faceW, faceW + 2, faceW + 4, faceW + 4, faceW + 4, faceW + 4, faceW + 4, faceW + 4, faceW + 4, faceW + 2, faceW + 2];
    widths.forEach((w, i) => {
      const x = faceX - (w - faceW) / 2;
      rect(x, headTop - 2 + i, w, 1, i > 6 ? shellDark : shell);
    });
    if (!back) {
      const gx = side ? faceX + 1 : faceX, gw = side ? faceW - 1 : faceW;
      rect(gx, headTop + 1, gw, 7, '#142038');
      rect(gx, headTop + 1, gw, 1, '#3a5a8a');
      px(gx + 1, headTop + 2, '#9fd0ff'); px(gx + 2, headTop + 2, '#9fd0ff');
      px(gx + 2, headTop + 5, '#ffd9a0'); if (!side) px(gx + gw - 3, headTop + 5, '#ffd9a0');
    }
    rect(faceX - 2, headTop + 9, faceW + 4, 2, prof); // helmet ring in the profile colour
    rect(faceX - 2, headTop + 9, faceW + 4, 1, shade(prof, 1.2));
    if (role === 'coordinator') { rect(faceX + 2, headTop - 3, faceW - 4, 1, GOLD); }
    if (role === 'review' && !back) px(faceX + faceW + 1, headTop - 4, neon);
    return;
  }
  // 'operative': a glowing visor band across the eyes, an earpiece, and a pair of collar wings that widen the neck.
  const glow = shade(prof, 1.3);
  if (!back) {
    const vx = side ? faceX + 1 : faceX - 1, vw = side ? faceW - 1 : faceW + 2;
    rect(vx - 1, headTop + 3, vw + 2, 5, '#10141f');
    rect(vx, headTop + 4, vw, 3, glow);
    rect(vx, headTop + 4, vw, 1, '#ffffff');
  } else {
    rect(faceX, headTop + 4, faceW, 1, glow);
  }
  rect(faceX - 1, headTop + 5, 1, 3, '#10141f'); px(faceX - 1, headTop + 5, neon);
  rect(faceX - 2, headTop + 9, 2, 5, shade(look.shell ?? '#1b2236', 0.8));
  rect(faceX + faceW, headTop + 9, 2, 5, shade(look.shell ?? '#1b2236', 0.8));
  if (role === 'review') rect(faceX - 1, headTop - 4, 1, 4, neon);
  if (role === 'coordinator') rect(faceX, headTop, faceW, 1, GOLD);
}

/** Small emote bubble sprites keyed by name. */
export function paintEmote(kind: 'ok' | 'fail' | 'think' | 'zzz' | 'wait'): HTMLCanvasElement {
  const p = new Painter(12, 12);
  p.disc(6, 5, 5, '#f7f1e3');
  p.rect(4, 10, 2, 2, '#f7f1e3');
  switch (kind) {
    case 'ok': p.px(3, 5, '#3b7a2a'); p.px(4, 6, '#3b7a2a'); p.px(5, 7, '#3b7a2a'); p.px(6, 6, '#3b7a2a'); p.px(7, 5, '#3b7a2a'); p.px(8, 4, '#3b7a2a'); p.px(9, 3, '#3b7a2a'); break;
    case 'fail': p.rect(5, 2, 2, 5, '#b8322a'); p.rect(5, 8, 2, 1, '#b8322a'); break;
    case 'think': p.rect(3, 4, 6, 1, PAL.stone2); p.rect(3, 6, 4, 1, PAL.stone2); break;
    case 'zzz': p.rect(3, 3, 3, 1, PAL.stone2); p.px(4, 4, PAL.stone2); p.rect(3, 5, 3, 1, PAL.stone2); p.rect(7, 5, 3, 1, PAL.stone2); p.px(8, 6, PAL.stone2); p.rect(7, 7, 3, 1, PAL.stone2); break;
    case 'wait': p.rect(4, 2, 4, 1, PAL.stone2); p.rect(4, 8, 4, 1, PAL.stone2); p.px(5, 3, PAL.stone2); p.px(6, 3, PAL.stone2); p.px(5, 7, PAL.stone2); p.px(6, 7, PAL.stone2); p.px(5, 5, PAL.stone2); p.px(6, 5, PAL.stone2); break;
  }
  outline(p, PAL.outline);
  return p.canvas;
}
