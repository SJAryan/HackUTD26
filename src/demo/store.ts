// FIXTURE MODE store. One state object in localStorage, synced across tabs so the
// board, resident phone and driver phone can run side by side. A (TL-07) swaps
// these actions for reducer calls with the same arguments and results.
import type { KeptNeed } from '../screens/policyChoice';
import { useSyncExternalStore } from 'react';
import { DELAY, DEMO_ID, H17_ROUTES, OTHERS, OUTAGE_AT, evaluate, fmt, type Household, type Need, type PollAnswer } from './fixture';

export type Result = { kind: 'committed' | 'duplicate' | 'conflict'; text: string };
export type Msg = { id: string; from: 'system' | 'resident' | 'driver'; text: string; at: number; channel: 'iMessage' | 'Call' | 'Chat' };
export type Event = { at: number; kind: 'registry' | 'outreach' | 'reply' | 'report' | 'decision' | 'dispatch' | 'delivery' | 'consent'; text: string; who: string };
// TL-09: one private, consented request for a State Farm agent to follow up. A prototype lead, not a sale.
export type AgentRequest = { consentId: string; leadId: string; at: number; contact: string };
export type JobStatus = 'reserved' | 'en_route' | 'arrived' | 'received';
export type Job = { jobId: string; requestId: string; routeId: string; assetId: string; driverId: string; version: number; status: JobStatus; eta: number };
export type Registration = { name: string; age: string; phone: string; address: string; need: Need; equipment: string; contact: string; confirmed?: KeptNeed[] };

export type DemoState = {
  clock: number;
  registration: Registration | null;
  outage: boolean;
  pollSentAt: number | null;
  call: 'none' | 'ringing' | 'answered' | 'missed';
  answer: PollAnswer | null;
  answeredAt: number | null;
  answeredVia: 'iMessage' | 'Call' | null;
  delayReported: boolean;
  delayConfirmed: boolean;
  caseVersion: number;
  job: Job | null;
  messages: Msg[];
  events: Event[];
  last: Result | null;
  agentRequest: AgentRequest | null;
  agentSkipped: boolean;
};

const KEY = 'before-zero-demo-v1';

export const INITIAL: DemoState = {
  clock: 141, // 02:21, before the outage
  registration: null,
  outage: false,
  pollSentAt: null,
  call: 'none',
  answer: null,
  answeredAt: null,
  answeredVia: null,
  delayReported: false,
  delayConfirmed: false,
  caseVersion: 1,
  job: null,
  messages: [],
  events: [],
  last: null,
  agentRequest: null,
  agentSkipped: false,
};

function load(): DemoState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...INITIAL, ...(JSON.parse(raw) as DemoState) } : INITIAL;
  } catch {
    return INITIAL;
  }
}

let state = load();
const listeners = new Set<() => void>();

function set(next: DemoState) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private window: state still works in this tab */
  }
  listeners.forEach((l) => l());
}

window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  state = load();
  listeners.forEach((l) => l());
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useDemo = () => useSyncExternalStore(subscribe, () => state);
export const getDemo = () => state;

const at = (m: number) => Math.max(state.clock, m);
const id = () => Math.random().toString(36).slice(2, 9);
const ev = (e: Omit<Event, 'at'> & { at?: number }): Event => ({ at: e.at ?? state.clock, ...e });

export function register(reg: Registration) {
  const clock = at(142);
  set({
    ...state,
    clock,
    registration: reg,
    events: [...state.events, ev({ at: clock, kind: 'registry', who: 'Website', text: `${DEMO_ID} joined the registry: ${reg.equipment.toLowerCase()}, contact by ${reg.contact}.` })],
  });
}

export function startOutage() {
  if (state.outage) return;
  set({
    ...state,
    clock: OUTAGE_AT + 1,
    outage: true,
    pollSentAt: OUTAGE_AT + 1,
    messages: [
      ...state.messages,
      { id: id(), from: 'system', channel: 'iMessage', at: OUTAGE_AT + 1, text: 'Before Zero check-in: the power is out on your street. How much oxygen backup do you have left?' },
    ],
    events: [
      ...state.events,
      ev({ at: OUTAGE_AT, kind: 'outreach', who: 'Utility feed', text: 'Outage reported in North zone. 200 registered households affected.' }),
      ev({ at: OUTAGE_AT + 1, kind: 'outreach', who: 'Photon', text: 'iMessage poll sent: “How much oxygen backup do you have left?”' }),
    ],
  });
}

