// TL-08: one ingest path for live Photon messages and fixture replays.
// Network effects (SpacetimeDB reducer, Photon send) are passed in so this stays testable.
import { extractRuntime, type Extraction } from "./extract.ts";

export type CheckinArgs = {
  eventId: string;
  incidentId: string;
  householdId: string;
  observedAt: Date;
  text: string;
  runtimeLowerMin?: number;
  runtimeUpperMin?: number;
};

// A normalized inbound check-in. `replyTo` is absent for replays, so they never send.
export type InboundEvent = {
  eventId: string;
  observedAt: string;
  text: string;
  replyTo?: { spaceId: string; senderId: string };
};

export type Deps = {
  ingest: (args: CheckinArgs) => Promise<void>;
  reply: (to: NonNullable<InboundEvent["replyTo"]>, parentMessageId: string, text: string) => Promise<void>;
  log: (line: string) => void;
};

export type Binding = { sender: string; householdId: string; incidentId: string };

// Minimal fields read from a Photon listMessages item; kept structural so tests need no SDK.
export type PhotonItem = {
  id: string;
  platform: string;
  status: string;
  createdAt: string;
  sentBy: { platform: string; kind?: string; handle?: string; id?: string };
  receivedBy?: { platform: string; kind?: string; handle?: string; id?: string };
  space: { platform: string; kind?: string; id: string };
  content: { type: string; format?: string; text?: string } | unknown;
};

// Same checks as capture.ts: right platform, a human writing to our agent line in a direct space, plain text.
export function inboundText(m: PhotonItem, platform: string, agent: string): InboundEvent | undefined {
  if (m.platform !== platform || m.status !== "received") return undefined;
  if (m.sentBy.platform !== platform || m.receivedBy?.platform !== platform || m.space.platform !== platform) return undefined;
  if (m.sentBy.kind !== "human" || m.receivedBy.kind !== "agent" || m.receivedBy.handle !== agent) return undefined;
  if (m.sentBy.id === m.receivedBy.id) return undefined;
  if (platform === "imessage" && m.space.kind !== "direct") return undefined;
  const c = m.content as { type?: string; format?: string; text?: string };
  if (c?.type !== "text" || c.format !== "plain" || typeof c.text !== "string" || !m.receivedBy.id) return undefined;
  return { eventId: m.id, observedAt: m.createdAt, text: c.text, replyTo: { spaceId: m.space.id, senderId: m.receivedBy.id } };
}

// Only enrolled senders map to a household; everything else is ignored.
export function householdFor(m: PhotonItem, binding: Binding): string | undefined {
  return m.sentBy.handle === binding.sender ? binding.householdId : undefined;
}

export function fromFixture(fixture: { event: { eventId: string; observedAt: string; text: string; incidentId: string; householdBinding: string } }) {
  const { eventId, observedAt, text, incidentId, householdBinding } = fixture.event;
  return { event: { eventId, observedAt, text } as InboundEvent, incidentId, householdId: householdBinding };
}

const describe = (x: Extraction) =>
  x.kind !== "runtime" ? x.kind
    : x.upperMin === undefined ? `${x.lowerMin}+ min`
    : x.lowerMin === x.upperMin ? `${x.lowerMin} min`
    : `${x.lowerMin}-${x.upperMin} min`;

function spoken(x: Extract<Extraction, { kind: "runtime" }>): string {
  const fmt = (n: number) => (n >= 60 && n % 60 === 0 ? `${n / 60} hour${n === 60 ? "" : "s"}` : `${n} minutes`);
  if (x.upperMin === undefined) return `${fmt(x.lowerMin)} or more`;
  if (x.lowerMin === 0) return `under ${fmt(x.upperMin)}`;
  if (x.lowerMin === x.upperMin) return `about ${fmt(x.lowerMin)}`;
  return x.lowerMin % 60 === 0 && x.upperMin % 60 === 0
    ? `about ${x.lowerMin / 60} to ${fmt(x.upperMin)}`
    : `about ${x.lowerMin} to ${x.upperMin} minutes`;
}

// Receipt or clarifying question only. ETAs come from committed jobs (TL-05), never from here.
// The receipt is sent only for kind "runtime"; anything else never claims a recorded backup time.
export function replyText(x: Extraction): string | undefined {
  switch (x.kind) {
    case "runtime":
      return `Got it, we've recorded ${spoken(x)} of backup. A coordinator will follow up.`;
    case "needs_clarification":
      return "Thanks. What does your equipment's battery display (for example, your oxygen concentrator's) show, in minutes of backup left?";
    case "needs_review":
      return undefined; // a coordinator reads the original message
  }
}

export type Outcome = "duplicate" | "ingested" | "failed";

export async function handle(
  event: InboundEvent, householdId: string, incidentId: string,
  deps: Deps, seen: Set<string>, mode: "LIVE" | "REPLAY",
): Promise<Outcome> {
  if (seen.has(event.eventId)) return "duplicate";
  const x = extractRuntime(event.text);
  const args: CheckinArgs = {
    eventId: event.eventId, incidentId, householdId, observedAt: new Date(event.observedAt), text: event.text,
    ...(x.kind === "runtime" ? { runtimeLowerMin: x.lowerMin, ...(x.upperMin === undefined ? {} : { runtimeUpperMin: x.upperMin }) } : {}),
  };
  try {
    await deps.ingest(args);
  } catch (error) {
    deps.log(`${mode} ${event.eventId} ingest failed (will retry): ${error instanceof Error ? error.message : "unknown error"}`);
    return "failed";
  }
  seen.add(event.eventId);
  deps.log(`${mode} ${event.eventId} -> ${householdId}/${incidentId}: ${describe(x)}${x.kind === "runtime" ? "" : ` (${x.reason})`}`);
  const text = event.replyTo && mode === "LIVE" ? replyText(x) : undefined;
  if (text && event.replyTo) await deps.reply(event.replyTo, event.eventId, text);
  return "ingested";
}
