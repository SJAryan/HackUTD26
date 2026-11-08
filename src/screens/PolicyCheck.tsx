// TL-15 prototype: the resident confirms, corrects or skips each need C's suggestNeeds
// finds in synthetic policy signals. Only what the resident confirms is kept; the policy
// sources stay on this screen and never reach the coordinator or driver.
import { useState } from 'react';
import { confirmedNeed, suggestNeeds, type ConfirmedNeed, type NeedSuggestion } from '../../spacetimedb/src/domain/suggest';
import { policySignals } from '../../fixtures/policy-signals';
import { Icon } from '../ui/icons';

type Choice = 'confirm' | 'correct' | 'skip';
type Choices = Partial<Record<NeedSuggestion['id'], Choice>>;

export function PolicyCheck({ householdId, onChange }: { householdId: string; onChange: (kept: ConfirmedNeed[], corrected: boolean) => void }) {
  const signals = policySignals.find((s) => s.householdId === householdId);
  const suggestions = signals ? suggestNeeds(signals) : [];
  const [choices, setChoices] = useState<Choices>({});
  if (suggestions.length === 0) return null;

  const decide = (s: NeedSuggestion, choice?: Choice) => {
    const next: Choices = { ...choices, [s.id]: choice };
    setChoices(next);
    // Correct means the resident picks the need in the form below, so nothing is kept from the suggestion.
    const kept = suggestions
      .filter((x) => next[x.id] === 'confirm')
      .map((x) => confirmedNeed({ choice: 'confirm', suggestion: x })!);
    onChange(kept, Object.values(next).includes('correct'));
  };

  return (
    <section className="policy" aria-label="Suggestions from your policy">
      <p className="policy-label">Prototype – synthetic policy data</p>
      <p className="policy-title">Based on your policy, do you rely on:</p>
      {suggestions.map((s) => {
        const c = choices[s.id];
        return (
          <div key={s.id} className={`policy-item ${c ?? ''}`}>
            <p><b>{s.label}</b></p>
            <p className="sub">Based on: {s.sources.join(', ')}. Confidence {s.confidence}.</p>
            {!c && (
              <div className="policy-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(s, 'confirm')}>Yes, confirm</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => decide(s, 'correct')}>Correct it</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => decide(s, 'skip')}>Skip</button>
              </div>
            )}
            {c === 'confirm' && <p className="policy-result"><Icon name="checkCircle" size={14} /> Confirmed. {s.dispatchNeed ? 'The response team sees it as self-confirmed.' : 'Your driver gets it as an access note.'}</p>}
            {c === 'correct' && <p className="policy-result">Choose what applies in the form below. Your answer replaces the suggestion.</p>}
            {c === 'skip' && <p className="policy-result">Skipped. Nothing from your policy is saved, and the help you get is the same.</p>}
            {c && <button type="button" className="link-btn" onClick={() => decide(s)}>Change</button>}
          </div>
        );
      })}
      <p className="policy-fine">Suggestions never affect pricing, claims or eligibility. Help never depends on answering.</p>
    </section>
  );
}
