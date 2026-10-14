import type { TownTheme } from './types';

/**
 * Orbital System: a station, two moons and a garden around a sun. The complete pack is this theme, the Orbital crew
 * people kit, the Orbital System map and a clear-orbit environment. Everything here is presentation: places,
 * residents and states come from the lifecycle events, and the shuttles on this map are a route representation.
 */
export const ORBITAL_SYSTEM: TownTheme = {
  id: 'orbital-system',
  label: 'Orbital System',
  description: 'A station, moons and a garden around a sun. Residents fly shuttles between bodies.',
  preview: ['#04060f', '#ffb347', '#6fb4ff', '#dfe5ee'],
  ui: {
    canvasBackground: '#03040b',
    page: '#04050d',
    text: '#dfe8f6',
    textStrong: '#f4f8ff',
    textMuted: '#8090b0',
    accent: '#ffb347',
    accentSoft: '#c8d0e4',
    panel: 'rgba(5,8,18,.84)',
    panelSolid: 'rgba(5,8,18,.94)',
    panelBorder: '#2c3a5c',
    divider: '#1a2440',
    button: '#0e1630',
    buttonHover: '#182446',
    buttonBorder: '#34466e',
    buttonOn: '#5a3a14',
    buttonOnBorder: '#ffb347',
    statusOk: '#8affc8',
    statusDemo: '#ffd88a',
    statusBad: '#ff8a8a',
    focus: '#ffb347',
    minimap: {
      background: '#03040b',
      water: '#10305a', cobble: '#7a8498', path: '#5a6478', trail: '#5a6478',
      grassDry: '#2a3250', grassWet: '#2a3250', ledge: '#4a5472', grass: '#1a2038',
      tree: '#2a3250', house: '#6fb4ff', building: '#dfe5ee',
      dot: '#f4f8ff', dotChild: '#a8b4d0', dotSelected: '#ffb347', viewport: 'rgba(255,179,71,0.85)',
    },
    scene: {
      label: '#dfe8f6', labelBackground: 'rgba(4,6,16,0.8)', stallLabel: '#ffe6b8',
      name: '#f4f8ff', nameSelected: '#ffb347', nameRunner: '#8ec8ff', nameScheduled: '#8affea', nameChild: '#b8c4e4', nameMemory: '#7486a6',
      bubbleText: '#080c18', bubbleFill: 0xeef4ff, bubbleStroke: 0x1c2a4c,
    },
  },
  people: 'orbital-crew',
  maps: { default: 'orbital-system', compatible: ['town', 'greenwood', 'cyber-city', 'orbital-system'] },
  art: {
    worldTint: 0xf0f4ff,
    buildingTint: 0xf4f6ff,
    treeTints: [0xb0c8d8, 0xa8c0d0, 0xb8cce0, 0xa0b8c8],
    shadow: 0.6,
  },
  environment: {
    time: 'noon',
    weather: 'clear',
    grade: { multiplyColor: 0xe4ecff, multiplyAlpha: 0.08, addColor: 0xffc070, addAlpha: 0.012 },
    night: { warm: 0x6a5a8a, cold: 0x0a1030, strength: 0.4 },
    lampGlow: 1.2,
    wind: { sway: 0.3 },
    clouds: { count: 0, alpha: 0, drift: 0 },
    haze: { color: [40, 50, 110], alpha: 0.1 },
    fountain: false,
    idleSmoke: false,
    motes: null,
  },
  pack: {
    summary: 'Helios Station, Mercury Lab, Forge Moon and Relay Garden around a sun, with shuttles between them and the Orbital crew.',
    routeNote: 'The shuttle flight is a route representation for a resident that is already on its way to a real workstation. It is not a separate Hermes lifecycle signal and creates no activity.',
  },
};
