import type { TownTheme } from './types';

/**
 * Cyber City: a night-time high-rise district. The complete pack is this theme, the Neon operatives people kit, the
 * Cyber City map and a neon-evening environment. Everything here is presentation: places, residents and states come
 * from the lifecycle events, and the lifts on this map are a route representation, not a lifecycle signal.
 */
export const CYBER_CITY: TownTheme = {
  id: 'cyber-city',
  label: 'Cyber City',
  description: 'Neon high-rise towers at night. Residents ride lifts between floors.',
  preview: ['#090c1a', '#35e6ff', '#ff3fa4', '#ffb347'],
  ui: {
    canvasBackground: '#070a16',
    page: '#080b17',
    text: '#d6f0ff',
    textStrong: '#eefaff',
    textMuted: '#7f95b8',
    accent: '#35e6ff',
    accentSoft: '#8fc9e6',
    panel: 'rgba(8,12,26,.84)',
    panelSolid: 'rgba(8,12,26,.94)',
    panelBorder: '#26406a',
    divider: '#182645',
    button: '#101a34',
    buttonHover: '#182850',
    buttonBorder: '#2d4f86',
    buttonOn: '#0f4a6a',
    buttonOnBorder: '#35e6ff',
    statusOk: '#6fffc0',
    statusDemo: '#ffd36b',
    statusBad: '#ff7a9a',
    focus: '#35e6ff',
    minimap: {
      background: '#070a16',
      water: '#10305a', cobble: '#3a4a6a', path: '#26406a', trail: '#26406a',
      grassDry: '#1c2848', grassWet: '#1c2848', ledge: '#2a3a5a', grass: '#101830',
      tree: '#1c2848', house: '#8a5cff', building: '#35e6ff',
      dot: '#eefaff', dotChild: '#9fb4d8', dotSelected: '#ffd36b', viewport: 'rgba(53,230,255,0.85)',
    },
    scene: {
      label: '#d6f0ff', labelBackground: 'rgba(6,10,24,0.78)', stallLabel: '#ffe9b0',
      name: '#eefaff', nameSelected: '#ffd36b', nameRunner: '#8fd8ff', nameScheduled: '#7ff0ff', nameChild: '#b8c8ee', nameMemory: '#7488aa',
      bubbleText: '#0a1020', bubbleFill: 0xe8f6ff, bubbleStroke: 0x183050,
    },
  },
  people: 'neon-operatives',
  maps: { default: 'cyber-city', compatible: ['town', 'greenwood', 'cyber-city', 'orbital-system'] },
  art: {
    worldTint: 0xe4ecff,
    buildingTint: 0xe8eeff,
    treeTints: [0x9fb0d8, 0x90a4d0, 0xa8b4d8, 0x98acd4],
    shadow: 0.7,
  },
  environment: {
    time: 'night',
    weather: 'clear',
    grade: { multiplyColor: 0xc0ccff, multiplyAlpha: 0.1, addColor: 0x35a8ff, addAlpha: 0.02 },
    night: { warm: 0x6a4a9a, cold: 0x141a3a, strength: 0.5 },
    lampGlow: 1.8,
    wind: { sway: 0.4 },
    clouds: { count: 0, alpha: 0, drift: 0 },
    haze: { color: [70, 50, 140], alpha: 0.16 },
    fountain: false,
    idleSmoke: false,
    motes: null,
  },
  pack: {
    summary: 'Four neon towers, a street and lifts between floors, with the Neon operatives and a neon night.',
    routeNote: 'The lift ride is a route representation for a resident that is already on its way to a real workstation. It is not a separate Hermes lifecycle signal and creates no activity.',
  },
};
