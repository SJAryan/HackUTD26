// TL-08: confirm an ingestCheckin landed by finding its row in A's bridge_checkins view.
// The view lists only this bridge's incident; household and checkin tables stay private (TL-05).
// Kept free of SpacetimeDB imports so tests can pass a fake view.

// The bridge_checkins fields this file reads (option(u32) arrives as number | undefined).
export type CheckinRow = {
  eventId: string;
  householdId: string;
  runtimeLowerMin?: number;
  runtimeUpperMin?: number;
};

export type Receipt = { householdId: string; runtimeLowerMin?: number; runtimeUpperMin?: number };

export function findReceipt(rows: Iterable<CheckinRow>, eventId: string): Receipt | undefined {
  for (const r of rows) {
    if (r.eventId === eventId) {
      return { householdId: r.householdId, runtimeLowerMin: r.runtimeLowerMin, runtimeUpperMin: r.runtimeUpperMin };
    }
  }
  return undefined;
}

// The view update can trail the reducer's reply, so look again briefly before reporting "no receipt".
export async function waitForReceipt(
  rows: () => Iterable<CheckinRow>, eventId: string, tries = 20, intervalMs = 100,
): Promise<Receipt | undefined> {
  for (let i = 0; ; i++) {
    const found = findReceipt(rows(), eventId);
    if (found || i >= tries - 1) return found;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const runtime = ({ runtimeLowerMin: lo, runtimeUpperMin: hi }: Receipt) =>
  lo === undefined ? (hi === undefined ? "no runtime" : `under ${hi} min`)
    : hi === undefined ? `${lo}+ min`
    : lo === hi ? `${lo} min`
    : `${lo}-${hi} min`;

export const describeReceipt = (r: Receipt | undefined) =>
  r ? `receipt found, ${r.householdId} ${runtime(r)}` : "no receipt";
