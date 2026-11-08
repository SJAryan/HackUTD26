// TL-15 prototype: suggest preparedness needs from synthetic policy signals.
// Suggestions are shown only to the resident, who confirms, corrects or skips.
// Only a confirmed need reaches dispatch. Never used for pricing, claims or eligibility.

export interface PolicySignals {
  householdId: string;
  lifePolicyNotes: string[];
  disabilityPolicy: boolean;
  homeMods: string[];
  autoMods: string[];
}

export interface NeedSuggestion {
  id: 'powered_equipment' | 'step_free_access';
  label: string; // shown to the resident; no diagnosis
  dispatchNeed?: string; // resource kind for evaluateOptions, when the need is equipment
  confidence: 'high' | 'medium' | 'low';
  sources: string[]; // which signals produced it, for the resident's confirm screen
}

const POWERED_EQUIPMENT = ['oxygen', 'ventilator', 'cpap', 'dialysis'];
const HOME_ACCESS = ['ramp', 'stair lift', 'widened doors'];
const AUTO_ACCESS = ['hand controls', 'wheelchair lift'];

const matches = (items: string[], terms: string[]) =>
  items.filter(item => terms.some(term => item.toLowerCase().includes(term)));

export function suggestNeeds(signals: PolicySignals): NeedSuggestion[] {
  const suggestions: NeedSuggestion[] = [];

  // A disability policy alone is too vague to suggest anything; it only raises confidence.
  const notes = matches(signals.lifePolicyNotes, POWERED_EQUIPMENT);
  if (notes.length) {
    suggestions.push({
      id: 'powered_equipment',
      label: 'Powered equipment that needs battery backup during an outage',
      dispatchNeed: 'battery',
      confidence: signals.disabilityPolicy ? 'high' : 'medium',
      sources: [
        ...notes.map(() => 'life policy note'),
        ...(signals.disabilityPolicy ? ['disability policy'] : []),
      ],
    });
  }

  const home = matches(signals.homeMods, HOME_ACCESS);
  const auto = matches(signals.autoMods, AUTO_ACCESS);
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

// The resident's answer. Skip stores nothing; a correction replaces the suggestion's need.
export type Confirmation =
  | { choice: 'confirm'; suggestion: NeedSuggestion }
  | { choice: 'correct'; dispatchNeed: string }
  | { choice: 'skip' };

export function confirmedNeed(answer: Confirmation): string | undefined {
  if (answer.choice === 'confirm') return answer.suggestion.dispatchNeed;
  if (answer.choice === 'correct') return answer.dispatchNeed;
  return undefined;
}
