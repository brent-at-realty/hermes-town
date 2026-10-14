import type { TownTheme } from './types';

/**
 * Night Market: the same streets and buildings under lantern light. It changes
 * the HUD palette, the people's clothes and hats, the colour grade, and adds
 * slow decorative motes. A resident does exactly what it does in Classic.
 */
export const NIGHT_MARKET: TownTheme = {
  id: 'night-market',
  label: 'Night Market',
  description: 'Indigo night, amber lanterns, and a market crowd in jewel colours.',
  preview: ['#1b1530', '#ff9a4a', '#8a4a9a', '#ffc66b'],
  ui: {
    canvasBackground: '#120e24',
    page: '#0f0b1e',
    text: '#eadcf2',
    textStrong: '#fbeaff',
    textMuted: '#a08cb8',
    accent: '#ffb35c',
    accentSoft: '#c8aee0',
    panel: 'rgba(22,15,44,.84)',
    panelSolid: 'rgba(22,15,44,.92)',
    panelBorder: '#5a3f7a',
    divider: '#33244f',
    button: '#2a1d48',
    buttonHover: '#3a2a60',
    buttonBorder: '#6a4a8f',
    buttonOn: '#8a3a6a',
    buttonOnBorder: '#ff9a4a',
    statusOk: '#8fe0b0',
    statusDemo: '#ffc66b',
    statusBad: '#ff8a8a',
    focus: '#ffc66b',
    minimap: {
      background: '#120e24',
      water: '#2a3f7a', cobble: '#6a5f86', path: '#9a6a5a', trail: '#7a6a5a',
      grassDry: '#5a5a7a', grassWet: '#2f4a5a', ledge: '#4a3a5a', grass: '#3a5a58',
      tree: '#24403f', house: '#7a3a6a', building: '#e0b87a',
      dot: '#fbeaff', dotChild: '#c8aee0', dotSelected: '#ffc66b', viewport: 'rgba(255,198,107,0.75)',
    },
    scene: {
      label: '#fbeaff', labelBackground: 'rgba(22,15,44,0.78)', stallLabel: '#ffe2b0',
      name: '#fbeaff', nameSelected: '#ffc66b', nameRunner: '#a0d0ff', nameScheduled: '#9fe0ff', nameChild: '#d0b8ee', nameMemory: '#9a88b0',
      bubbleText: '#1a1030', bubbleFill: 0xfbeaff, bubbleStroke: 0x3a2a60,
    },
  },
  people: 'market-folk',
  maps: { default: 'town', compatible: ['town', 'greenwood', 'cyber-city', 'orbital-system'] },
  art: {
    worldTint: 0xd8d0f0,
    buildingTint: 0xe8def8,
    treeTints: [0xb8c4d8, 0xa9b8d0, 0xc4b8d8, 0xb0c8c8],
    shadow: 1,
  },
  environment: {
    time: 'night',
    weather: 'clear',
    grade: { multiplyColor: 0xc9b8e8, multiplyAlpha: 0.35, addColor: 0xff9a4a, addAlpha: 0.03 },
    night: { warm: 0x8a5a7a, cold: 0x1c2040, strength: 0.7 },
    lampGlow: 1.6,
    wind: { sway: 0.7 },
    clouds: { count: 4, alpha: 0.6, drift: 0.6 },
    haze: { color: [120, 90, 150], alpha: 0.3 },
    fountain: true,
    idleSmoke: true,
    motes: { count: 36, color: 0xffc66b, alpha: 0.35 },
  },
};
