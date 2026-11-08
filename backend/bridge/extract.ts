// TL-08: deterministic runtime extraction (no LLM). "AI reads, code decides" starts here
// with plain rules; a model can replace the reading later, never the decision.

export type Extraction =
  | { kind: "runtime"; lowerMin: number; upperMin?: number; evidence: string }
  | { kind: "needs_clarification" | "needs_review"; reason: string; evidence?: string };

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const WORD = Object.keys(WORDS).join("|");
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(mins?|minutes?|hrs?|hours?)\b`;

const toMinutes = (n: string, unit: string) => Math.round(Number(n) * (unit.startsWith("h") ? 60 : 1));

// Rewrite spoken durations into "<number> <unit>" so one set of patterns reads them.
function normalize(sentence: string): string {
  const num = (w: string) => (/^\d/.test(w) ? Number(w) : WORDS[w]);
  return sentence
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/\bhalf an? hour\b/g, "30 minutes")
    .replace(new RegExp(String.raw`\b(${WORD}|\d+) and a half hours?\b`, "g"), (_, n) => `${num(n) + 0.5} hours`)
    .replace(new RegExp(String.raw`\b(${WORD}|\d+) hours? and a half\b`, "g"), (_, n) => `${num(n) + 0.5} hours`)
    .replace(/\ban? hour\b/g, "1 hour")
    .replace(new RegExp(String.raw`\b(${WORD})\b(?=\s*(?:(?:-|to)\s*\S+\s*)?(?:mins?|minutes?|hrs?|hours?)\b)`, "g"), (w) => String(WORDS[w]));
}

type Mention = { lowerMin: number; upperMin?: number };

const elapsed = () => null; // time already passed, never runtime

// Order matters: each pass blanks what it matched so a range is not also read as two singles,
// and upper bounds ("no more than N") are read before lower bounds ("more than N").
const PATTERNS: [RegExp, (m: RegExpExecArray) => Mention | null][] = [
  [new RegExp(String.raw`${NUM}\s*${UNIT}\s*ago\b`, "g"), elapsed],
  [new RegExp(String.raw`\bsince\s+${NUM}\s*${UNIT}`, "g"), elapsed],
  [new RegExp(String.raw`${NUM}\s*${UNIT}\s+now\b`, "g"), elapsed],
  [new RegExp(String.raw`\bfor\s+the\s+(?:past|last)\s+${NUM}\s*${UNIT}`, "g"), elapsed],
  [new RegExp(String.raw`\b(?:been|out|down|without)\s+(?:\S+\s+){0,3}?for\s+${NUM}\s*${UNIT}`, "g"), elapsed],
  [new RegExp(String.raw`(?:no more than|not more than|at most|up to|max(?:imum)?(?:\s+of)?|under|less than|below|no longer than)\s+(?:about\s+|around\s+)?${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: 0, upperMin: toMinutes(m[1], m[2]) })],
  [new RegExp(String.raw`${NUM}\s*${UNIT}\s+(?:at most|max(?:imum)?)\b`, "g"),
    (m) => ({ lowerMin: 0, upperMin: toMinutes(m[1], m[2]) })],
  [new RegExp(String.raw`${NUM}\s*(?:${UNIT})?\s*(?:-|to)\s*${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: toMinutes(m[1], m[2] ?? m[4]), upperMin: toMinutes(m[3], m[4]) })],
  [new RegExp(String.raw`(?<!\bno\s|\bnot\s)(?:over|more than|at least)\s+${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: toMinutes(m[1], m[2]) })],
  [new RegExp(String.raw`${NUM}\s*\+\s*${UNIT}|${NUM}\s*${UNIT}\s*(?:\+|or more)`, "g"),
    (m) => ({ lowerMin: m[1] ? toMinutes(m[1], m[2]) : toMinutes(m[3], m[4]) })],
  [new RegExp(String.raw`${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: toMinutes(m[1], m[2]), upperMin: toMinutes(m[1], m[2]) })],
];

// A duration is runtime only with a cue nearby, or when it is the whole answer (a poll reply like "30 to 60 min").
const CUE = /\b(?:left|remaining|remains?|battery|backup|runtime|lasts?|good for|until (?:it|empty|dies)|(?:display|screen) says|should last)\b/;
const FILLER = /\b(?:about|around|approximately|roughly|maybe|probably|like|only|just)\b|[~?!.]/g;
const CUE_WINDOW = 6; // words on each side, within the same clause

// Each duration is judged by the subject of its own clause.
const CLAUSE = /[,;:]|\b(?:but|however|although|while)\b|\band\s+(?=(?:the|my)\b)/;
// A personal device's battery is never the household's equipment runtime.
const DEVICE = /\b(?:phone|cell|cellphone|iphone|android|mobile|laptop|tablet|ipad|watch|airpods|charger)\b/;
// "Unknown" only counts as evidence when the clause is about the equipment, so a bare "Not sure" stays for review.
const UNKNOWN = /\b(?:unknown|don't know|do not know|not sure|no idea|can't tell|cannot tell|can't see|cannot see)\b|\b(?:display|screen) (?:is )?(?:off|blank)\b/;
const EQUIPMENT = /\b(?:oxygen|concentrator|ventilator|respirator|cpap|bipap|dialysis|equipment|machine|generator|battery|backup|display|screen|runtime)\b/;
const PERCENT = /\d+\s*(?:%|percent\b)/;

function isRuntime(clause: string, offset: number, length: number): boolean {
  const words = (s: string) => s.split(/\s+/).filter(Boolean);
  const before = clause.slice(0, offset);
  const after = clause.slice(offset + length);
  if (CUE.test([...words(before).slice(-CUE_WINDOW), ...words(after).slice(0, CUE_WINDOW)].join(" "))) return true;
  return `${before} ${after}`.replace(FILLER, " ").trim() === "";
}

export function extractRuntime(text: string): Extraction {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const found: { mention: Mention; evidence: string }[] = [];
  let unknown: string | undefined; // equipment runtime stated as unknown
  let device: string | undefined; // only a personal device's battery was mentioned
  let percent: string | undefined;
  for (const sentence of sentences) {
    for (let clause of normalize(sentence).split(CLAUSE)) {
      const isDevice = DEVICE.test(clause);
      if (isDevice && PERCENT.test(clause)) device ??= sentence;
      if (!isDevice && PERCENT.test(clause)) percent ??= sentence;
      if (!isDevice && UNKNOWN.test(clause) && EQUIPMENT.test(clause)) unknown ??= sentence;
      for (const [re, read] of PATTERNS) {
        clause = clause.replace(re, (...args) => {
          const [match, offset, whole] = [args[0] as string, args.at(-2) as number, args.at(-1) as string];
          const mention = read(args.slice(0, -2) as unknown as RegExpExecArray);
          if (mention && isDevice) device ??= sentence;
          else if (mention && isRuntime(whole, offset, match.length)) found.push({ mention, evidence: sentence });
          return " ".repeat(match.length);
        });
      }
    }
  }
  const distinct = new Map(found.map((f) => [`${f.mention.lowerMin}-${f.mention.upperMin}`, f]));
  if (distinct.size > 1) {
    return { kind: "needs_review", reason: "conflicting runtimes", evidence: [...new Set(found.map((f) => f.evidence))].join(" ") };
  }
  const [only] = distinct.values();
  if (only) {
    const { lowerMin, upperMin } = only.mention;
    if (upperMin !== undefined && lowerMin > upperMin) return { kind: "needs_review", reason: "range is reversed", evidence: only.evidence };
    return { kind: "runtime", lowerMin, ...(upperMin === undefined ? {} : { upperMin }), evidence: only.evidence };
  }
  if (unknown) return { kind: "needs_clarification", reason: "equipment runtime unknown", evidence: unknown };
  if (device) return { kind: "needs_clarification", reason: "personal device battery, not equipment", evidence: device };
  if (percent) return { kind: "needs_clarification", reason: "battery percentage without runtime", evidence: percent };
  return { kind: "needs_review", reason: "no runtime found" };
}
