import { profileColorFor } from './art/profileColors';
import { createAppearanceController, stripAppearanceFromAddress } from './hud/appearance';
import { createAppearancePanel } from './hud/appearancePanel';
import { createMinimap } from './hud/minimap';
import { applyUiPalette } from './hud/uiPalette';
import { TILE } from './art/tiles';
import { createTownRuntime, type TownMode, type TownRuntime } from './runtime';
import { PLACE_LABEL, type Place } from './sim/toolMap';
import type { ResolvedAppearance } from './themes/resolve';

const params = new URLSearchParams(location.search);
// A build can default to the scripted demo (VITE_DEFAULT_AGENTS=demo) for a
// public showcase; ?agents=demo / ?agents=live always win over the build default.
const agentsParam = params.get('agents') ?? import.meta.env.VITE_DEFAULT_AGENTS ?? 'live';
const mode: TownMode = agentsParam === 'demo' ? 'demo' : 'live';
const hourParam = params.get('hour');
const hour = hourParam !== null && Number.isFinite(Number(hourParam)) ? Number(hourParam) : null;

// Appearance is client-side view state: a link, this browser's saved view, or
// an operator's build-time default (VITE_DEFAULT_APPEARANCE, same query syntax).
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const controller = createAppearanceController({
  location,
  storage: (() => { try { return window.localStorage; } catch { return null; } })(),
  hostDefault: (import.meta.env.VITE_DEFAULT_APPEARANCE as string | undefined) ?? null,
  systemPrefersReducedMotion: () => reducedMotionQuery.matches,
  stripLinkParameters: stripAppearanceFromAddress,
});
reducedMotionQuery.addEventListener('change', () => controller.refresh());
applyUiPalette(controller.resolved().ui);

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const statusEl = $('#status');
const panel = $('#panel');
const followBtn = $<HTMLButtonElement>('#follow');
const directorBtn = $<HTMLButtonElement>('#director');

let selectedId: string | null = null;
const mount = (appearance: ResolvedAppearance): TownRuntime => createTownRuntime({
  mode, hour, appearance, onSelect: (id) => { selectedId = id; renderPanel(); },
});
let rt = mount(controller.resolved());
// Browser verification reads these; getters follow a scene reload.
(window as unknown as { __town: unknown }).__town = {
  get game() { return rt.game; },
  get sim() { return rt.sim; },
  get map() { return rt.map; },
  get source() { return rt.source; },
  get runtime() { return rt; },
  appearance: controller,
};

// Visual changes apply live to the running scene. A different map needs the
// renderer scene (and the simulator built on its grid) rebuilt, which only
// happens when the viewer asks for it.
controller.subscribe(() => {
  const next = controller.resolved();
  applyUiPalette(next.ui);
  rt.apply(next);
});
const appearancePanel = createAppearancePanel({ controller, mountedMapId: () => rt.preset.id, reloadMap });

function reloadMap(): void {
  selectedId = null;
  rt.destroy();
  rt = mount(controller.resolved());
  syncButtons();
  renderPanel();
  appearancePanel.render();
}

// ------------------------------------------------------------------ HUD

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-goto]')) {
  btn.addEventListener('click', () => rt.scene()?.goTo(btn.dataset.goto!));
}
$('#overview').addEventListener('click', () => { rt.scene()?.overview(); renderStatus(); });
directorBtn.addEventListener('click', () => {
  const scene = rt.scene();
  if (!scene) return;
  scene.setDirector(!scene.isDirector());
  syncButtons();
});
followBtn.addEventListener('click', () => {
  const scene = rt.scene();
  if (!scene) return;
  const on = !scene.isFollowing();
  if (on && !selectedId) {
    const first = rt.sim.active()[0];
    if (first) scene.select(first.id);
  }
  scene.setFollow(on);
  syncButtons();
});

function syncButtons(): void {
  const scene = rt.scene();
  const director = scene?.isDirector() ?? true;
  directorBtn.textContent = `Director: ${director ? 'on' : 'off'}`;
  directorBtn.classList.toggle('on', director);
  followBtn.textContent = `Follow: ${scene?.isFollowing() ? 'on' : 'off'}`;
  followBtn.classList.toggle('on', scene?.isFollowing() ?? false);
}

