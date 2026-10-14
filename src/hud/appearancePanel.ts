import type { AppearanceController } from './appearance';
import { MOTION_OPTIONS, TIME_OPTIONS, WEATHER_OPTIONS } from '../themes/environment';
import { KITS, THEMES, compatibleMaps } from '../themes/registry';
import type { ChoiceKey } from '../themes/preferences';

/**
 * The Appearance drawer. It reads the registries to build its controls, so a
 * new theme, kit or map shows up here without a code change, and it calls only
 * the controller: it never touches the simulator, the source or the scene.
 */
export interface PanelDeps {
  controller: AppearanceController;
  /** The id of the map the renderer is showing right now. */
  mountedMapId(): string;
  /** Rebuild the renderer scene for the chosen map. */
  reloadMap(): void;
}

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;

function option(value: string, label: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value; o.textContent = label;
  return o;
}

const SOURCE_TEXT = {
  link: 'Showing a shared link. It is temporary: Save as my view to keep it.',
  saved: 'Showing your saved view for this browser.',
  host: 'Showing this Town’s default look.',
  default: 'Showing the built-in default look.',
} as const;

const KEY_LABEL: Record<ChoiceKey, string> = { theme: 'theme', people: 'people', map: 'map', time: 'time', weather: 'weather', motion: 'motion' };

export function createAppearancePanel(deps: PanelDeps): { toggle(): void; open(): void; close(): void; render(): void } {
  const { controller } = deps;
  const toggleBtn = $<HTMLButtonElement>('#appearance-toggle');
  const panel = $('#appearance');
  const themes = $('#ap-themes');
  const people = $<HTMLSelectElement>('#ap-people');
  const map = $<HTMLSelectElement>('#ap-map');
  const time = $<HTMLSelectElement>('#ap-time');
  const weather = $<HTMLSelectElement>('#ap-weather');
  const motion = $<HTMLSelectElement>('#ap-motion');
  const mapNote = $('#ap-map-note');
  const status = $('#ap-status');
  const sourceEl = $('#ap-source');
  const linkEl = $<HTMLInputElement>('#ap-link');
  const peopleHint = $('#ap-people-hint');
  const motionHint = $('#ap-motion-hint');

  // theme cards: native radios, so arrow keys, focus and screen readers work for free
  for (const t of THEMES) {
    const label = document.createElement('label');
    label.className = 'card';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'ap-theme'; input.value = t.id;
    const swatches = document.createElement('span');
    swatches.className = 'swatches'; swatches.setAttribute('aria-hidden', 'true');
    for (const c of t.preview) { const s = document.createElement('i'); s.style.background = c; swatches.append(s); }
    const name = document.createElement('b'); name.textContent = t.label;
    const desc = document.createElement('small'); desc.textContent = t.description;
    label.append(input, swatches, name, desc);
    themes.append(label);
    input.addEventListener('change', () => { if (input.checked) { controller.selectTheme(t.id); say(`${t.label} theme previewed.`); } });
  }
  for (const s of [people, time, weather]) s.append(option('theme', 'Theme default'));
  for (const k of KITS) people.append(option(k.id, k.label));
  for (const o of TIME_OPTIONS) time.append(option(o.id, o.label));
  for (const o of WEATHER_OPTIONS) weather.append(option(o.id, o.label));
  for (const o of MOTION_OPTIONS) motion.append(option(o.id, o.label));

  const say = (text: string): void => { status.textContent = text; };

  people.addEventListener('change', () => { controller.update({ people: people.value }); say('People style previewed.'); });
  time.addEventListener('change', () => { controller.update({ time: time.value as never }); say('Time of day previewed.'); });
  weather.addEventListener('change', () => { controller.update({ weather: weather.value as never }); say('Weather previewed. It is decoration only.'); });
  motion.addEventListener('change', () => { controller.update({ motion: motion.value as never }); say('Motion setting previewed.'); });
  map.addEventListener('change', () => { controller.update({ map: map.value }); say('Map chosen. Reload the scene to show it.'); });
  $('#ap-map-apply').addEventListener('click', () => { deps.reloadMap(); say(`Renderer scene reloaded with ${controller.resolved().map.label}. Hermes was not restarted.`); });

  $('#ap-reset').addEventListener('click', () => {
    controller.reset();
    // Reset is an explicit request for the default view, and the default view includes its map.
    if (controller.resolved().map.id !== deps.mountedMapId()) {
      deps.reloadMap();
      say(`Reset to the default look and rebuilt the ${controller.resolved().map.label} map. Your saved view was cleared. Hermes was not restarted.`);
    } else say('Reset to the default look. Your saved view was cleared.');
  });
  $('#ap-save').addEventListener('click', () => { say(controller.save() ? 'Saved as your view for this browser.' : 'This browser would not store it. The view still works until you reload.'); });
  $('#ap-copy').addEventListener('click', async () => {
    const url = controller.link();
    linkEl.value = url;
    try { await navigator.clipboard.writeText(url); say('Share link copied.'); }
    catch { linkEl.focus(); linkEl.select(); say('Copy blocked by the browser. The link is selected: copy it manually.'); }
  });

  const open = (): void => {
    panel.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    $<HTMLElement>('#appearance-title').focus();
  };
  const close = (): void => {
    if (panel.hidden) return;
    panel.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.focus();
  };
  toggleBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  $('#appearance-close').addEventListener('click', close);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  function render(): void {
    const c = controller.choice(), r = controller.resolved();
    for (const input of themes.querySelectorAll<HTMLInputElement>('input')) input.checked = input.value === r.theme.id;
    people.value = c.people;
    peopleHint.textContent = `${r.people.description}${c.people === 'theme' ? ' (from the theme)' : ''}`;
    // maps this theme can host; the chosen one is the resolved one
    map.replaceChildren(...compatibleMaps(r.theme).map((m) => option(m.id, m.label)));
    map.value = r.map.id;
    $('#ap-map-hint').textContent = r.map.description;
    time.value = c.time;
    weather.value = c.weather;
    motion.value = c.motion;
    motionHint.textContent = r.environment.reducedMotion
      ? 'Decorative motion is reduced: slower wind and clouds, fewer particles, no rain streaks. Residents move normally.'
      : 'Full decorative motion. Residents’ own movement is never changed by this setting.';
    const pending = r.map.id !== deps.mountedMapId();
    mapNote.hidden = !pending;
    sourceEl.textContent = SOURCE_TEXT[controller.source()];
    const rejected = controller.rejected();
    if (rejected.length > 0 && !status.dataset.shownRejected) {
      status.dataset.shownRejected = '1';
      say(`This link had values Town does not support (${rejected.map((k) => KEY_LABEL[k]).join(', ')}). Defaults are used for them.`);
    }
    linkEl.value = controller.link();
    const notes = r.notes;
    $('#ap-notes').textContent = notes.join(' ');
  }

  controller.subscribe(render);
  render();
  // A link with unsupported values is announced when the page loads, even with the drawer closed.
  const rejected = controller.rejected();
  const banner = $('#appearance-banner');
  if (rejected.length > 0) {
    banner.hidden = false;
    banner.textContent = `Some appearance values in this link are not supported (${rejected.map((k) => KEY_LABEL[k]).join(', ')}); defaults are used instead.`;
    window.setTimeout(() => { banner.hidden = true; }, 12000);
  }
  return { toggle: () => (panel.hidden ? open() : close()), open, close, render };
}
