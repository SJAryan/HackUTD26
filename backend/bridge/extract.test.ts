import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractRuntime } from "./extract.ts";

const runtime = (text: string) => {
  const x = extractRuntime(text);
  assert.equal(x.kind, "runtime", `${text} -> ${JSON.stringify(x)}`);
  return x.kind === "runtime" ? [x.lowerMin, x.upperMin] : [];
};

test("ranges and single values in minutes", () => {
  assert.deepEqual(runtime("30 to 60 minutes"), [30, 60]);
  assert.deepEqual(runtime("30-60 min"), [30, 60]);
  assert.deepEqual(runtime("30–60 mins left"), [30, 60]);
  assert.deepEqual(runtime("about 45 minutes"), [45, 45]);
  assert.deepEqual(runtime("1 hour"), [60, 60]);
  assert.deepEqual(runtime("an hour and a half"), [90, 90]);
  assert.deepEqual(runtime("1 to 2 hrs"), [60, 120]);
  assert.deepEqual(runtime("30 min to 1 hour"), [30, 60]);
  assert.deepEqual(runtime("half an hour"), [30, 30]);
  assert.deepEqual(runtime("two hours"), [120, 120]);
});

test("poll-style bounds: under N has a zero lower bound, N+ is open-ended", () => {
  assert.deepEqual(runtime("Under 30 min"), [0, 30]);
  assert.deepEqual(runtime("2+ hrs"), [120, undefined]);
  assert.deepEqual(runtime("more than 2 hours"), [120, undefined]);
});

test("exact H17 fixture text gives 30/60 with its supporting sentence", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/h17-checkin.json", import.meta.url), "utf8"));
  const x = extractRuntime(fixture.event.text);
  assert.deepEqual(x, {
    kind: "runtime", lowerMin: 30, upperMin: 60,
    evidence: "The battery display on my oxygen concentrator says about 30 to 60 minutes left.",
  });
});

test("phone battery percentage alone needs clarification", () => {
  assert.equal(extractRuntime("my phone is at 20%").kind, "needs_clarification");
  assert.equal(extractRuntime("battery at 40 percent").kind, "needs_clarification");
});

test("no runtime or conflicting numbers need review with runtime unset", () => {
  for (const text of ["Can the driver use the side entrance?", "Not sure", "Power went out at 2:30am", "about 30 minutes, maybe 2 hours"]) {
    const x = extractRuntime(text);
    assert.equal(x.kind, "needs_review", text);
    assert.ok(!("lowerMin" in x));
  }
});

test("elapsed time is not runtime", () => {
  assert.deepEqual(runtime("Power went out 3 hours ago. Backup says 45 minutes."), [45, 45]);
});

const review = (text: string) => {
  const x = extractRuntime(text);
  assert.equal(x.kind, "needs_review", `${text} -> ${JSON.stringify(x)}`);
  assert.ok(!("lowerMin" in x) && !("upperMin" in x), text);
};

test("upper bounds keep a zero lower bound", () => {
  assert.deepEqual(runtime("no more than 30 minutes left"), [0, 30]);
  assert.deepEqual(runtime("not more than 30 minutes of backup"), [0, 30]);
  assert.deepEqual(runtime("at most 45 minutes of battery"), [0, 45]);
  assert.deepEqual(runtime("up to an hour of backup"), [0, 60]);
  assert.deepEqual(runtime("only about 20 minutes at most on the battery"), [0, 20]);
  assert.deepEqual(runtime("battery is good for no longer than 40 minutes"), [0, 40]);
});

test("lower bounds are unchanged", () => {
  assert.deepEqual(runtime("more than 30 minutes left"), [30, undefined]);
});

test("elapsed or cue-less durations are never runtime", () => {
  review("The power has been out for 2 hours");
  review("we've had no power since 3 hours ago");
  review("I need help in 30 minutes");
  review("It's been 2 hours now");
  review("We've been without power for the past 3 hours");
  assert.deepEqual(runtime("Power's been out for 2 hours, battery says 40 minutes left"), [40, 40]);
  assert.deepEqual(runtime("I need help in 30 minutes. The backup has about 45 minutes left."), [45, 45]);
});
