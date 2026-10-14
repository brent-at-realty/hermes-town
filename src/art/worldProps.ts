import { Painter } from './painter';

/**
 * Workstation props of the Cyber City and Orbital System worlds. Each is drawn on a one-texel grid at its anchor
 * size (see `PROP_ANCHORS`) and rendered at two pixels per texel, like every other prop. They are plain pixel
 * art, bundled in code: no remote or untrusted asset is ever loaded.
 */

type Draw = (x: number, y: number, w: number, h: number, c: string) => void;

function canvasFor(w: number, h: number): { p: Painter; g: Draw } {
  const p = new Painter(w * 2, h * 2);
  const g: Draw = (x, y, rw, rh, c) => p.rect(x * 2, y * 2, rw * 2, rh * 2, c);
  return { p, g };
}

const INK = '#0b1020';
const HULL = '#2a3350';
const HULL_LIGHT = '#46547e';
const CYAN = '#35e6ff';
const MAGENTA = '#ff3fa4';
const AMBER = '#ffb347';
const WHITE = '#e8f6ff';

function paintTerminal(): HTMLCanvasElement {
  const { p, g } = canvasFor(16, 18);
  g(5, 10, 6, 8, HULL); g(3, 16, 10, 2, INK); g(4, 15, 8, 1, HULL_LIGHT);
  g(1, 2, 14, 9, INK); g(2, 3, 12, 7, '#0c2a3a');
  g(3, 4, 7, 1, CYAN); g(3, 6, 9, 1, '#1e9bb8'); g(3, 8, 5, 1, CYAN); g(11, 8, 2, 1, MAGENTA);
  g(1, 2, 14, 1, HULL_LIGHT);
  g(0, 5, 1, 3, AMBER); g(15, 5, 1, 3, AMBER);
  return p.canvas;
}

function paintFabBay(): HTMLCanvasElement {
  const { p, g } = canvasFor(24, 17);
  g(1, 11, 22, 6, HULL); g(1, 11, 22, 1, HULL_LIGHT); g(2, 16, 3, 1, INK); g(19, 16, 3, 1, INK);
  g(3, 9, 8, 3, '#1a2036'); g(4, 8, 6, 1, AMBER);
  g(13, 2, 2, 9, '#ff8a3a'); g(13, 2, 8, 2, '#ff8a3a'); g(19, 3, 2, 5, '#c0612a'); g(19, 8, 2, 1, WHITE);
  g(14, 10, 8, 1, CYAN);
  g(3, 5, 5, 3, INK); g(4, 6, 3, 1, CYAN);
  g(10, 0, 1, 2, WHITE);
  return p.canvas;
}

function paintFoundryRig(): HTMLCanvasElement {
  const { p, g } = canvasFor(22, 18);
  g(2, 6, 18, 12, '#1d2438'); g(2, 6, 18, 1, HULL_LIGHT);
  g(5, 9, 12, 6, '#0a0e1a'); g(6, 10, 10, 4, '#ff6a2a'); g(8, 11, 6, 2, '#ffd36b');
  g(15, 0, 3, 7, HULL); g(14, 0, 5, 1, HULL_LIGHT);
  g(3, 16, 16, 2, INK);
  g(1, 8, 1, 6, AMBER); g(20, 8, 1, 6, AMBER);
  return p.canvas;
}

function paintDispatchDock(): HTMLCanvasElement {
  const { p, g } = canvasFor(18, 16);
  g(1, 13, 16, 3, HULL); g(1, 13, 16, 1, HULL_LIGHT); g(3, 14, 12, 1, MAGENTA);
  g(4, 8, 10, 3, '#3a2450'); g(3, 7, 3, 2, MAGENTA); g(12, 7, 3, 2, MAGENTA); g(8, 5, 2, 3, WHITE);
  g(6, 9, 6, 1, CYAN);
  g(6, 11, 6, 2, '#c9955a'); g(6, 11, 6, 1, '#e8c090');
  return p.canvas;
}

function paintScopeArray(): HTMLCanvasElement {
  const { p, g } = canvasFor(18, 20);
  g(8, 10, 2, 8, HULL); g(4, 17, 4, 2, HULL); g(10, 17, 4, 2, HULL); g(3, 19, 12, 1, INK);
  g(2, 3, 13, 5, '#cdd6e8'); g(1, 4, 2, 3, HULL_LIGHT); g(2, 3, 13, 1, WHITE);
  g(14, 2, 3, 7, HULL); g(15, 3, 1, 5, CYAN);
  g(4, 1, 4, 2, AMBER); g(5, 0, 2, 1, WHITE);
  return p.canvas;
}

function paintCommandConsole(): HTMLCanvasElement {
  const { p, g } = canvasFor(24, 14);
  g(1, 7, 22, 7, HULL); g(1, 7, 22, 1, HULL_LIGHT); g(2, 13, 20, 1, INK);
  g(2, 1, 6, 6, INK); g(3, 2, 4, 4, '#0c2a3a'); g(3, 3, 4, 1, CYAN); g(3, 5, 3, 1, CYAN);
  g(9, 0, 6, 7, INK); g(10, 1, 4, 5, '#2a0c24'); g(10, 2, 4, 1, MAGENTA); g(10, 4, 3, 1, MAGENTA);
  g(16, 1, 6, 6, INK); g(17, 2, 4, 4, '#0c2a3a'); g(17, 3, 2, 2, AMBER); g(19, 3, 2, 1, CYAN);
  for (let i = 0; i < 6; i++) g(3 + i * 3, 9, 2, 1, i % 2 ? AMBER : CYAN);
  return p.canvas;
}

function paintLoungeSeat(): HTMLCanvasElement {
  const { p, g } = canvasFor(18, 13);
  g(1, 4, 16, 9, '#3a2a6a'); g(1, 4, 16, 3, '#5a3ea0'); g(0, 6, 2, 7, '#2a1c4a'); g(16, 6, 2, 7, '#2a1c4a');
  g(2, 12, 14, 1, MAGENTA);
  g(6, 0, 6, 4, '#1a2036'); g(7, 1, 4, 1, CYAN);
  return p.canvas;
}

function paintKiosk(): HTMLCanvasElement {
  const { p, g } = canvasFor(22, 18);
  g(1, 8, 20, 10, HULL); g(1, 8, 20, 1, HULL_LIGHT); g(2, 17, 18, 1, INK);
  g(0, 2, 22, 5, MAGENTA); g(0, 2, 22, 1, '#ff8ac8');
  for (let i = 0; i < 6; i++) g(i * 4, 2, 2, 5, i % 2 ? AMBER : '#ff3fa4');
  g(3, 10, 16, 5, '#0c2a3a'); g(4, 11, 6, 1, CYAN); g(4, 13, 10, 1, '#1e9bb8'); g(13, 11, 4, 1, AMBER);
  return p.canvas;
}

export const WORLD_PROP_PAINTERS: Readonly<Record<string, () => HTMLCanvasElement>> = {
  terminal: paintTerminal,
  fabBay: paintFabBay,
  foundryRig: paintFoundryRig,
  dispatchDock: paintDispatchDock,
  scopeArray: paintScopeArray,
  commandConsole: paintCommandConsole,
  loungeSeat: paintLoungeSeat,
  kiosk: paintKiosk,
};

export function paintWorldProp(key: string): HTMLCanvasElement {
  const paint = WORLD_PROP_PAINTERS[key];
  if (!paint) throw new Error(`no world prop painter for ${key}`);
  return paint();
}