// The automated call goes out 5 simulated minutes after the poll (02:36) if nobody replied.
// The demo compresses that wait to AUTO_CALL_MS of real time. A coordinator can call early,
// or call again after the resident declines.
export const AUTO_CALL_MS = 8000;

export function placeCall(reason: 'auto' | 'manual') {
  if (!state.outage || state.answer || state.call === 'ringing' || state.call === 'answered') return;
  if (reason === 'auto' && state.call !== 'none') return;
  const clock = at(156);
  const text =
    state.call === 'missed' ? 'Call was declined. Coordinator called again.'
    : reason === 'auto' ? 'No reply after 5 minutes. Automated call placed.'
    : 'Coordinator placed the call before the 5-minute mark.';
  set({ ...state, clock, call: 'ringing', events: [...state.events, ev({ at: clock, kind: 'outreach', who: 'Voice', text })] });
}

export function answerCall(pick: boolean) {
  if (state.call !== 'ringing') return;
  set({ ...state, call: pick ? 'answered' : 'missed' });
}

// "Not sure" sends a follow-up and keeps the question open; the next answer replaces it.
export const FOLLOW_UP_TEXT = 'Thanks. If you can, check the gauge on your backup tank or the display on your concentrator, then pick the closest answer.';
export const pollOpen = (s: DemoState) => s.outage && !s.job && (!s.answer || s.answer === 'Not sure');

export function answerPoll(answer: PollAnswer, via: 'iMessage' | 'Call') {
  if (!pollOpen(state)) return;
  const clock = at(state.answer === 'Not sure' ? (state.answeredAt ?? 158) + 3 : 158);
  const e = evaluate(answer, clock, state.delayConfirmed);
  const window = e.window ? `${fmt(e.window[0])} to ${e.window[1] === null ? 'later' : fmt(e.window[1])}` : 'unknown';
  set({
    ...state,
    clock,
    answer,
    answeredAt: clock,
    answeredVia: via,
    call: via === 'Call' ? 'answered' : state.call === 'ringing' ? 'none' : state.call,
    caseVersion: state.caseVersion + 1,
    messages: [
      ...state.messages,
      { id: id(), from: 'resident', channel: via, at: clock, text: answer },
      ...(answer === 'Not sure' ? [{ id: id(), from: 'system' as const, channel: 'iMessage' as const, at: clock + 1, text: FOLLOW_UP_TEXT }] : []),
    ],
    events: [
      ...state.events,
      ev({ at: clock, kind: 'reply', who: `${DEMO_ID} by ${via}`, text: answer === 'Not sure' ? '“Not sure”. Margin unknown.' : `“${answer}”. Backup runs out ${window}.` }),
      ...(answer === 'Not sure' ? [ev({ at: clock + 1, kind: 'outreach', who: 'Photon', text: `Follow-up sent by iMessage. Maya owns this case, due ${fmt(clock + 6)}.` })] : []),
      ...(e.best ? [ev({ at: clock, kind: 'decision', who: 'Rules', text: `Best option ${e.best.routeId}, ready ${fmt(e.best.readyAt)}, margin ${e.best.lo} min. Lane ${e.lane === 'act' ? 'Act now' : 'Watch'}.` })] : []),
    ],
  });
}

export function reportDelay() {
  if (state.delayReported) return;
  const clock = at(160);
  set({
    ...state,
    clock,
    delayReported: true,
    events: [...state.events, ev({ at: clock, kind: 'report', who: DELAY.from, text: `Road report, not yet confirmed: “${DELAY.text}”` })],
  });
}

