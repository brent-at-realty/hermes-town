import { findPath, type Grid, type Point } from './pathfind';

/**
 * Typed transit over the walkable grid.
 *
 * Ordinary walking stays A* on tiles. A map that has several separate walkable
 * regions (the decks of a tower, the surface of a moon) declares explicit
 * connectors between them. A connector is only a *route segment* for a
 * resident that is already walking to a real mapped station: it never creates
 * activity, never becomes a station, and never produces a lifecycle event. The
 * simulator turns a {@link RoutePlan} into a walk, a ride and a walk again.
 *
 * This module has no Phaser, no DOM and no simulator imports.
 */

export type TransitKind = 'lift' | 'shuttle';

export type TransitVisual =
  /** A car in a vertical shaft. `floorFrom`/`floorTo` are only labels for the floor indicator. */
  | { kind: 'lift'; tower: string; floorFrom: number; floorTo: number }
  /** A craft on an authored curve. `control` is the Bezier control point, in world pixels. */
  | { kind: 'shuttle'; from: string; to: string; control: Point };

export interface TransitConnector {
  id: string;
  kind: TransitKind;
  /** Region label of the origin and destination (a deck, a body). Documentation and minimap only. */
  fromRegion: string;
  toRegion: string;
  /** Walkable tile where a resident boards, and walkable tile where it steps out. */
  boarding: Point;
  exit: Point;
  durationMs: number;
  visual: TransitVisual;
}

export type RouteLeg =
  | { kind: 'walk'; points: Point[] }
  | { kind: 'transit'; connectorId: string; from: Point; to: Point; durationMs: number };

export interface RoutePlan { legs: RouteLeg[] }

export interface TransitNetwork {
  readonly connectors: readonly TransitConnector[];
  byId(id: string): TransitConnector | undefined;
  /** Connected walkable region index of a tile, or -1 when the tile is blocked or outside the grid. */
  regionOf(p: Point): number;
  /** A walk-only plan when both tiles share a region, otherwise walk/transit/walk through the cheapest connector chain. */
  route(from: Point, to: Point): RoutePlan | null;
}

/**
 * Where a lift cabin stands relative to the tile it serves: the distance, in world pixels, from the centre of a
 * boarding or exit tile up to the cabin's floor (negative is up). A resident walks the ordinary deck line to the
 * vestibule tile; the cabin waits in the shaft opening behind it, its floor at the back edge of the deck rather than
 * embedded in the deck artwork. The Cyber City painter and the verification derive their geometry from this.
 */
export const LIFT_CAR_BASE_OFFSET = -24;

export const MIN_TRANSIT_MS = 600;
export const MAX_TRANSIT_MS = 9000;

/** Walkable 4-connected components of a grid. -1 marks blocked tiles. */
export function labelRegions(grid: Grid): { labels: Int32Array; count: number } {
  const { w, h, cost } = grid;
  const labels = new Int32Array(w * h).fill(-1);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (cost[start] === 0 || labels[start] !== -1) continue;
    labels[start] = count;
    stack.push(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const cx = cur % w, cy = Math.floor(cur / w);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (cost[ni] === 0 || labels[ni] !== -1) continue;
        labels[ni] = count;
        stack.push(ni);
      }
    }
    count += 1;
  }
  return { labels, count };
}

/** Ride time expressed as the equivalent number of walked tiles, so one cost scale serves both. */
const TILES_PER_SECOND = 2.75;

export function createTransitNetwork(grid: Grid, connectors: readonly TransitConnector[]): TransitNetwork {
  const { labels } = labelRegions(grid);
  const regionOf = (p: Point): number => (p.x < 0 || p.y < 0 || p.x >= grid.w || p.y >= grid.h ? -1 : labels[p.y * grid.w + p.x]!);
  const walkCache = new Map<string, Point[] | null>();
  const walk = (a: Point, b: Point): Point[] | null => {
    const key = `${a.x},${a.y}>${b.x},${b.y}`;
    if (!walkCache.has(key)) walkCache.set(key, findPath(grid, a, b));
    return walkCache.get(key)!;
  };
  const cost = (path: Point[]): number => path.length;

  const route = (from: Point, to: Point): RoutePlan | null => {
    const fr = regionOf(from), tr = regionOf(to);
    if (fr < 0 || tr < 0) return null;
    if (fr === tr) {
      const path = walk(from, to);
      return path ? { legs: [{ kind: 'walk', points: path }] } : null;
    }
    // Dijkstra over: start, the exit of each connector, and the goal.
    const n = connectors.length;
    const dist = new Array<number>(n + 2).fill(Infinity); // 0..n-1 exits, n start, n+1 goal
    const prev = new Array<{ node: number; via: number } | null>(n + 2).fill(null);
    const done = new Array<boolean>(n + 2).fill(false);
    const START = n, GOAL = n + 1;
    dist[START] = 0;
    const pointOf = (i: number): Point => (i === START ? from : i === GOAL ? to : connectors[i]!.exit);
    for (;;) {
      let u = -1;
      for (let i = 0; i < n + 2; i++) if (!done[i] && dist[i]! < Infinity && (u === -1 || dist[i]! < dist[u]!)) u = i;
      if (u === -1 || u === GOAL) break;
      done[u] = true;
      const here = pointOf(u);
      const hereRegion = regionOf(here);
      if (hereRegion === tr) {
        const path = walk(here, to);
        if (path && dist[u]! + cost(path) < dist[GOAL]!) { dist[GOAL] = dist[u]! + cost(path); prev[GOAL] = { node: u, via: -1 }; }
      }
      for (let j = 0; j < n; j++) {
        const c = connectors[j]!;
        if (done[j] || regionOf(c.boarding) !== hereRegion) continue;
        const path = walk(here, c.boarding);
        if (!path) continue;
        const total = dist[u]! + cost(path) + (c.durationMs / 1000) * TILES_PER_SECOND;
        if (total < dist[j]!) { dist[j] = total; prev[j] = { node: u, via: j }; }
      }
    }
    if (!Number.isFinite(dist[GOAL]!)) return null;
    // Reconstruct, then lay the legs out in order.
    const chain: number[] = [];
    for (let at: number | null = GOAL; at !== null; at = prev[at]?.node ?? null) chain.push(at);
    chain.reverse();
    const legs: RouteLeg[] = [];
    for (let k = 0; k + 1 < chain.length; k++) {
      const a = chain[k]!, b = chain[k + 1]!;
      if (b === GOAL) {
        const path = walk(pointOf(a), to);
        if (!path) return null;
        legs.push({ kind: 'walk', points: path });
      } else {
        const c = connectors[b]!;
        const path = walk(pointOf(a), c.boarding);
        if (!path) return null;
        legs.push({ kind: 'walk', points: path });
        legs.push({ kind: 'transit', connectorId: c.id, from: c.boarding, to: c.exit, durationMs: c.durationMs });
      }
    }
    return { legs };
  };

  const byId = new Map(connectors.map((c) => [c.id, c] as const));
  return { connectors, byId: (id) => byId.get(id), regionOf, route };
}

