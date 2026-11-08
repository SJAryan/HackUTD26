// TL-07 (B): map a live `reserve` reducer outcome onto the drawer's Result.
// Pure so it can be checked without a connection. The reducer itself lives in spacetimedb/ (A).
import type { Result } from './store';

type JobRow = { id: bigint; requestId: string };

// The reducer resolves for both a new job and a replayed requestId, so the caller says whether
// a job with this requestId was already in coordinator_jobs before the call.
export function liveSuccess(existedBefore: boolean, job: JobRow | undefined, assetId: string, driverId: string, routeId: string): Result {
  if (existedBefore) return { kind: 'duplicate', text: `Already reserved as Job ${job?.id ?? '?'}. Nothing new was sent.` };
  return { kind: 'committed', text: `Reserved ${assetId} with ${driverId} on ${routeId}.${job ? ` Job ${job.id}.` : ''}` };
}

// SenderError messages from A's reserve: `conflict:`, `rejected:` and `incompatible:` are expected
// losses; anything else (forbidden, unknown route, network) is still shown, but as a failure.
export function liveError(err: unknown): Result {
  const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
  const m = msg.match(/(conflict|rejected|incompatible): .*/);
  return { kind: 'conflict', text: m ? m[0] : `Reserve failed: ${msg}` };
}