export function confirmDelay() {
  if (!state.delayReported || state.delayConfirmed) return;
  const clock = at(160);
  const e = state.answer && state.answeredAt !== null ? evaluate(state.answer, state.answeredAt, true) : null;
  const job = state.job;
  const moveJob = job && job.routeId === DELAY.routeId && (job.status === 'reserved' || job.status === 'en_route');
  const newEta = moveJob ? job.eta + DELAY.minutes : 0;
  set({
    ...state,
    clock,
    delayConfirmed: true,
    caseVersion: state.caseVersion + 1,
    job: moveJob ? { ...job, eta: newEta, version: job.version + 1 } : job,
    messages: moveJob
      ? [...state.messages, { id: id(), from: 'system', channel: 'iMessage', at: clock, text: `Update: the road is slower than expected. ${job.driverId} now arrives about ${fmt(newEta)}.` }]
      : state.messages,
    events: [
      ...state.events,
      ev({ at: clock, kind: 'decision', who: 'Coordinator', text: `Confirmed +${DELAY.minutes} min on ${DELAY.routeId}.` }),
      ...(moveJob ? [ev({ at: clock, kind: 'dispatch', who: 'Rules', text: `${job.jobId} is on ${DELAY.routeId}. New arrival ${fmt(newEta)}. Resident told the new time.` })] : []),
      ...(e?.best ? [ev({ at: clock, kind: 'decision', who: 'Rules', text: `Recomputed. ${DELAY.routeId} is now ${e.options.find((o) => o.routeId === DELAY.routeId)!.lo} min. Best is ${e.best.routeId} at +${e.best.lo}. Lane ${e.lane === 'act' ? 'Act now' : 'Watch'}.` })] : []),
    ],
  });
}

// Contract: reserve(jobRequestId, caseId, routeId, assetId, driverId, expectedVersion).
export function reserve(jobRequestId: string, caseId: string, routeId: string, assetId: string, driverId: string, expectedVersion: number): Result {
  const route = H17_ROUTES.find((r) => r.routeId === routeId);
  if (state.job) {
    const r: Result = state.job.requestId === jobRequestId
      ? { kind: 'duplicate', text: `Already reserved as ${state.job.jobId}. Nothing new was sent.` }
      : { kind: 'conflict', text: `${state.job.assetId} is already on ${state.job.jobId}. Refresh before reserving again.` };
    set({ ...state, last: r });
    return r;
  }
  if (!route || caseId !== DEMO_ID) return { kind: 'conflict', text: 'Unknown route for this case.' };
  if (route.assetId !== assetId || route.driverId !== driverId) {
    return { kind: 'conflict', text: `Rejected: ${routeId} does not join ${assetId} and ${driverId} for ${caseId}. Nothing was written.` };
  }
  if (expectedVersion !== state.caseVersion) {
    const r: Result = { kind: 'conflict', text: 'The case changed since you opened it. Review the new margin and try again.' };
    set({ ...state, last: r });
    return r;
  }
  const clock = at(161);
  const eta = route.readyAt + (state.delayConfirmed && routeId === DELAY.routeId ? DELAY.minutes : 0);
  const job: Job = { jobId: 'J-1', requestId: jobRequestId, routeId, assetId, driverId, version: 1, status: 'reserved', eta };
  const r: Result = { kind: 'committed', text: `Reserved ${assetId} with ${driverId} on ${routeId}. Job ${job.jobId}.` };
  set({
    ...state,
    clock,
    job,
    caseVersion: state.caseVersion + 1,
    last: r,
    messages: [
      ...state.messages,
      { id: id(), from: 'system', channel: 'iMessage', at: clock, text: `A backup battery is on the way. ${route.driverId} arrives about ${fmt(eta)}. Reply here to message her.` },
    ],
    events: [
      ...state.events,
      ev({ at: clock, kind: 'dispatch', who: 'Coordinator', text: `Reserved ${route.assetId}, ${route.driverId}, ${routeId}. Committed as ${job.jobId}.` }),
      ev({ at: clock, kind: 'outreach', who: 'Photon', text: `Resident told: arriving about ${fmt(eta)}, driver ${route.driverId}. Sent after commit.` }),
    ],
  });
  return r;
}

const NEXT: Record<JobStatus, JobStatus | null> = { reserved: 'en_route', en_route: 'arrived', arrived: 'received', received: null };

export function updateJob(jobId: string, expectedVersion: number, status: JobStatus): Result {
  const job = state.job;
  if (!job || job.jobId !== jobId) return { kind: 'conflict', text: 'No such job.' };
  if (job.status === status) return { kind: 'duplicate', text: 'Already recorded.' };
  if (job.version !== expectedVersion || NEXT[job.status] !== status) return { kind: 'conflict', text: 'Job changed. Refresh.' };
  const clock = status === 'en_route' ? at(162) : status === 'arrived' ? at(job.eta) : at(job.eta + 2);
  const text = status === 'en_route' ? `${job.driverId} left with ${job.assetId}.` : status === 'arrived' ? `${job.driverId} arrived at ${DEMO_ID}.` : `${DEMO_ID} confirmed the battery was received.`;
  set({
    ...state,
    clock,
    job: { ...job, status, version: job.version + 1 },
    messages: status === 'arrived'
      ? [...state.messages, { id: id(), from: 'system', channel: 'iMessage', at: clock, text: `${job.driverId} is at your door with the battery.` }]
      : state.messages,
    events: [...state.events, ev({ at: clock, kind: status === 'received' ? 'delivery' : 'dispatch', who: status === 'received' ? DEMO_ID : job.driverId, text })],
  });
  return { kind: 'committed', text };
}

