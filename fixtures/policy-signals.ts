// TL-15 fixture. Synthetic policy signals only; no real insurance data.
import type { PolicySignals } from '../spacetimedb/src/domain/suggest';

export const policySignals: PolicySignals[] = [
  { householdId: 'H17', lifePolicyNotes: ['Uses home oxygen concentrator'], disabilityPolicy: true, homeMods: [], autoMods: [] },
  { householdId: 'H22', lifePolicyNotes: [], disabilityPolicy: true, homeMods: [], autoMods: [] },
  { householdId: 'F03', lifePolicyNotes: [], disabilityPolicy: false, homeMods: ['Front ramp'], autoMods: ['Hand controls'] },
  { householdId: 'F09', lifePolicyNotes: [], disabilityPolicy: false, homeMods: [], autoMods: [] },
];
