import { mulberry } from './painter';

/** Small canvas-2D helpers shared by the Cyber City and Orbital System painters. Everything is drawn in world pixels at two canvas pixels per world pixel. */

export const SCALE = 2;

export interface Surface { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }

export function surface(wPx: number, hPx: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wPx * SCALE); canvas.height = Math.ceil(hPx * SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  return { canvas, ctx };
}

export function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
}

export function vgrad(ctx: CanvasRenderingContext2D, y0: number, y1: number, stops: readonly [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

export function hgrad(ctx: CanvasRenderingContext2D, x0: number, x1: number, stops: readonly [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/** A soft additive glow of a colour. */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, colour); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** Neon strip: a bright core with a soft halo. */
export function neon(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.save();
  ctx.shadowColor = colour; ctx.shadowBlur = 8;
  ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x, y, w, Math.max(0.5, Math.min(1, h * 0.35)));
  ctx.restore();
}

export function neonText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string, size = 9, align: CanvasTextAlign = 'center'): void {
  ctx.save();
  ctx.font = `bold ${size}px monospace`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = colour; ctx.shadowBlur = 7;
  ctx.fillStyle = colour; ctx.fillText(text, x, y);
  ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(text, x, y - 0.3);
  ctx.restore();
}

export function rng(seed: number): () => number { return mulberry(seed); }