function ago(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function renderPanel(): void {
  const sim = rt.sim;
  const r = selectedId ? sim.residents.get(selectedId) : null;
  if (!r) { panel.hidden = true; return; }
  panel.hidden = false;
  const place = r.place ? PLACE_LABEL[r.place] : r.state === 'leaving' ? 'going home' : r.state === 'waiting' ? 'at the front door' : r.state === 'posted' ? 'at its post' : r.state === 'returning' ? 'coming back' : 'on the road';
  const parent = r.parentId ? sim.residents.get(r.parentId) : null;
  const colour = profileColorFor(r.profile, r.profileSlot);
  const runnersOut = r.kind === 'session' ? sim.runners().filter((x) => x.parentId === r.id).length : 0;
  const rows: [string, string][] = [
    ...(colour && r.profile ? [['profile', `${r.profile} · ${colour.name}`] as [string, string]] : []),
    ['state', r.state === 'waiting' ? 'waiting for you' : r.state === 'posted' ? 'on watch until the next run' : r.state],
    ['where', place],
    ['doing', r.bubble ?? (r.anim === 'sit' ? 'resting' : r.anim)],
    ...(r.kind === 'runner' ? [['sent by', parent?.name ?? 'a session'] as [string, string]] : [['runners out', String(runnersOut)] as [string, string]]),
    ['home', r.home.label],
    ['in town', ago(sim.now() - r.spawnedAt)],
    ['last event', `${ago(sim.now() - r.lastEventAt)} ago`],
  ];
  const sub = r.kind === 'runner' ? `tool call · ${r.role}` : r.role === 'scheduled' ? `scheduled job · keeper` : `${r.title ?? (r.memory ? 'earlier today' : r.isChild ? 'subagent' : 'session')} · ${r.role}`;
  panel.innerHTML = `
    <h3>${colour ? `<span class="swatch" style="background:${colour.cloth}"></span> ` : ''}${escapeHtml(r.name)}</h3>
    <div class="sub">${escapeHtml(sub)}</div>
    ${rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`).join('')}
    <ul>${r.history.map((h) => `<li><b>${escapeHtml(h.text)}</b> <span>${ago(sim.now() - h.at)} ago</span></li>`).join('')}</ul>`;
}

/** Shared Town: one swatch per profile that has a resident in town. Hidden when nobody carries a profile. */
function renderLegend(): void {
  const legend = $('#legend');
  const counts = new Map<string, { slot: number; colour: string; count: number }>();
  for (const r of rt.sim.residents.values()) {
    if (r.kind !== 'session' || r.state === 'gone' || r.memory) continue;
    const colour = profileColorFor(r.profile, r.profileSlot);
    if (!colour || r.profile === null) continue;
    const entry = counts.get(r.profile) ?? { slot: colour.slot, colour: colour.cloth, count: 0 };
    entry.count += 1;
    counts.set(r.profile, entry);
  }
  const signature = [...counts].map(([name, e]) => `${name}:${e.slot}:${e.count}`).sort().join('|');
  if (legend.dataset.signature === signature) return;
  legend.dataset.signature = signature;
  legend.replaceChildren();
  legend.hidden = counts.size === 0;
  for (const [name, entry] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = entry.colour;
    chip.append(swatch, `${name} · ${entry.count}`);
    legend.append(chip);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function renderStatus(): void {
  const { sim, source } = rt;
  syncButtons();
  const st = source.status();
  const active = sim.active();
  const resting = [...sim.residents.values()].filter((r) => r.state === 'resting' && !r.memory).length;
  const remembered = sim.remembered().length;
  const keepers = sim.keepers().length;
  const runners = sim.runners().length;
  const waiting = active.filter((r) => r.state === 'waiting').length;
  const working = active.length - waiting;
  const mains = active.filter((r) => !r.isChild).length;
  let text: string;
  if (mode === 'demo') {
    text = `scripted demo · ${mains} simulated sessions · ${active.length - mains} simulated helpers · ${runners} tool calls out · ${waiting} waiting for you` + (resting ? ` · ${resting} resting` : '');
  } else {
    const bridge = source.bridge?.();
    text = st === 'connected'
      ? bridge === null || bridge === undefined ? 'server reachable · bridge status unknown'
        : bridge.receivedEvents === 0 ? 'server ready · waiting for first Hermes event'
        : `Hermes events received · last event ${ago(Math.max(0, source.now() - (bridge.lastEventAt ?? source.now())))} ago`
      : `live Hermes events · ${st}`;
    if (st === 'connected') {
      if ((bridge?.receivedEvents ?? 0) > 0) {
        text += ` · ${mains} sessions · ${active.length - mains} helpers · ${working} working · ${runners} tool calls out · ${waiting} waiting for you` + (keepers ? ` · ${keepers} ${keepers === 1 ? 'keeper' : 'keepers'} on watch` : '') + (resting ? ` · ${resting} resting` : '') + (remembered ? ` · ${remembered} from earlier today` : '');
      } else if (keepers) {
        text += ` · ${keepers} scheduled ${keepers === 1 ? 'keeper' : 'keepers'} (not new delivery)`;
      }
      const o = source.omitted?.();
      if (o && o.stale + o.departed > 0) text += ` · ${o.stale + o.departed} past sessions not shown`;
    }
    if (st === 'disconnected') text += ' · run hermes town start on the Hermes host';
  }
  statusEl.textContent = text;
  renderLegend();
  const verified = (source.bridge?.()?.receivedEvents ?? 0) > 0;
  statusEl.className = `status ${mode === 'demo' ? 'demo' : st === 'connected' && verified ? 'ok' : st === 'disconnected' ? 'bad' : ''}`;
  const help = $<HTMLDetailsElement>('#connection-help');
  help.hidden = mode === 'demo' || (st === 'connected' && verified);
  $('#connection-note').textContent = st === 'connected'
    ? 'Your browser can reach Town. That alone does not prove the Hermes plugin is loaded or sending events. Scheduled keepers and restored sessions do not count as new delivery.'
    : 'Town cannot reach its local server. Existing residents are not evidence of current activity.';
}

// ------------------------------------------------------------- minimap

const minimapCanvas = $<HTMLCanvasElement>('#minimap');
const minimap = createMinimap(minimapCanvas, {
  map: () => rt.map,
  sim: () => rt.sim,
  scene: () => rt.scene(),
  selectedId: () => selectedId,
  palette: () => controller.resolved().ui.minimap,
});
minimapCanvas.addEventListener('click', (e) => {
  const rect = minimapCanvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * rt.map.grid.w * TILE;
  const y = ((e.clientY - rect.top) / rect.height) * rt.map.grid.h * TILE;
  rt.scene()?.centerOn(x, y);
});

window.setInterval(() => { renderStatus(); renderPanel(); }, 500);
const loop = (): void => { minimap.render(); requestAnimationFrame(loop); };
requestAnimationFrame(loop);

void PLACE_LABEL;
export type { Place };
