// Photon Beta first-reply agent, copied unchanged from the official guide:
// https://photon.codes/docs/beta/get-started/imessage (client @photon-ai/api 0.5.0)
// Send exactly "ping" from PHOTON_TEST_SENDER after "Ready"; expect "Hello from your Photon agent!".
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ApiError, Photon } from "@photon-ai/api";

type Config = { key: string; project: string; platform: "imessage" | "email"; agent: string; sender: string };

export function configuration(): Config {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  };
  const platform = required("PHOTON_PLATFORM");
  if (platform !== "imessage" && platform !== "email") throw new Error("PHOTON_PLATFORM must be imessage or email.");
  return {
    key: required("PHOTON_API_KEY"), project: required("PHOTON_PROJECT_ID"),
    platform, agent: required("PHOTON_AGENT_HANDLE"), sender: required("PHOTON_TEST_SENDER"),
  };
}

type Page = Awaited<ReturnType<Photon["projects"]["listMessages"]>>;
type Item = Page["items"][number];

// The client validates every response against the contract, so these checks
// are the walkthrough's own rules: the right conversation, sender, and text.
// A match returns the reply's inputs.
function matching(m: Item, c: Config, startedAt: number): { id: string; spaceId: string; senderId: string } | undefined {
  if (m.platform !== c.platform || m.status !== "received") return undefined;
  if (Date.parse(m.createdAt) < startedAt) return undefined;
  if (m.sentBy.platform !== c.platform || m.receivedBy?.platform !== c.platform || m.space.platform !== c.platform) return undefined;
  if (m.sentBy.kind !== "human" || m.sentBy.handle !== c.sender) return undefined;
  if (m.receivedBy.kind !== "agent" || m.receivedBy.handle !== c.agent) return undefined;
  if (m.sentBy.id === m.receivedBy.id) return undefined;
  if (c.platform === "imessage" && m.space.kind !== "direct") return undefined;
  const found = { id: m.id, spaceId: m.space.id, senderId: m.receivedBy.id };
  const content = m.content;
  if (content.type === "text") {
    return content.format === "plain" && content.text.trim() === "ping" ? found : undefined;
  }
  if (c.platform !== "email" || content.type !== "group") return undefined;
  const plain = content.parts.flatMap((part) => (part.type === "text" && part.format === "plain" ? [part] : []));
  return plain.length === 1 && plain[0].text.trim() === "ping" ? found : undefined;
}

export async function run(c: Config, windowMs = 120_000, pollMs = 2_000) {
  const photon = new Photon({ headers: { Authorization: `Bearer ${c.key}` } });
  const startedAt = Date.now();
  const deadline = startedAt + windowMs;
  const createdSince = new Date(startedAt - 5_000).toISOString();
  console.log("Ready. Waiting for the configured test sender.");
  while (true) {
    let pageToken: string | undefined;
    do {
      const page = await photon.projects.listMessages({
        path: { id: c.project },
        query: { createdSince, direction: "received", order: "asc", pageSize: 100, platform: c.platform, ...(pageToken ? { pageToken } : {}) },
      });
      for (const m of page.items) {
        const found = matching(m, c, startedAt);
        if (!found) continue;
        await photon.projects.sendMessage({
          path: { id: c.project },
          headers: { "idempotency-key": `first-agent-reply:${found.id}` },
          body: {
            spaceId: found.spaceId, senderId: found.senderId, parentMessageId: found.id,
            content: { type: "text", format: "plain", text: "Hello from your Photon agent!" },
          },
        });
        console.log("Reply accepted for asynchronous dispatch; delivery is not confirmed.");
        return;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    if (Date.now() + pollMs > deadline) throw new Error("No matching ping found before the deadline.");
    await sleep(pollMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(configuration());
  } catch (error) {
    if (error instanceof ApiError) console.error(`Photon API error ${error.status} (request ${error.requestId ?? "unknown"}).`);
    else console.error(error instanceof Error ? error.message : "Agent failed.");
    process.exitCode = 1;
  }
}
