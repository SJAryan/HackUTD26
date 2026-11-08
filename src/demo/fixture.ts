// FIXTURE MODE. Synthetic households and hand-entered numbers, replaced by A's
// subscriptions (TL-07) and C's evaluateOptions (TL-03). H17's routes reproduce
// C's TL-03 results (+17, then -3 after the 20-minute delay, R4-ALT +6), shifted
// to the 02:30 outage. All other households are generated filler.

export type Need = 'oxygen' | 'dialysis' | 'heat';
export type Lane = 'act' | 'watch' | 'unknown' | 'silent' | 'dispatched' | 'registered';
export type PollAnswer = 'Under 30 min' | '30 to 60' | '1 to 2 hrs' | '2+ hrs' | 'Not sure';

export const POLL_ANSWERS: PollAnswer[] = ['Under 30 min', '30 to 60', '1 to 2 hrs', '2+ hrs', 'Not sure'];
export const NEED_LABEL: Record<Need, string> = { oxygen: 'Home oxygen', dialysis: 'Home dialysis', heat: 'No heat' };
export const LANE_LABEL: Record<Lane, string> = {
  act: 'Act now',
  watch: 'Watch',
  unknown: 'Unknown',
  silent: 'Silent',
  dispatched: 'Dispatched',
  registered: 'Registered',
};

export const INCIDENT = { name: 'Winter freeze outage', area: 'North zone' };
export const OUTAGE_AT = 150; // 02:30, minutes after midnight
export const DEMO_ID = 'H17';
export const ACT_BELOW = 15; // a margin under +15 minutes is Act now

export type RouteOption = { routeId: string; assetId: string; driverId: string; readyAt: number; note: string };

// H17's options. The confirmed delay adds 20 minutes to R4 only.
export const H17_ROUTES: RouteOption[] = [
  { routeId: 'R4', assetId: 'BAT-01', driverId: 'Ana', readyAt: 171, note: 'Fastest route' },
  { routeId: 'R4-ALT', assetId: 'BAT-01', driverId: 'Ana', readyAt: 182, note: 'Alternate route' },
];
export const DELAY = { routeId: 'R4', minutes: 20, from: 'Ana', text: 'Tree down on R4. Adds about 20 minutes.' };

const BOUNDS: Record<PollAnswer, [number, number | null] | null> = {
  'Under 30 min': [0, 30],
  '30 to 60': [30, 60],
  '1 to 2 hrs': [60, 120],
  '2+ hrs': [120, null],
  'Not sure': null,
};

export type Option = RouteOption & { lo: number; hi: number | null };
export type Evaluation = { lane: Lane; window: [number, number | null] | null; options: Option[]; best?: Option };

// Fixture arithmetic only: margin = deadline - ready time, from the reply time.
export function evaluate(answer: PollAnswer, observedAt: number, delayConfirmed: boolean): Evaluation {
  const b = BOUNDS[answer];
  if (!b) return { lane: 'unknown', window: null, options: [] };
  const options = H17_ROUTES.map((r) => {
    const readyAt = r.readyAt + (delayConfirmed && r.routeId === DELAY.routeId ? DELAY.minutes : 0);
    return { ...r, readyAt, lo: observedAt + b[0] - readyAt, hi: b[1] === null ? null : observedAt + b[1] - readyAt };
  });
  const best = [...options].sort((x, y) => y.lo - x.lo)[0];
  return {
    lane: best.lo < ACT_BELOW ? 'act' : 'watch',
    window: [observedAt + b[0], b[1] === null ? null : observedAt + b[1]],
    options,
    best,
  };
}

export type Household = {
  id: string;
  name: string;
  need: Need;
  street: string;
  lane: Lane;
  report: string;
  margin: number | null;
  best: string;
  owner?: string;
  dueAt?: number;
};

