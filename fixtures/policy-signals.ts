// TL-15 fixture. Synthetic policy signals only; no real insurance data.
import type { PolicySignals } from '../spacetimedb/src/domain/suggest';

export const policySignals: PolicySignals[] = [
  { householdId: 'H17', lifePolicyEquipment: ['oxygen_concentrator'], disabilityPolicy: true, homeMods: [], autoMods: [] },
  { householdId: 'H22', lifePolicyEquipment: [], disabilityPolicy: true, homeMods: [], autoMods: [] },
  { householdId: 'F03', lifePolicyEquipment: [], disabilityPolicy: false, homeMods: ['ramp'], autoMods: ['hand_controls'] },
  { householdId: 'F09', lifePolicyEquipment: [], disabilityPolicy: false, homeMods: [], autoMods: [] },
];
