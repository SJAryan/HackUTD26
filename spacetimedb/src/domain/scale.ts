// TL-21: deterministic generator for ~200 synthetic registered households in the lead incident.
// Pure TypeScript, no clocks: every time is clockAt plus an offset, so A can anchor it to the
// reset time. Adds H101-H298 next to A's H17 and H22, whose numbers stay as locked in TL-03.
// All data is synthetic: no names, addresses or phone numbers. Also the data for #11's benchmark.
import { MIN, evaluateOptions, type DispatchOption, type HouseholdCase } from './dispatch';

export type Answer = 'under_30' | '30_60' | '1_2h' | '2h_plus' | 'not_sure' | 'silent' | 'no_compatible';

// POLL answers mapped to reported windows. "Under 30" has a zero lower bound; "2+ hrs" no upper.
const WINDOWS: Record<string, [number | undefined, number | undefined]> = {
  under_30: [0, 30],
  '30_60': [30, 60],
  '1_2h': [60, 120],
  '2h_plus': [120, undefined],
  not_sure: [undefined, undefined],
  no_compatible: [30, 60],
};

// 198 generated households; with H17 and H22 the incident has 200.
export const MIX: Record<Answer, number> = {
  under_30: 30, '30_60': 50, '1_2h': 40, '2h_plus': 30, not_sure: 20, silent: 20, no_compatible: 8,
};
export const DRIVERS = 12;
export const BATTERIES = 40; // fewer batteries than battery needs

export interface ScaleHousehold extends HouseholdCase {
  label: string;
  answer: Answer;
}
export interface ScaleRoute extends DispatchOption {
  householdId: string;
}
export interface Scale {
  households: ScaleHousehold[];
  drivers: { id: string; name: string; freeAt: number }[];
  assets: { id: string; kind: string; freeAt: number }[];
  routes: ScaleRoute[];
}

// mulberry32: small seeded PRNG, so every run produces the same rows.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), a | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateScale(clockAt: number, seed = 21): Scale {
  const rand = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pad = (n: number, w: number) => String(n).padStart(w, '0');

  const answers = (Object.keys(MIX) as Answer[]).flatMap(a => Array<Answer>(MIX[a]).fill(a));
  for (let i = answers.length - 1; i > 0; i--) {
    const j = int(0, i);
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }

  const drivers = Array.from({ length: DRIVERS }, (_, i) => ({
    id: `drv-${pad(i + 1, 2)}`, name: `Driver ${pad(i + 1, 2)} (synthetic)`, freeAt: clockAt,
  }));
  const assets = Array.from({ length: BATTERIES }, (_, i) => ({
    id: `BAT-${100 + i + 1}`, kind: 'battery', freeAt: clockAt,
  }));

  const households: ScaleHousehold[] = [];
  const routes: ScaleRoute[] = [];
  answers.forEach((answer, i) => {
    const id = `H${101 + i}`;
    const need = answer === 'no_compatible' ? 'generator' : 'battery';
    const home: ScaleHousehold = { householdId: id, label: `Household ${id} (synthetic)`, need, answer };
    if (answer === 'silent') {
      // Polled before the reset and overdue at it, with no reply and no evidence.
      home.round = { openedAt: clockAt - 15 * MIN, dueAt: clockAt - 10 * MIN };
    } else {
      const [lo, hi] = WINDOWS[answer];
      home.evidence = { observedAt: clockAt - int(0, 10) * MIN, runtimeLowerMin: lo, runtimeUpperMin: hi };
    }
    households.push(home);

    // Two nearby battery options each. A generator need has none compatible.
    for (const suffix of ['a', 'b']) {
      routes.push({
        householdId: id,
        routeId: `R-${id}-${suffix}`,
        driverId: drivers[int(0, DRIVERS - 1)].id,
        assetId: assets[int(0, BATTERIES - 1)].id,
        assetKind: 'battery',
        driverFreeAt: clockAt,
        assetFreeAt: clockAt,
        driverToAssetMin: int(2, 10),
        pickupMin: int(2, 3),
        assetToHomeMin: int(3, 20),
        setupMin: int(2, 3),
        confirmedDelayMin: 0,
      });
    }
  });

  return { households, drivers, assets, routes };
}

// Lane counts as evaluateOptions computes them, for A's seed and D's board to reconcile against.
export function laneCounts(scale: Scale, now: number) {
  const counts = { act_now: 0, watch: 0, unknown: 0, silent: 0 };
  for (const h of scale.households) {
    const options = scale.routes.filter(r => r.householdId === h.householdId);
    counts[evaluateOptions(h, options, now).lane]++;
  }
  return counts;
}
