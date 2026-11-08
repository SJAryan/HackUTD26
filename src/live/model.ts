// LIVE MODE helpers. Pure functions over the coordinator views (TL-05).
import type { Timestamp } from 'spacetimedb';
import type { Lane } from '../demo/fixture';
import { evaluateOptions, readyAt, type DispatchOption } from '../../spacetimedb/src/domain/dispatch';

const MIN = 60_000;

export const ms = (t: Timestamp) => t.toDate().getTime();

const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const hhmm = (t: number) => clock.format(t);

type Legs = { driverToAssetMin: number; pickupMin: number; assetToHomeMin: number; setupMin: number; confirmedDelayMin: number };
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
  reason: string; // C's reason for the lane, shown in the drawer
  silent: boolean; // contact status, independent of urgency: an Act now case can also be silent
  observed: number | null;
  window: [number, number | null] | null;
  options: LiveOption[];
  best?: LiveOption;
};
// The household's current outreach round (coordinator_rounds), if one is open or silent.
type RoundRow = { householdId: string; status: string; openedAt: Timestamp; dueAt: Timestamp };

// Lanes come from C's evaluateOptions (spacetimedb/src/domain/dispatch.ts), the same pure
// function the rules tests cover. Availability is A's concern, not C's: a busy, missing or
// wrong-kind resource is shown with the reason it is blocked and never passed to C, so
// "nothing free" lands in Act now.
export function evaluateHousehold(h: HouseholdRow, routes: readonly RouteRow[], drivers: readonly FreeRow[], assets: readonly AssetRow[], round: RoundRow | undefined, now: number): LiveCase {
  const observed = h.lastObservedAt ? ms(h.lastObservedAt) : null;
  const lo = h.runtimeLowerMin;
  const hi = h.runtimeUpperMin;
  const window: [number, number | null] | null =
    observed !== null && lo !== undefined ? [observed + lo * MIN, hi === undefined ? null : observed + hi * MIN] : null;

  const all = routes
    .filter((r) => r.householdId === h.id)
    .map((r) => {
      const d = drivers.find((x) => x.id === r.driverId);
      const a = assets.find((x) => x.id === r.assetId);
      const blocked =
        !d ? 'driver not found'
        : !a ? 'asset not found'
        : a.kind !== h.need ? `${a.kind}, not ${h.need}`
        : d.activeJobId !== undefined || a.activeJobId !== undefined ? 'busy'
        : null;
      const option: DispatchOption = {
        routeId: r.id, driverId: r.driverId, assetId: r.assetId, assetKind: a?.kind ?? '',
        driverFreeAt: d ? ms(d.freeAt) : now, assetFreeAt: a ? ms(a.freeAt) : now,
        driverToAssetMin: r.driverToAssetMin, pickupMin: r.pickupMin, assetToHomeMin: r.assetToHomeMin,
        setupMin: r.setupMin, confirmedDelayMin: r.confirmedDelayMin,
      };
      return { route: r, option, blocked };
    });

  const active = round && (round.status === 'open' || round.status === 'silent') ? round : undefined;
  const result = evaluateOptions(
    {
      householdId: h.id,
      need: h.need,
      evidence: observed === null ? undefined : { observedAt: observed, runtimeLowerMin: lo, runtimeUpperMin: hi },
      round: active && { openedAt: ms(active.openedAt), dueAt: ms(active.dueAt), lastReplyAt: observed ?? undefined },
    },
    all.filter((o) => o.blocked === null).map((o) => o.option),
    now,
  );

  // Every route is listed in the drawer; C's result supplies the ready time and margin.
  const options: LiveOption[] = all.map(({ route, option, blocked }) => {
    const r = result.options.find((x) => x.routeId === route.id);
    const ready = r?.readyAt ?? readyAt(option, now);
    return { route, ready, margin: window ? r?.marginLoMin ?? Math.floor((window[0] - ready) / MIN) : null, blocked };
  });
  const best = result.best && options.find((o) => o.route.id === result.best!.routeId);
  const lane: Lane = h.activeJobId !== undefined ? 'dispatched' : result.lane === 'act_now' ? 'act' : result.lane;
  return { lane, reason: result.reason, silent: result.silent, observed, window, options, best };
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
