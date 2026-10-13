import type { TownTheme } from './types';

/**
 * The original Town, moved here unchanged. Every value was a literal in
 * `style.css`, `main.ts` or `TownScene.ts` before themes existed, and
 * `tests/verify-themes.mjs` pins them so the baseline cannot drift quietly.
 */
export const CLASSIC: TownTheme = {
  id: 'classic',
  label: 'Classic',
  description: 'Warm late light over the original town and countryside.',
  preview: ['#1a1620', '#c9b391', '#6b3d2a', '#f0c27a'],
  ui: {
    canvasBackground: '#1a1620',
    page: '#14111a',
    text: '#e9dfc8',
    textStrong: '#f3e6c9',
    textMuted: '#a8917a',
    accent: '#f0c27a',
    accentSoft: '#c9b58f',
    panel: 'rgba(20,17,26,.82)',
    panelSolid: 'rgba(20,17,26,.9)',
    panelBorder: '#4a3b33',
    divider: '#2f2632',
    button: '#2a2230',
    buttonHover: '#3a2f40',
    buttonBorder: '#5a4838',
    buttonOn: '#7a4a2a',
    buttonOnBorder: '#c98a4a',
    statusOk: '#9fd08a',
    statusDemo: '#d8b978',
    statusBad: '#e08a6a',
    focus: '#ffd36b',
    minimap: {
      background: '#1a1620',
      water: '#2f5566', cobble: '#6f6a68', path: '#8a6a44', trail: '#6f6a3e',
      grassDry: '#7a7a3c', grassWet: '#3f5a30', ledge: '#5a4a3e', grass: '#4f6b34',
      tree: '#2f5228', house: '#6b3d2a', building: '#c9b391',
      dot: '#f3e6c9', dotChild: '#c9b58f', dotSelected: '#ffd36b', viewport: 'rgba(255,255,255,0.7)',
    },
    scene: {
      label: '#e9dfc8', labelBackground: 'rgba(20,17,26,0.7)', stallLabel: '#f3e6c9',
      name: '#f3e6c9', nameSelected: '#ffd36b', nameRunner: '#a9c4d6', nameScheduled: '#9fd0e0', nameChild: '#c9b58f', nameMemory: '#8f8677',
      bubbleText: '#1a1418', bubbleFill: 0xf7f1e3, bubbleStroke: 0x2b2027,
    },
  },
  people: 'townsfolk',
  maps: { default: 'town', compatible: ['town', 'greenwood'] },
  art: {
    worldTint: 0xffffff,
    buildingTint: 0xffffff,
    treeTints: [0xe2ebe1, 0xc4d9d1, 0xe2dfb9, 0xd2e3d0],
    shadow: 1,
  },
  environment: {
    time: 'auto',
    weather: 'clear',
    grade: { multiplyColor: 0xf6dfb4, multiplyAlpha: 0.3, addColor: 0xffc070, addAlpha: 0.015 },
    night: { warm: 0xb08a6a, cold: 0x2a3550, strength: 0.78 },
    lampGlow: 1,
    wind: { sway: 1 },
    clouds: { count: 7, alpha: 1, drift: 1 },
    haze: { color: [178, 190, 200], alpha: 0.22 },
    fountain: true,
    idleSmoke: true,
    motes: null,
  },
};