// ------------------------------------------------------------- timing

export interface TransitPhase {
  phase: 'board' | 'ride' | 'exit';
  /** 0..1 along the ride, eased; 0 while boarding and 1 while stepping out. */
  t: number;
  /** 0 closed .. 1 fully open, for the car doors or the hatch. */
  open: number;
}

/** Fraction of a trip spent with the doors working at each end. */
export function boardingSeconds(durationSeconds: number): number {
  return Math.min(0.55, Math.max(0.2, durationSeconds * 0.2));
}

export function transitPhase(elapsed: number, duration: number): TransitPhase {
  const d = Math.max(0.001, duration);
  const door = boardingSeconds(d);
  if (elapsed < door) {
    const k = Math.max(0, elapsed) / door;
    return { phase: 'board', t: 0, open: k < 0.5 ? k * 2 : (1 - k) * 2 };
  }
  if (elapsed > d - door) {
    const k = Math.min(1, (elapsed - (d - door)) / door);
    return { phase: 'exit', t: 1, open: k < 0.5 ? k * 2 : (1 - k) * 2 };
  }
  const t = (elapsed - door) / Math.max(0.001, d - 2 * door);
  return { phase: 'ride', t: t * t * (3 - 2 * t), open: 0 };
}

/**
 * Whether the rider is shown walking at the boarding or exit tile. The resident is hidden only while inside the car
 * or the craft: from the moment the doors are fully open at the origin until they are fully open at the destination.
 */
export function riderVisible(elapsed: number, duration: number): boolean {
  const d = Math.max(0.001, duration);
  const door = boardingSeconds(d);
  if (elapsed < door * 0.5) return true;
  if (elapsed > d - door * 0.5) return true;
  return false;
}

/** The world-pixel position of a rider at ride fraction `t`. */
export function transitPoint(connector: TransitConnector, from: Point, to: Point, t: number): Point {
  const k = Math.min(1, Math.max(0, t));
  if (connector.visual.kind === 'shuttle') {
    const c = connector.visual.control;
    const u = 1 - k;
    return { x: u * u * from.x + 2 * u * k * c.x + k * k * to.x, y: u * u * from.y + 2 * u * k * c.y + k * k * to.y };
  }
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

// ------------------------------------------------------------ validation

/** Structural problems with a connector set, against the grid it lives on. An empty list is a pass. */
export function validateTransit(grid: Grid, entrance: Point, connectors: readonly TransitConnector[], mapId: string): string[] {
  const out: string[] = [];
  const at = (m: string) => out.push(`map ${mapId}: ${m}`);
  const net = createTransitNetwork(grid, connectors);
  const seen = new Set<string>();
  const inGrid = (p: Point) => Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < grid.w && p.y < grid.h;
  const walkable = (p: Point) => inGrid(p) && grid.cost[p.y * grid.w + p.x] !== 0;
  for (const c of connectors) {
    if (seen.has(c.id)) at(`duplicate connector id ${c.id}`);
    seen.add(c.id);
    if (c.kind !== c.visual.kind) at(`connector ${c.id}: kind ${c.kind} does not match its visual ${c.visual.kind}`);
    if (!walkable(c.boarding)) at(`connector ${c.id}: boarding tile is missing or not walkable`);
    if (!walkable(c.exit)) at(`connector ${c.id}: exit tile is missing or not walkable`);
    if (!(c.durationMs >= MIN_TRANSIT_MS && c.durationMs <= MAX_TRANSIT_MS)) at(`connector ${c.id}: duration must be ${MIN_TRANSIT_MS}-${MAX_TRANSIT_MS} ms`);
    if (!walkable(c.boarding) || !walkable(c.exit)) continue;
    if (net.regionOf(c.boarding) === net.regionOf(c.exit)) at(`connector ${c.id}: joins a region to itself`);
    if (c.fromRegion === c.toRegion) at(`connector ${c.id}: self-loop between ${c.fromRegion} and ${c.toRegion}`);
    if (c.visual.kind === 'shuttle' && !(Number.isFinite(c.visual.control.x) && Number.isFinite(c.visual.control.y))) at(`connector ${c.id}: shuttle route has no valid control point`);
    if (!net.route(entrance, c.boarding)) at(`connector ${c.id}: boarding tile is not reachable from the entrance`);
    if (!net.route(entrance, c.exit)) at(`connector ${c.id}: exit tile is not reachable from the entrance`);
  }
  return out;
}