export function postMessage(from: 'resident' | 'driver', text: string) {
  const t = text.trim();
  if (!t || !state.job) return;
  set({ ...state, messages: [...state.messages, { id: id(), from, channel: 'Chat', at: state.clock, text: t }] });
}

// Contract: requestAgentContact(consentId). Offered only after delivery is confirmed, so it can
// never change who gets help or how fast. Retrying the same consentId saves nothing new.
export function requestAgentContact(consentId: string): Result {
  const r = state.agentRequest;
  if (r) return r.consentId === consentId
    ? { kind: 'duplicate', text: `Already saved as ${r.leadId}. Nothing new was recorded.` }
    : { kind: 'conflict', text: `This household already has request ${r.leadId}.` };
  if (state.job?.status !== 'received') return { kind: 'conflict', text: 'Agent contact is offered only after help is delivered.' };
  // Skip is final for this run: a late or stray request can never turn it into a lead.
  if (state.agentSkipped) return { kind: 'conflict', text: 'The resident skipped. Nothing was saved.' };
  const reg = state.registration!;
  const req: AgentRequest = { consentId, leadId: 'L-1', at: state.clock, contact: reg.contact };
  set({
    ...state,
    agentRequest: req,
    events: [...state.events, ev({ kind: 'consent', who: DEMO_ID, text: `Asked a State Farm agent to follow up about coverage. Consent saved as ${req.leadId}.` })],
  });
  return { kind: 'committed', text: `Saved as ${req.leadId}.` };
}

export function skipAgentContact() {
  if (state.agentRequest || state.agentSkipped) return;
  set({ ...state, agentSkipped: true });
}

export function clearResult() {
  set({ ...state, last: null });
}

export function reset() {
  set(INITIAL);
}

// Selectors shared by the board and the household drawer.
export function h17Case(s: DemoState) {
  return s.answer && s.answeredAt !== null ? evaluate(s.answer, s.answeredAt, s.delayConfirmed) : null;
}

export function h17Row(s: DemoState): Household | null {
  const reg = s.registration;
  if (!reg) return null;
  const base = { id: DEMO_ID, name: reg.name, need: reg.need, street: reg.address };
  if (!s.outage) return { ...base, lane: 'registered', report: 'Registered 02:22', margin: null, best: '—' };
  if (s.job) {
    const label: Record<JobStatus, string> = { reserved: 'Reserved', en_route: 'On the way', arrived: 'Arrived', received: 'Received' };
    return { ...base, lane: 'dispatched', report: `“${s.answer}”`, margin: null, best: `${s.job.assetId}, ${s.job.driverId}, ${label[s.job.status]}` };
  }
  const c = h17Case(s);
  if (!s.answer) {
    return { ...base, lane: 'silent', report: `No reply since ${fmt(s.pollSentAt ?? OUTAGE_AT)}`, margin: null, best: s.call === 'none' ? 'Call at 02:36' : 'Calling now' };
  }
  if (!c || !c.best) return { ...base, lane: 'unknown', report: `“${s.answer}”`, margin: null, best: 'Follow-up sent', owner: 'Maya', dueAt: (s.answeredAt ?? 0) + 6 };
  return { ...base, lane: c.lane, report: `“${s.answer}”`, margin: c.best.lo, best: `${c.best.assetId}, ${c.best.driverId}, ${c.best.routeId}` };
}

// Opt-ins are counted apart from registrations. Only H17 can opt in during the fixture demo.
export const agentOptIns = (s: DemoState) => (s.agentRequest ? 1 : 0);

export function householdRows(s: DemoState): Household[] {
  const h17 = h17Row(s);
  const rest = s.outage ? OTHERS : OTHERS.map((h) => ({ ...h, lane: 'registered' as const, report: 'Registered', margin: null, best: '—', owner: undefined, dueAt: undefined }));
  return h17 ? [h17, ...rest] : rest;
}
