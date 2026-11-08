// TL-03 tornado fixture. All data is synthetic. IDs match A's TL-01 seed.
// Clock: 2026-11-08 02:00 America/Chicago = 08:00 UTC.
import { MIN, type DispatchOption, type HouseholdCase } from '../spacetimedb/src/domain/dispatch';

export const incidentId = 'tornado-1';
export const clockAt = Date.UTC(2026, 10, 8, 8, 0, 0);

export const households: HouseholdCase[] = [
  {
    // Event tl01-h17-0200: "My backup shows 30-60 minutes left. Can the driver reach the side entrance?"
    householdId: 'H17',
    need: 'battery',
    evidence: { observedAt: clockAt, runtimeLowerMin: 30, runtimeUpperMin: 60 },
  },
  {
    // Silent: no evidence, and the first 5-minute check-in round goes unanswered.
    householdId: 'H22',
    need: 'battery',
    round: { openedAt: clockAt, dueAt: clockAt + 5 * MIN },
  },
];

const ana = { driverId: 'ana', driverFreeAt: clockAt, assetFreeAt: clockAt };
const bat01 = { assetId: 'BAT-01', assetKind: 'battery', pickupMin: 2, setupMin: 2 };

export const options: DispatchOption[] = [
  // R4 ready at 02:13.
  { ...ana, ...bat01, routeId: 'R4', driverToAssetMin: 5, assetToHomeMin: 4, confirmedDelayMin: 0 },
  // Alternate ready at 02:24.
  { ...ana, ...bat01, routeId: 'R4-ALT', driverToAssetMin: 5, assetToHomeMin: 15, confirmedDelayMin: 0 },
];

// Driver-reported detour, applied only after coordinator confirmation.
export const r4Detour = { routeId: 'R4', delayMin: 20 };
