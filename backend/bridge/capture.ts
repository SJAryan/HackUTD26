// TL-02: capture the next real plain-text message from the test sender and save it
// as a sanitized, replayable check-in event for A (ingestCheckin) and D (example).
// Usage: node --env-file=.env capture.ts <householdBinding> <incidentId> captures/<file>.json
// Raw captures stay under captures/ (gitignored); the committed fixture is a synthetic replay.
// It does not reply; committed-state replies are TL-08.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, Photon } from "@photon-ai/api";
import { configuration } from "./agent.ts";

type Config = ReturnType<typeof configuration>;
type Page = Awaited<ReturnType<Photon["projects"]["listMessages"]>>;
type Item = Page["items"][number];

const SENDER = "<test-sender>";
const AGENT = "<agent-line>";
const PROJECT = "<project-id>";
export const CAPTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "captures");

// Raw captures may only be written inside captures/, never into fixtures/ or elsewhere in the repo.
export function captureTarget(outFile: string): string {
  const target = resolve(outFile);
  const rel = relative(CAPTURES_DIR, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Output must be inside captures/, e.g. captures/h17-checkin.json.");
  }
  return target;
}

const PERSONAL_KEYS = new Set(["name", "displayName", "firstName", "lastName", "email", "avatarUrl"]);

const SEP = "[\\s.\\-()]*";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The 10 national digits of a NANP number ("+12145550101" -> "2145550101"); other numbers keep all digits.
function phoneDigits(handle: string): string | undefined {
  if (handle.includes("@")) return undefined;
  const d = handle.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 7 ? d : undefined;
}

// Matches the identity however it is written: optional +1/1 prefix, any of space . - ( ) between digits.
function identityPattern(handle: string): RegExp {
  const d = phoneDigits(handle);
  if (!d) return new RegExp(escape(handle), "gi");
  const prefix = d.length === 10 ? `(?:\\+?1${SEP})?` : "\\+?";
  return new RegExp(`(?<!\\d)${prefix}\\(?${[...d].join(SEP)}(?!\\d)`, "g");
}

export function sanitize(message: unknown, sender: string, agent: string, project?: string): any {
  const identities: [string, string][] = [[sender, SENDER], [agent, AGENT]];
  const rules: [RegExp, string][] = identities.map(([real, mask]) => [identityPattern(real), mask]);
  if (project) rules.push([new RegExp(escape(project), "g"), PROJECT]);
  const strings: string[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const out = rules.reduce((s, [re, mask]) => s.replace(re, mask), v);
      strings.push(out);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const kept = Object.entries(v).filter(([k]) => !PERSONAL_KEYS.has(k));
      strings.push(...kept.map(([k]) => k)); // keys are written too, so the fail-closed scan checks them
      return Object.fromEntries(kept.map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const clean = walk(message);
  // Fail closed: no identity may survive in any value or key, even with every non-digit stripped.
  for (const s of strings) {
    for (const [real] of identities) {
      const d = phoneDigits(real);
      if (d ? s.replace(/\D/g, "").includes(d) : s.toLowerCase().includes(real.toLowerCase())) {
        throw new Error("Sanitizing failed; refusing to write.");
      }
    }
    if (project && s.includes(project)) throw new Error("Sanitizing failed; refusing to write.");
  }
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

// captures/ is gitignored, so a fresh checkout doesn't have it. "wx" never overwrites an existing capture.
export function writeCapture(target: string, fixture: unknown): void {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
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
        writeCapture(outFile, fixture);
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
    if (!householdBinding || !incidentId || !outFile) throw new Error("Usage: capture.ts <householdBinding> <incidentId> captures/<file>.json");
    await capture(configuration(), householdBinding, incidentId, captureTarget(outFile));
  } catch (error) {
    if (error instanceof ApiError) console.error(`Photon API error ${error.status} (request ${error.requestId ?? "unknown"}).`);
    else console.error(error instanceof Error ? error.message : "Capture failed.");
    process.exitCode = 1;
  }
}
