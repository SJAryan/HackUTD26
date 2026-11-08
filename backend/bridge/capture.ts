// TL-02: capture the next real plain-text message from the test sender and save it
// as a sanitized, replayable check-in event for A (ingestCheckin) and D (example).
// Usage: node --env-file=.env capture.ts <householdBinding> <incidentId> <outFile>
// It does not reply; committed-state replies are TL-08.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, Photon } from "@photon-ai/api";
import { configuration } from "./agent.ts";

type Config = ReturnType<typeof configuration>;
type Page = Awaited<ReturnType<Photon["projects"]["listMessages"]>>;
type Item = Page["items"][number];

const SENDER = "<test-sender>";
const AGENT = "<agent-line>";
const PROJECT = "<project-id>";
const PERSONAL_KEYS = new Set(["name", "displayName", "firstName", "lastName", "email", "avatarUrl"]);

export function sanitize(message: unknown, sender: string, agent: string, project?: string): any {
  const pairs: [string, string][] = [[sender, SENDER], [agent, AGENT]];
  if (project) pairs.push([project, PROJECT]);
  for (const [real, mask] of [...pairs]) if (real.startsWith("+")) pairs.push([real.slice(1), mask]);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return pairs.reduce((s, [real, mask]) => s.split(real).join(mask), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !PERSONAL_KEYS.has(k)).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const clean = walk(message);
  const text = JSON.stringify(clean);
  for (const [real] of pairs) if (text.includes(real)) throw new Error("Sanitizing failed; refusing to write.");
  return clean;
}

// Shape follows the shared contract: ingestCheckin(eventId, householdBinding, observedAt, text/evidence, extracted fields).
export function toFixture(m: Item, c: Pick<Config, "sender" | "agent"> & { project?: string }, householdBinding: string, incidentId: string, receivedAt: string) {
  const provider = sanitize(m, c.sender, c.agent, c.project);
  if (provider.content?.type !== "text") throw new Error("Expected a plain-text message.");
  return {
    _source: "LIVE capture from Photon Beta iMessage, identities redacted. Replaying this file is a replay, not a live integration.",
    event: {
      eventId: m.id,
      incidentId,
      householdBinding,
      observedAt: m.createdAt,
      receivedAt,
      text: provider.content.text,
      extracted: null,
    },
    provider,
  };
}

function isFromTestSender(m: Item, c: Config, startedAt: number): boolean {
  if (m.platform !== c.platform || m.status !== "received") return false;
  if (Date.parse(m.createdAt) < startedAt) return false;
  if (m.sentBy.platform !== c.platform || m.receivedBy?.platform !== c.platform || m.space.platform !== c.platform) return false;
  if (m.sentBy.kind !== "human" || m.sentBy.handle !== c.sender) return false;
  if (m.receivedBy?.kind !== "agent" || m.receivedBy.handle !== c.agent) return false;
  if (c.platform === "imessage" && m.space.kind !== "direct") return false;
  return m.content.type === "text" && m.content.format === "plain";
}

async function capture(c: Config, householdBinding: string, incidentId: string, outFile: string, windowMs = 300_000, pollMs = 2_000) {
  const photon = new Photon({ headers: { Authorization: `Bearer ${c.key}` } });
  const startedAt = Date.now();
  const createdSince = new Date(startedAt - 5_000).toISOString();
  console.log("Ready. Send the check-in text from the test sender now.");
  while (true) {
    let pageToken: string | undefined;
    do {
      const page = await photon.projects.listMessages({
        path: { id: c.project },
        query: { createdSince, direction: "received", order: "asc", pageSize: 100, platform: c.platform, ...(pageToken ? { pageToken } : {}) },
      });
      const m = page.items.find((item) => isFromTestSender(item, c, startedAt));
      if (m) {
        const fixture = toFixture(m, c, householdBinding, incidentId, new Date().toISOString());
        writeFileSync(outFile, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
        console.log(`Saved ${outFile} (eventId ${fixture.event.eventId}).`);
        return;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    if (Date.now() + pollMs > startedAt + windowMs) throw new Error("No message from the test sender before the deadline.");
    await sleep(pollMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [householdBinding, incidentId, outFile] = process.argv.slice(2);
  try {
    if (!householdBinding || !incidentId || !outFile) throw new Error("Usage: capture.ts <householdBinding> <incidentId> <outFile>");
    await capture(configuration(), householdBinding, incidentId, outFile);
  } catch (error) {
    if (error instanceof ApiError) console.error(`Photon API error ${error.status} (request ${error.requestId ?? "unknown"}).`);
    else console.error(error instanceof Error ? error.message : "Capture failed.");
    process.exitCode = 1;
  }
}
