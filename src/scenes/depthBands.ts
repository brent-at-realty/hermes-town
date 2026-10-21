/**
 * The scene's depth bands, lowest to highest. One module owns them so no decorative layer can drift above
 * a lifecycle indicator by accident, and so the browser verification audits the same numbers the scene uses.
 *
 *   world       terrain, buildings, props, residents: y-sorted, always below WORLD_MAX
 *   shaft       lift cabins, their passengers and floor indicators ride in the shaft, which is BEHIND the deck slabs:
 *               they sit below every y-sorted resident and prop, and below the deck occluders that follow
 *   occluders   the solid deck slabs of a lift tower, drawn over the shaft band and under every resident, so a cabin
 *               passing a floor is hidden by the slab and shows only in the openings between decks
 *   transport   shuttle craft
 *   effects     every decorative post-process and ambient layer: colour grade, wash, haze, motes, fog, rain,
 *               work sparks, cloud shadow, night. Strictly below SIGN_DEPTH.
 *   signs       building and stall labels
 *   lifecycle   name tags, bubbles, emotes: the resident's state, never covered by anything decorative
 *
 * Nothing painted for atmosphere (including transit visuals) may sit at or above LIFECYCLE_FLOOR.
 */
export const WORLD_MAX = 90000;
export const TRANSIT_DEPTH = 96000;
/** Lift shaft band. All of it is above terrain (-11..-2) and below every resident and prop (their depth is their y). */
export const LIFT_DEPTHS = { car: -0.9, doors: -0.89, passenger: -0.88, indicator: -0.87, occluder: -0.8 } as const;
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
