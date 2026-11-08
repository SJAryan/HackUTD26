// TL-15 prototype: the resident confirms, corrects or skips each need C's suggestNeeds
// finds in synthetic policy signals. Only what the resident confirms or corrects is kept; the
// policy sources stay on this screen and never reach the coordinator or driver.
import { useState } from 'react';
import { suggestNeeds, type NeedSuggestion } from '../../spacetimedb/src/domain/suggest';
import { policySignals } from '../../fixtures/policy-signals';
import { Icon } from '../ui/icons';
import { keptNeeds, type Choice, type Choices, type KeptNeed } from './policyChoice';

type Props = {
  householdId: string;
  // false in live mode until A's enrollPreparedness stores the answer: the copy then only
  // promises what the form itself does.
  saved: boolean;
  equipmentInputId: string; // focused when the resident uses different equipment
  onChange: (kept: KeptNeed[]) => void;
};

export function PolicyCheck({ householdId, saved, equipmentInputId, onChange }: Props) {
  const signals = policySignals.find((s) => s.householdId === householdId);
  const suggestions = signals ? suggestNeeds(signals) : [];
  const [choices, setChoices] = useState<Choices>({});
  const [correcting, setCorrecting] = useState<NeedSuggestion['id'] | null>(null);
  if (suggestions.length === 0) return null;

  const decide = (s: NeedSuggestion, choice?: Choice) => {
    const next: Choices = { ...choices, [s.id]: choice };
    setChoices(next);
    setCorrecting(null);
    onChange(keptNeeds(suggestions, next));
    if (choice === 'different') document.getElementById(equipmentInputId)?.focus();
  };

  const result = (s: NeedSuggestion, c: Choice) => {
    if (c === 'confirm') {
      if (!saved) return 'Selected for this form. Only the need you choose below is saved in this live demo.';
      return s.dispatchNeed ? 'Confirmed. The response team sees it as self-confirmed.' : 'Confirmed. Your driver gets it as an access note.';
    }
    if (c === 'different') {
      return saved
        ? 'Noted as corrected. Describe your equipment under Equipment and backup below.'
        : 'Describe your equipment under Equipment and backup below. Only the form is saved in this live demo.';
    }
    if (c === 'not_mine') return "Removed. Nothing from your policy is saved for this, and the help you get is the same.";
    return 'Skipped. Nothing from your policy is saved, and the help you get is the same.';
  };

  return (
    <section className="policy" aria-label="Suggestions from your policy">
      <p className="policy-label">Prototype – synthetic policy data</p>
      <p className="policy-title">Based on your policy, do you rely on:</p>
      {suggestions.map((s) => {
        const c = choices[s.id];
        return (
          <div key={s.id} className={`policy-item ${c === 'confirm' || c === 'different' ? 'kept' : ''}`}>
            <p><b>{s.label}</b></p>
            <p className="sub">Based on: {s.sources.join(', ')}. Confidence {s.confidence}.</p>
            {!c && correcting !== s.id && (
              <div className="policy-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(s, 'confirm')}>Yes, confirm</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCorrecting(s.id)}>Correct it</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => decide(s, 'skip')}>Skip</button>
              </div>
            )}
            {!c && correcting === s.id && (
              <div className="policy-actions" role="group" aria-label={`Correct: ${s.label}`}>
                {s.dispatchNeed && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(s, 'different')}>I use different powered equipment</button>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => decide(s, 'not_mine')}>This doesn't apply to me</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCorrecting(null)}>Back</button>
              </div>
            )}
            {c && <p className="policy-result">{(c === 'confirm' || c === 'different') && saved && <Icon name="checkCircle" size={14} />} {result(s, c)}</p>}
            {c && <button type="button" className="link-btn" onClick={() => decide(s)}>Change</button>}
          </div>
        );
      })}
      <p className="policy-fine">Suggestions never affect pricing, claims or eligibility. Help never depends on answering.</p>
    </section>
  );
}
