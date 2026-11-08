// TL-15 prototype: suggest preparedness needs from synthetic policy signals.
// Suggestions are shown only to the resident, who confirms, corrects or skips.
// Only a confirmed need reaches dispatch. Never used for pricing, claims or eligibility.

// Signals are coded fields, not free text, so "trampoline" or "does not use oxygen"
// cannot produce a suggestion. Codes outside these lists are ignored.
const POWERED_EQUIPMENT = ['oxygen_concentrator', 'ventilator', 'cpap', 'home_dialysis'] as const;
const HOME_ACCESS = ['ramp', 'stair_lift', 'widened_doors'] as const;
const AUTO_ACCESS = ['hand_controls', 'wheelchair_lift'] as const;

export interface PolicySignals {
  householdId: string;
  lifePolicyEquipment: Array<(typeof POWERED_EQUIPMENT)[number]>; // equipment listed on the life policy
  disabilityPolicy: boolean;
  homeMods: Array<(typeof HOME_ACCESS)[number]>;
  autoMods: Array<(typeof AUTO_ACCESS)[number]>;
}

export interface NeedSuggestion {
  id: 'powered_equipment' | 'step_free_access';
  label: string; // shown to the resident; no diagnosis
  dispatchNeed?: string; // resource kind for evaluateOptions, when the need is equipment
  confidence: 'high' | 'medium' | 'low';
  sources: string[]; // which signals produced it, for the resident's confirm screen
}

const known = <T extends string>(items: readonly string[], codes: readonly T[]) =>
  items.filter((item): item is T => (codes as readonly string[]).includes(item));

export function suggestNeeds(signals: PolicySignals): NeedSuggestion[] {
  const suggestions: NeedSuggestion[] = [];

  // A disability policy alone is too vague to suggest anything; it only raises confidence.
  const equipment = known(signals.lifePolicyEquipment, POWERED_EQUIPMENT);
  if (equipment.length) {
    suggestions.push({
      id: 'powered_equipment',
      label: 'Powered equipment that needs battery backup during an outage',
      dispatchNeed: 'battery',
      confidence: signals.disabilityPolicy ? 'high' : 'medium',
      sources: ['life policy: listed equipment', ...(signals.disabilityPolicy ? ['disability policy'] : [])],
    });
  }

  const home = known(signals.homeMods, HOME_ACCESS);
  const auto = known(signals.autoMods, AUTO_ACCESS);
  if (home.length || auto.length) {
    suggestions.push({
      id: 'step_free_access',
      label: 'Step-free access for the driver',
      confidence: home.length && auto.length ? 'medium' : 'low',
      sources: [...home.map(m => `home modification: ${m}`), ...auto.map(m => `car modification: ${m}`)],
    });
  }

  return suggestions;
}

// What A stores with the consent record. Skip stores nothing.
// Step-free access has no dispatchNeed but is kept as a driver note.
export interface ConfirmedNeed {
  id: NeedSuggestion['id'];
  dispatchNeed?: string;
}

export type Confirmation =
  | { choice: 'confirm'; suggestion: NeedSuggestion }
  | { choice: 'correct'; need: ConfirmedNeed }
  | { choice: 'skip' };

export function confirmedNeed(answer: Confirmation): ConfirmedNeed | undefined {
  if (answer.choice === 'confirm') {
    const { id, dispatchNeed } = answer.suggestion;
    return dispatchNeed === undefined ? { id } : { id, dispatchNeed };
  }
  if (answer.choice === 'correct') return answer.need;
  return undefined;
}
