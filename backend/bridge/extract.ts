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
    .replace(/\bhalf an? hour\b/g, "30 minutes")
    .replace(new RegExp(String.raw`\b(${WORD}|\d+) and a half hours?\b`, "g"), (_, n) => `${num(n) + 0.5} hours`)
    .replace(new RegExp(String.raw`\b(${WORD}|\d+) hours? and a half\b`, "g"), (_, n) => `${num(n) + 0.5} hours`)
    .replace(/\ban? hour\b/g, "1 hour")
    .replace(new RegExp(String.raw`\b(${WORD})\b(?=\s*(?:(?:-|to)\s*\S+\s*)?(?:mins?|minutes?|hrs?|hours?)\b)`, "g"), (w) => String(WORDS[w]));
}

type Mention = { lowerMin: number; upperMin?: number };

// Order matters: each pass blanks what it matched so a range is not also read as two singles.
const PATTERNS: [RegExp, (m: RegExpExecArray) => Mention | null][] = [
  [new RegExp(String.raw`${NUM}\s*${UNIT}\s*ago\b`, "g"), () => null], // elapsed time, not runtime
  [new RegExp(String.raw`${NUM}\s*(?:${UNIT})?\s*(?:-|to)\s*${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: toMinutes(m[1], m[2] ?? m[4]), upperMin: toMinutes(m[3], m[4]) })],
  [new RegExp(String.raw`(?:under|less than|below)\s+${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: 0, upperMin: toMinutes(m[1], m[2]) })],
  [new RegExp(String.raw`(?:over|more than|at least)\s+${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: toMinutes(m[1], m[2]) })],
  [new RegExp(String.raw`${NUM}\s*\+\s*${UNIT}|${NUM}\s*${UNIT}\s*(?:\+|or more)`, "g"),
    (m) => ({ lowerMin: m[1] ? toMinutes(m[1], m[2]) : toMinutes(m[3], m[4]) })],
  [new RegExp(String.raw`${NUM}\s*${UNIT}`, "g"),
    (m) => ({ lowerMin: toMinutes(m[1], m[2]), upperMin: toMinutes(m[1], m[2]) })],
];

export function extractRuntime(text: string): Extraction {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const found: { mention: Mention; evidence: string }[] = [];
  for (const sentence of sentences) {
    let s = normalize(sentence);
    for (const [re, read] of PATTERNS) {
      s = s.replace(re, (...args) => {
        const mention = read(args.slice(0, -2) as unknown as RegExpExecArray);
        if (mention) found.push({ mention, evidence: sentence });
        return " ".repeat(args[0].length);
      });
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
  const percent = sentences.find((s) => /\d+\s*(%|percent\b)/i.test(s));
  if (percent) return { kind: "needs_clarification", reason: "battery percentage without runtime", evidence: percent };
  return { kind: "needs_review", reason: "no runtime found" };
}
