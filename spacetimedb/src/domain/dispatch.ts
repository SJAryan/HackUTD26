// TL-03 dispatch rules. Pure TypeScript: no Spacetime imports, no clocks.
// Times are epoch milliseconds; callers convert Timestamp micros with Number(micros / 1000n).
// Numbers describe equipment runtime and arrival estimates only.

export const MIN = 60_000;
export const WATCH_MARGIN_MIN = 15; // best conservative margin >= 15 is Watch, below is Act now

export type Lane = 'act_now' | 'watch' | 'silent' | 'unknown';

export interface HouseholdCase {
  householdId: string;
  need: string; // resource kind the household needs, e.g. 'battery'
  // Latest reported backup window, anchored to observedAt. Missing lower bound = unknown.
  // "Under 30 minutes" is lower 0, upper 30. "Two hours or more" has no upper bound.
  evidence?: { observedAt: number; runtimeLowerMin?: number; runtimeUpperMin?: number };
  // Current check-in round. Silent when it is due and no reply arrived since it opened.
  round?: { openedAt: number; dueAt: number; lastReplyAt?: number };
}

export interface DispatchOption {
  routeId: string;
  driverId: string;
  assetId: string;
  assetKind: string;
  driverFreeAt: number;
  assetFreeAt: number;
  driverToAssetMin: number;
  pickupMin: number;
  assetToHomeMin: number;
  setupMin: number;
  confirmedDelayMin: number; // coordinator-confirmed route delay; 0 when none
}

export interface OptionResult {
  routeId: string;
  driverId: string;
  assetId: string;
  readyAt: number;
  marginLoMin?: number; // undefined when the window is unknown
  marginHiMin?: number; // undefined when unknown or open-ended
}

export interface CaseResult {
  householdId: string;
  lane: Lane;
  reason: string;
  // Contact status, independent of dispatch urgency: an Act now case can also be silent.
  silent: boolean;
  best?: OptionResult;
  options: OptionResult[]; // compatible options, best first
}

export function readyAt(option: DispatchOption, now: number): number {
  const atAsset = Math.max(now, option.driverFreeAt) + option.driverToAssetMin * MIN;
  const depart = Math.max(atAsset, option.assetFreeAt) + option.pickupMin * MIN;
  return depart + (option.assetToHomeMin + option.confirmedDelayMin + option.setupMin) * MIN;
}

function margin(observedAt: number, runtimeMin: number | undefined, ready: number) {
  if (runtimeMin === undefined) return undefined;
  return Math.floor((observedAt + runtimeMin * MIN - ready) / MIN);
}

export function evaluateOptions(
  household: HouseholdCase,
  options: DispatchOption[],
  now: number
): CaseResult {
  const ev = household.evidence;
  const known = ev?.runtimeLowerMin !== undefined;

  const results: OptionResult[] = options
    .filter(o => o.assetKind === household.need)
    .map(o => {
      const ready = readyAt(o, now);
      return {
        routeId: o.routeId,
        driverId: o.driverId,
        assetId: o.assetId,
        readyAt: ready,
        marginLoMin: ev && margin(ev.observedAt, ev.runtimeLowerMin, ready),
        marginHiMin: ev && margin(ev.observedAt, ev.runtimeUpperMin, ready),
      };
    })
    .sort((a, b) =>
      known ? b.marginLoMin! - a.marginLoMin! || a.readyAt - b.readyAt : a.readyAt - b.readyAt
    );
  const best = results[0];
  const r = household.round;
  const silent =
    !!r && now >= r.dueAt && !(r.lastReplyAt !== undefined && r.lastReplyAt >= r.openedAt);
  const base = { householdId: household.householdId, silent, best, options: results };

  if (!best) {
    return { ...base, lane: 'act_now', reason: `no compatible ${household.need} available` };
  }
  if (known && best.marginLoMin! < WATCH_MARGIN_MIN) {
    const reason =
      best.marginLoMin! < 0
        ? `every option misses the lower estimate; best ${best.routeId} short by ${-best.marginLoMin!} min, escalate`
        : `best ${best.routeId} margin +${best.marginLoMin} min, under +${WATCH_MARGIN_MIN}`;
    return { ...base, lane: 'act_now', reason };
  }
  if (silent) {
    return { ...base, lane: 'silent', reason: 'check-in round overdue without a reply' };
  }
  if (!known) {
    return { ...base, lane: 'unknown', reason: 'no actionable time window; clarify' };
  }
  return { ...base, lane: 'watch', reason: `best ${best.routeId} margin +${best.marginLoMin} min` };
}
