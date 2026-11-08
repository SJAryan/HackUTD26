// FIXTURE MODE. Synthetic households, hand-entered numbers.
// Tornado numbers come from the TL-03 worked example (+17 / −3 / +6).
// Freeze numbers are placeholders until C delivers the TL-03 fixture.
// Replaced by C's fixture + evaluateOptions (TL-03) and A's subscriptions (TL-07).

export type Lane = 'Act now' | 'Silent' | 'Unknown' | 'Watch';

export type RouteOption = {
  routeId: string;
  assetId: string;
  driverId: string;
  compatible: boolean;
  readyAt: string;
  marginLo: number;
  marginHi: number | null; // null = no finite upper bound
  reason: string;
};

export type Case = {
  caseId: string;
  householdId: string;
  address: string;
  need: string;
  evidence: { text: string; observedAt: string; source: string } | null;
  windowLo: string | null;
  windowHi: string | null;
  lane: Lane;
  options: RouteOption[];
  // Lane and options once the incident's pending route report is confirmed.
  afterReport?: { lane: Lane; options: RouteOption[] };
  callback?: { owner: string; dueAt: string; reason: string };
};

export type Incident = {
  incidentId: string;
  name: string;
  clock: string;
  numbersSource: string;
  routeReport?: { reportId: string; routeId: string; delayMinutes: number; from: string; text: string };
  drivers: Record<string, string>;
  assets: Record<string, string>;
  cases: Case[];
};

const t = (hhmm: string, day = '2026-11-08') => `${day}T${hhmm}:00-06:00`;

export const incidents: Incident[] = [
  {
    incidentId: 'INC-TORNADO',
    name: 'Tornado power outage',
    clock: t('02:05'),
    numbersSource: 'Numbers from the TL-03 worked example',
    routeReport: {
      reportId: 'RR-1',
      routeId: 'R4',
      delayMinutes: 20,
      from: 'Ana',
      text: 'Tree down on the R4 route. Adds about 20 minutes.',
    },
    drivers: { ana: 'Ana' },
    assets: { 'BAT-3': 'Portable battery BAT-3' },
    cases: [
      {
        caseId: 'CASE-H17',
        householdId: 'H17',
        address: '1180 Larkspur Ln (synthetic)',
        need: 'Battery for home equipment',
        evidence: {
          text: 'My backup shows 30–60 minutes left. Can the driver reach the side entrance?',
          observedAt: t('02:00'),
          source: 'Text message',
        },
        windowLo: t('02:30'),
        windowHi: t('03:00'),
        lane: 'Watch',
        options: [
          { routeId: 'R4', assetId: 'BAT-3', driverId: 'ana', compatible: true, readyAt: t('02:13'), marginLo: 17, marginHi: 47, reason: 'Fastest route.' },
          { routeId: 'R7', assetId: 'BAT-3', driverId: 'ana', compatible: true, readyAt: t('02:24'), marginLo: 6, marginHi: 36, reason: 'Alternate route.' },
        ],
        afterReport: {
          lane: 'Act now',
          options: [
            { routeId: 'R4', assetId: 'BAT-3', driverId: 'ana', compatible: true, readyAt: t('02:33'), marginLo: -3, marginHi: 27, reason: 'Confirmed 20-minute detour. Misses the low estimate.' },
            { routeId: 'R7', assetId: 'BAT-3', driverId: 'ana', compatible: true, readyAt: t('02:24'), marginLo: 6, marginHi: 36, reason: 'Best remaining route.' },
          ],
        },
      },
      {
        caseId: 'CASE-H22',
        householdId: 'H22',
        address: '1204 Larkspur Ln (synthetic)',
        need: 'Not reported',
        evidence: null,
        windowLo: null,
        windowHi: null,
        lane: 'Silent',
        options: [],
        callback: { owner: 'Maya (coordinator)', dueAt: t('02:10'), reason: 'No reply to the 01:45 check-in.' },
      },
    ],
  },
  {
    incidentId: 'INC-FREEZE',
    name: 'Winter freeze',
    clock: t('05:15', '2026-01-21'),
    numbersSource: 'Placeholder numbers until C delivers TL-03',
    drivers: { joel: 'Joel' },
    assets: { 'BAT-8': 'Portable battery BAT-8' },
    cases: [
      {
        caseId: 'CASE-H41',
        householdId: 'H41',
        address: '77 Quarry Bend (synthetic)',
        need: 'Battery for space heater backup',
        evidence: {
          text: 'Heater backup says about 90 to 120 minutes.',
          observedAt: t('05:10', '2026-01-21'),
          source: 'Text message',
        },
        windowLo: t('06:40', '2026-01-21'),
        windowHi: t('07:10', '2026-01-21'),
        lane: 'Watch',
        options: [
          { routeId: 'F2', assetId: 'BAT-8', driverId: 'joel', compatible: true, readyAt: t('05:52', '2026-01-21'), marginLo: 48, marginHi: 78, reason: 'Only compatible battery.' },
        ],
      },
      {
        caseId: 'CASE-H45',
        householdId: 'H45',
        address: '81 Quarry Bend (synthetic)',
        need: 'Unclear',
        evidence: { text: 'My phone is at 20%.', observedAt: t('05:08', '2026-01-21'), source: 'Text message' },
        windowLo: null,
        windowHi: null,
        lane: 'Unknown',
        options: [],
        callback: { owner: 'Maya (coordinator)', dueAt: t('05:13', '2026-01-21'), reason: 'Phone battery is not an equipment runtime. Ask what the backup display shows.' },
      },
    ],
  },
];

// The resident and driver screens act as these synthetic identities.
export const DEMO_RESIDENT_CASE = 'CASE-H17';
export const DEMO_DRIVER = 'ana';

export function findCase(caseId: string) {
  for (const incident of incidents) {
    const c = incident.cases.find((x) => x.caseId === caseId);
    if (c) return { incident, c };
  }
  throw new Error(`Unknown case ${caseId}`);
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' });

export const fmtMargin = (m: number) => (m > 0 ? `+${m}` : m < 0 ? `−${Math.abs(m)}` : '0');
