import { test } from "node:test";
import assert from "node:assert/strict";
import { describeReceipt, findReceipt, waitForReceipt, type CheckinRow } from "./receipt.ts";

// Synthetic rows shaped like A's bridge_checkins view.
const h17: CheckinRow = { eventId: "synthetic-h17-tornado-001", householdId: "H17", runtimeLowerMin: 30, runtimeUpperMin: 60 };
const h22: CheckinRow = { eventId: "synthetic-h22-tornado-001", householdId: "H22" };

test("the H17 replay row is found with its 30-60 min runtime", () => {
  const r = findReceipt([h22, h17], h17.eventId);
  assert.deepEqual(r, { householdId: "H17", runtimeLowerMin: 30, runtimeUpperMin: 60 });
  assert.equal(describeReceipt(r), "receipt found, H17 30-60 min");
});

test("an eventId missing from the view reports no receipt", () => {
  assert.equal(findReceipt([h22], h17.eventId), undefined);
  assert.equal(describeReceipt(undefined), "no receipt");
});

test("a recorded check-in without a runtime still counts as a receipt", () => {
  assert.equal(describeReceipt(findReceipt([h22], h22.eventId)), "receipt found, H22 no runtime");
});

test("open-ended and exact runtimes are described", () => {
  assert.equal(describeReceipt({ householdId: "H17", runtimeLowerMin: 120 }), "receipt found, H17 120+ min");
  assert.equal(describeReceipt({ householdId: "H17", runtimeLowerMin: 45, runtimeUpperMin: 45 }), "receipt found, H17 45 min");
  assert.equal(describeReceipt({ householdId: "H17", runtimeLowerMin: 0, runtimeUpperMin: 30 }), "receipt found, H17 0-30 min");
});

test("waitForReceipt picks up a row that reaches the view after the reducer returns", async () => {
  const view: CheckinRow[] = [];
  let reads = 0;
  const rows = () => { if (++reads === 3) view.push(h17); return view; };
  const r = await waitForReceipt(rows, h17.eventId, 5, 1);
  assert.equal(r?.householdId, "H17");
  assert.equal(reads, 3);
});

test("waitForReceipt gives up after its tries and reports no receipt", async () => {
  let reads = 0;
  const r = await waitForReceipt(() => { reads++; return [h22]; }, h17.eventId, 4, 1);
  assert.equal(r, undefined);
  assert.equal(reads, 4);
});