// Deterministic filler so every reload shows the same 200 households.
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
}
const STREETS = ['Larkspur Ln', 'Quarry Bend', 'Pecan Hollow', 'Briar Ridge', 'Cedar Fork', 'Mill Run', 'Sable Ct', 'Juniper Way'];
const NAMES = ['M. Alvarez', 'D. Okafor', 'R. Nguyen', 'L. Brooks', 'T. Haddad', 'S. Patel', 'G. Moreno', 'K. Lindqvist', 'A. Romero', 'P. Ward'];

const FEATURED: Household[] = [
  { id: 'H108', name: 'L. Brooks', need: 'heat', street: '9 Briar Ridge', lane: 'act', report: '“49 degrees inside”', margin: 8, best: 'Ride, Rosa' },
  { id: 'H52', name: 'D. Okafor', need: 'dialysis', street: '62 Quarry Bend', lane: 'act', report: 'Next treatment 06:00', margin: 9, best: 'GEN-02, Leo' },
  { id: 'H64', name: 'R. Nguyen', need: 'oxygen', street: '140 Pecan Hollow', lane: 'unknown', report: '“Not sure”', margin: null, best: 'Follow-up sent', owner: 'Maya', dueAt: 161 },
  { id: 'H22', name: 'T. Haddad', need: 'oxygen', street: '1204 Larkspur Ln', lane: 'silent', report: 'No reply since 02:31', margin: null, best: 'Callback', owner: 'Maya', dueAt: 170 },
  { id: 'H31', name: 'S. Patel', need: 'oxygen', street: '23 Cedar Fork', lane: 'watch', report: '“1 to 2 hrs”', margin: 23, best: 'BAT-04, Rosa' },
];

function generate(): Household[] {
  const r = rng(17);
  const out: Household[] = [];
  const taken = new Set([DEMO_ID, ...FEATURED.map((h) => h.id)]);
  for (let n = 1; n <= 200; n++) {
    const id = `H${n}`;
    if (taken.has(id)) continue;
    const roll = r();
    const need: Need = roll < 0.55 ? 'oxygen' : roll < 0.8 ? 'heat' : 'dialysis';
    const pick = r();
    const lane: Lane = pick < 0.09 ? 'unknown' : pick < 0.13 ? 'silent' : pick < 0.16 ? 'dispatched' : 'watch';
    const margin = lane === 'watch' ? 16 + Math.floor(r() * 120) : null;
    const said = margin === null ? '' : margin > 75 ? '“2+ hrs”' : margin > 40 ? '“1 to 2 hrs”' : '“30 to 60”';
    const driver = n % 2 ? 'Leo' : 'Rosa';
    out.push({
      id,
      name: NAMES[n % NAMES.length],
      need,
      street: `${10 + ((n * 37) % 1400)} ${STREETS[n % STREETS.length]}`,
      lane,
      report:
        lane === 'unknown' ? '“Not sure”'
        : lane === 'silent' ? 'No reply since 02:31'
        : lane === 'dispatched' ? 'Delivered'
        : need === 'heat' ? `“${55 + (n % 9)} degrees inside”`
        : need === 'dialysis' ? 'Next treatment 08:00'
        : said,
      margin,
      best:
        lane === 'unknown' ? 'Follow-up sent'
        : lane === 'silent' ? 'Callback'
        : lane === 'dispatched' ? 'Delivered'
        : need === 'heat' ? `Ride, ${driver}`
        : need === 'dialysis' ? `Generator, ${driver}`
        : `Battery, ${driver}`,
      owner: lane === 'unknown' || lane === 'silent' ? 'Maya' : undefined,
      dueAt: lane === 'unknown' ? 158 + (n % 6) : lane === 'silent' ? 170 : undefined,
    });
  }
  return [...FEATURED, ...out];
}

export const OTHERS = generate();

export const RESOURCES = { batteries: 6, batteriesOut: 4, generators: 2, generatorsOut: 1, drivers: 3, driversBusy: 2 };

export const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const signed = (m: number) => (m > 0 ? `+${m}` : m < 0 ? `−${Math.abs(m)}` : '0');
