// LIVE MODE helpers. Pure functions over the coordinator views (TL-05).
import type { Timestamp } from 'spacetimedb';
import type { Lane } from '../demo/fixture';

const MIN = 60_000;
export const ACT_BELOW = 15; // same threshold as the fixture: under +15 min is Act now

export const ms = (t: Timestamp) => t.toDate().getTime();

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const hhmm = (t: number) => clock.format(t);

type Legs = { driverToAssetMin: number; pickupMin: number; assetToHomeMin: number; setupMin: number; confirmedDelayMin: number };

// Display copy of readyAt in spacetimedb/src/rules.ts (A's server copy of C's formula).
// The server computes the committed ETA itself; this only previews it for the coordinator.
export function readyAtMs(r: Legs, driverFreeAt: number, assetFreeAt: number, now: number) {
  const atAsset = Math.max(now, driverFreeAt) + r.driverToAssetMin * MIN;
  const depart = Math.max(atAsset, assetFreeAt) + r.pickupMin * MIN;
  return depart + (r.assetToHomeMin + r.confirmedDelayMin + r.setupMin) * MIN;
}

type HouseholdRow = {
  id: string;
  version: number;
  need: string;
  runtimeLowerMin?: number;
  runtimeUpperMin?: number;
  lastObservedAt?: Timestamp;
  activeJobId?: bigint;
};
type RouteRow = Legs & { id: string; householdId: string; driverId: string; assetId: string };
type FreeRow = { id: string; freeAt: Timestamp; activeJobId?: bigint };
type AssetRow = FreeRow & { kind: string };

// blocked says why an option can't be reserved right now; null means it can.
export type LiveOption = { route: RouteRow; ready: number; margin: number | null; blocked: string | null };
export type LiveCase = {
  lane: Lane;
  observed: number | null;
  window: [number, number | null] | null;
  options: LiveOption[];
  best?: LiveOption;
};

// margin = earliest time backup may run out - when help can be there, in whole minutes.
export function evaluateHousehold(h: HouseholdRow, routes: readonly RouteRow[], drivers: readonly FreeRow[], assets: readonly AssetRow[], now: number): LiveCase {
  const observed = h.lastObservedAt ? ms(h.lastObservedAt) : null;
  const lo = h.runtimeLowerMin;
  const hi = h.runtimeUpperMin;
  const window: [number, number | null] | null =
    observed !== null && lo !== undefined ? [observed + lo * MIN, hi === undefined ? null : observed + hi * MIN] : null;

  const options = routes
    .filter((r) => r.householdId === h.id)
    .map((r) => {
      const d = drivers.find((x) => x.id === r.driverId);
      const a = assets.find((x) => x.id === r.assetId);
      const ready = readyAtMs(r, d ? ms(d.freeAt) : now, a ? ms(a.freeAt) : now, now);
      return {
        route: r,
        ready,
        margin: window ? Math.floor((window[0] - ready) / MIN) : null,
        // A missing driver or asset, or the wrong kind of asset, is never offered as free.
        blocked:
          !d ? 'driver not found'
          : !a ? 'asset not found'
          : a.kind !== h.need ? `${a.kind}, not ${h.need}`
          : d.activeJobId !== undefined || a.activeJobId !== undefined ? 'busy'
          : null,
      };
    });
  // With a runtime, rank by margin; without one, the earliest arrival is the best we know.
  // Known runtime with no free option stays Act now: uncovered work must surface (team spec, lanes).
  const free = options.filter((o) => o.blocked === null);
  const ranked = window ? free.sort((x, y) => y.margin! - x.margin!) : free.sort((x, y) => x.ready - y.ready);
  const best = ranked[0];

  const lane: Lane =
    h.activeJobId !== undefined ? 'dispatched'
    : observed === null ? 'silent'
    : !window ? 'unknown'
    : best && best.margin! >= ACT_BELOW ? 'watch'
    : 'act';
  return { lane, observed, window, options, best };
}

// Reducer errors arrive as rejected promises. The server prefixes them conflict:, forbidden: or rejected:.
export function errorText(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error:\s*/, '');
}

// The five poll answers mapped to the runtime bounds A's ingestCheckin stores (minutes).
export const POLL: { text: string; lo?: number; hi?: number }[] = [
  { text: 'Under 30 min', lo: 0, hi: 30 },
  { text: '30 to 60', lo: 30, hi: 60 },
  { text: '1 to 2 hrs', lo: 60, hi: 120 },
  { text: '2+ hrs', lo: 120 },
  { text: 'Not sure' },
];

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
