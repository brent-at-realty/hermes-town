/**
 * The scene's depth bands, lowest to highest. One module owns them so no decorative layer can drift above
 * a lifecycle indicator by accident, and so the browser verification audits the same numbers the scene uses.
 *
 *   world       terrain, buildings, props, residents: y-sorted, always below WORLD_MAX
 *   transport   shuttle craft; lift cars sort with their rider inside the world band
 *   effects     every decorative post-process and ambient layer: colour grade, wash, haze, motes, fog, rain,
 *               work sparks, cloud shadow, night. Strictly below SIGN_DEPTH.
 *   signs       building and stall labels
 *   lifecycle   name tags, bubbles, emotes: the resident's state, never covered by anything decorative
 *
 * Nothing painted for atmosphere (including transit visuals) may sit at or above LIFECYCLE_FLOOR.
 */
export const WORLD_MAX = 90000;
export const TRANSIT_DEPTH = 96000;
export const EFFECT_DEPTHS = {
  grade: 97500,
  gradeAdd: 97501,
  wash: 97600,
  haze: 98000,
  motes: 98500,
  fog: 99000,
  rain: 99500,
  sparks: 99600,
  clouds: 99700,
  night: 99800,
} as const;
export const EFFECT_CEILING = 99999;
export const SIGN_DEPTH = 100000;
export const STALL_SIGN_DEPTH = 100001;
export const LIFECYCLE_DEPTHS = { name: 150000, bubbleBg: 160000, bubble: 160001, emote: 160002 } as const;
export const LIFECYCLE_FLOOR = LIFECYCLE_DEPTHS.name;
