import type { EnvironmentProfile, MotionChoice, TimeId, WeatherId } from './types';

export const TIME_OPTIONS: readonly { id: TimeId; label: string; hour: number | null }[] = [
  { id: 'auto', label: 'Follow the clock', hour: null },
  { id: 'morning', label: 'Morning', hour: 8 },
  { id: 'noon', label: 'Midday', hour: 13 },
  { id: 'evening', label: 'Evening', hour: 18.5 },
  { id: 'night', label: 'Night', hour: 23 },
];

export interface WeatherProfile {
  id: WeatherId;
  label: string;
  /** Added to the haze alpha. */
  haze: number;
  /** Added to the overall darkness, before the theme's cap. */
  dim: number;
  /** Decorative rain streaks. Never shown under reduced motion. */
  rain: boolean;
}

export const WEATHER_OPTIONS: readonly WeatherProfile[] = [
  { id: 'clear', label: 'Clear', haze: 0, dim: 0, rain: false },
  { id: 'mist', label: 'Mist', haze: 0.22, dim: 0.04, rain: false },
  { id: 'rain', label: 'Rain', haze: 0.12, dim: 0.1, rain: true },
];

export const MOTION_OPTIONS: readonly { id: MotionChoice; label: string }[] = [
  { id: 'system', label: 'Follow my system setting' },
  { id: 'reduced', label: 'Reduce motion' },
  { id: 'full', label: 'Full motion' },
];

/** Decorative scale factors when motion is reduced. Residents are not scaled. */
export const REDUCED_MOTION = { sway: 0.15, drift: 0.2, particles: 0.3 } as const;

/**
 * The viewer's motion choice plus the system `prefers-reduced-motion` value.
 * "system" follows the browser; an explicit choice always wins.
 */
export function resolveReducedMotion(choice: MotionChoice, systemPrefersReduced: boolean): boolean {
  if (choice === 'reduced') return true;
  if (choice === 'full') return false;
  return systemPrefersReduced;
}

/** Everything the renderer needs for the atmosphere, as plain numbers. */
export interface ResolvedEnvironment {
  time: TimeId;
  /** Fixed hour, or null to follow the viewer's clock. */
  hour: number | null;
  weather: WeatherId;
  reducedMotion: boolean;
  grade: EnvironmentProfile['grade'];
  night: EnvironmentProfile['night'];
  extraDim: number;
  lampGlow: number;
  windSway: number;
  cloudCount: number;
  cloudAlpha: number;
  cloudDrift: number;
  hazeColor: [number, number, number];
  hazeAlpha: number;
  /** Multiplier for the rate of decorative particles. */
  particleRate: number;
  fountain: boolean;
  idleSmoke: boolean;
  rain: boolean;
  motes: { count: number; color: number; alpha: number } | null;
}

export function resolveEnvironment(profile: EnvironmentProfile, time: TimeId | 'theme', weather: WeatherId | 'theme', reducedMotion: boolean): ResolvedEnvironment {
  const timeId = time === 'theme' ? profile.time : time;
  const weatherId = weather === 'theme' ? profile.weather : weather;
  const t = TIME_OPTIONS.find((o) => o.id === timeId) ?? TIME_OPTIONS[0]!;
  const w = WEATHER_OPTIONS.find((o) => o.id === weatherId) ?? WEATHER_OPTIONS[0]!;
  const rm = reducedMotion;
  return {
    time: t.id,
    hour: t.hour,
    weather: w.id,
    reducedMotion: rm,
    grade: profile.grade,
    night: profile.night,
    extraDim: w.dim,
    lampGlow: profile.lampGlow,
    windSway: profile.wind.sway * (rm ? REDUCED_MOTION.sway : 1),
    cloudCount: profile.clouds.count,
    cloudAlpha: profile.clouds.alpha,
    cloudDrift: profile.clouds.drift * (rm ? REDUCED_MOTION.drift : 1),
    hazeColor: profile.haze.color,
    hazeAlpha: Math.min(0.6, profile.haze.alpha + w.haze),
    particleRate: rm ? REDUCED_MOTION.particles : 1,
    fountain: profile.fountain,
    idleSmoke: profile.idleSmoke,
    // Rain is movement by definition: reduced motion keeps the dimming and haze but drops the streaks.
    rain: w.rain && !rm,
    motes: profile.motes && !rm ? profile.motes : null,
  };
}
