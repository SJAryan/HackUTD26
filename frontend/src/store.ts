// FIXTURE adapter. Same operation names as the shared contract so TL-07 can swap
// this file for A's generated subscriptions and reducers. State lives in this
// browser's localStorage and syncs across tabs; it is not SpacetimeDB.
import { useSyncExternalStore } from 'react';

export type JobStatus = 'assigned' | 'arrived' | 'received';

export type Job = {
  jobId: string;
  jobRequestId: string;
  caseId: string;
  routeId: string;
  assetId: string;
  driverId: string;
  readyAt: string;
  status: JobStatus;
  version: number;
};

export type Message = { jobId: string; clientMessageId: string; sender: 'resident' | 'driver'; text: string };

type State = { confirmedReports: string[]; jobs: Job[]; messages: Message[] };
export type Result = { status: 'committed' | 'duplicate' | 'conflict'; reason?: string };

const KEY = 'timeleft-fixture-v1';
const EMPTY: State = { confirmedReports: [], jobs: [], messages: [] };

function load(): State {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

let state = load();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: this tab still works, other tabs won't see the change.
  }
  notify();
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    state = load();
    notify();
  }
});

export function useFixture() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function confirmRouteReport(reportId: string): Result {
  if (state.confirmedReports.includes(reportId)) return { status: 'duplicate' };
  commit({ ...state, confirmedReports: [...state.confirmedReports, reportId] });
  return { status: 'committed' };
}

// The real reducer also checks expectedVersion against the case version; the fixture does not.
export function reserve(req: {
  jobRequestId: string;
  caseId: string;
  routeId: string;
  assetId: string;
  driverId: string;
  readyAt: string;
  expectedVersion: number;
}): Result {
  if (state.jobs.some((j) => j.jobRequestId === req.jobRequestId)) return { status: 'duplicate' };
  const clash = state.jobs.find(
    (j) => j.caseId === req.caseId || j.assetId === req.assetId || (j.driverId === req.driverId && j.status !== 'received'),
  );
  if (clash) return { status: 'conflict', reason: `${clash.jobId} already holds this household, battery or driver.` };
  const { expectedVersion: _ignored, ...rest } = req;
  commit({ ...state, jobs: [...state.jobs, { ...rest, jobId: `JOB-${req.caseId}`, status: 'assigned', version: 1 }] });
  return { status: 'committed' };
}

// In the real app the server derives the sender from the session; the fixture passes the role.
export function postJobMessage(jobId: string, clientMessageId: string, sender: Message['sender'], text: string): Result {
  if (state.messages.some((m) => m.clientMessageId === clientMessageId)) return { status: 'duplicate' };
  if (!state.jobs.some((j) => j.jobId === jobId)) return { status: 'conflict', reason: 'No such job.' };
  commit({ ...state, messages: [...state.messages, { jobId, clientMessageId, sender, text }] });
  return { status: 'committed' };
}

const NEXT: Record<JobStatus, JobStatus | null> = { assigned: 'arrived', arrived: 'received', received: null };

export function updateJob(jobId: string, expectedVersion: number, status: JobStatus): Result {
  const job = state.jobs.find((j) => j.jobId === jobId);
  if (!job || job.version !== expectedVersion || NEXT[job.status] !== status) {
    return { status: 'conflict', reason: 'The job changed. Reload and try again.' };
  }
  commit({ ...state, jobs: state.jobs.map((j) => (j === job ? { ...j, status, version: j.version + 1 } : j)) });
  return { status: 'committed' };
}

export function resetFixture() {
  commit(EMPTY);
}
