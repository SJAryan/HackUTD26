// TL-03 fixture for incident freeze-1, displayed as the second incident "Tornado outage" (TL-18).
// All data is synthetic. Household, route and resource IDs are distinct
// from tornado-1. Clock: 2026-01-20 06:00 America/Chicago = 12:00 UTC.
import { MIN, type DispatchOption, type HouseholdCase } from '../spacetimedb/src/domain/dispatch';

export const incidentId = 'freeze-1';
export const clockAt = Date.UTC(2026, 0, 20, 12, 0, 0);

export const households: HouseholdCase[] = [
  {
    // "Heater generator has under 30 minutes of fuel."
    householdId: 'F03',
    need: 'generator',
    evidence: { observedAt: clockAt, runtimeLowerMin: 0, runtimeUpperMin: 30 },
  },
  {
    // "Battery should last two hours or more." Open-ended upper bound.
    householdId: 'F09',
    need: 'battery',
    evidence: { observedAt: clockAt, runtimeLowerMin: 120 },
  },
  {
    householdId: 'F14',
    need: 'battery',
    round: { openedAt: clockAt, dueAt: clockAt + 5 * MIN },
  },
];

const leo = { driverId: 'leo', driverFreeAt: clockAt, assetFreeAt: clockAt, confirmedDelayMin: 0 };

export const options: DispatchOption[] = [
  // Ready at 06:18.
  { ...leo, routeId: 'FZ-R1', assetId: 'GEN-02', assetKind: 'generator',
    driverToAssetMin: 6, pickupMin: 3, assetToHomeMin: 7, setupMin: 2 },
  // Ready at 06:23.
  { ...leo, routeId: 'FZ-R2', assetId: 'BAT-07', assetKind: 'battery',
    driverToAssetMin: 10, pickupMin: 2, assetToHomeMin: 8, setupMin: 3 },
];
