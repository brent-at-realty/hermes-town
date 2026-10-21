/**
 * The camera's minimum zoom, as pure arithmetic (no Phaser, no DOM) so the scene and the contract tests share it.
 *
 * At zoom z the camera shows a (viewW / z) by (viewH / z) window of the world. That window stays inside the authored
 * world, revealing nothing beyond it, exactly when z is at least viewW / worldW and at least viewH / worldH. So the
 * floor is the larger of the two ratios: the zoom at which the world just covers the viewport on its tighter axis.
 * It is dynamic: it follows the viewport, and it is specific to each map because it reads that map's own size.
 */
export function zoomFloor(viewW: number, viewH: number, worldW: number, worldH: number): number {
  return Math.max(viewW / worldW, viewH / worldH);
}

/** A requested zoom, held at or above the floor. Zooming in is never restricted. */
export function clampZoom(zoom: number, floor: number): number {
  return Math.max(zoom, floor);
}

/** Whether the window shown at `zoom` lies inside the world (allowing for floating point). */
export function viewInsideWorld(zoom: number, viewW: number, viewH: number, worldW: number, worldH: number): boolean {
  const eps = 1e-6;
  return viewW / zoom <= worldW + eps && viewH / zoom <= worldH + eps;
}
