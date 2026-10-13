import type { UiPalette } from '../themes/types';

/**
 * The semantic HUD palette as CSS custom properties on the document root.
 * `style.css` declares the Classic values as fallbacks, so the page is right
 * before this runs and a theme only has to supply values.
 */
export function applyUiPalette(ui: UiPalette, root: HTMLElement = document.documentElement): void {
  const set = (name: string, value: string) => root.style.setProperty(`--ht-${name}`, value);
  set('page', ui.page);
  set('text', ui.text);
  set('text-strong', ui.textStrong);
  set('text-muted', ui.textMuted);
  set('accent', ui.accent);
  set('accent-soft', ui.accentSoft);
  set('panel', ui.panel);
  set('panel-solid', ui.panelSolid);
  set('panel-border', ui.panelBorder);
  set('divider', ui.divider);
  set('button', ui.button);
  set('button-hover', ui.buttonHover);
  set('button-border', ui.buttonBorder);
  set('button-on', ui.buttonOn);
  set('button-on-border', ui.buttonOnBorder);
  set('status-ok', ui.statusOk);
  set('status-demo', ui.statusDemo);
  set('status-bad', ui.statusBad);
  set('focus', ui.focus);
  set('minimap-bg', ui.minimap.background);
}
