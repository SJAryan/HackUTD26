// TL-15: what the resident's answers to the policy suggestions keep. Pure, so it is tested
// in fixtures/policy-choice.test.ts alongside C's suggestNeeds tests.
import { confirmedNeed, type ConfirmedNeed, type NeedSuggestion } from '../../spacetimedb/src/domain/suggest';

// confirm: yes, as suggested. different: yes, but different equipment (the resident describes it
// in the form). not_mine: the suggestion is wrong. skip: no answer. Only the first two keep a need.
export type Choice = 'confirm' | 'different' | 'not_mine' | 'skip';
export type Choices = Partial<Record<NeedSuggestion['id'], Choice>>;
export type KeptNeed = ConfirmedNeed & { corrected?: true };

export function keptNeeds(suggestions: readonly NeedSuggestion[], choices: Choices): KeptNeed[] {
  return suggestions.flatMap((s): KeptNeed[] => {
    const c = choices[s.id];
    if (c === 'confirm') return [confirmedNeed({ choice: 'confirm', suggestion: s })!];
    if (c === 'different' && s.dispatchNeed) {
      return [{ ...confirmedNeed({ choice: 'correct', need: { id: s.id, dispatchNeed: s.dispatchNeed } })!, corrected: true }];
    }
    return [];
  });
}

// The coordinator's Need line. A correction replaces the registered label with what dispatch
// uses, since the resident described different equipment. Never includes the policy sources.
export function needLine(registered: string, kept: readonly KeptNeed[] | undefined) {
  const need = kept?.find((k) => k.dispatchNeed);
  if (!need) return registered;
  return need.corrected
    ? `Powered equipment, ${need.dispatchNeed} backup, corrected by the resident via preparedness profile`
    : `${registered}, self-confirmed via preparedness profile`;
}
