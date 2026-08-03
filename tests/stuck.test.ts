import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootClient } from "./client-sandbox.ts";

type Row = {
  externalId: string;
  name: string;
  status: string;
  model: string;
  runId: string;
  attempt: number;
  stepIndex: number;
  compensationOf: readonly string[];
  error: readonly string[];
};

function row(patch: Partial<Row>): Row {
  return {
    externalId: "e",
    name: "payment.authorize",
    status: "dead_letter",
    model: "Order",
    runId: "r",
    attempt: 5,
    stepIndex: 1,
    compensationOf: [],
    error: ["limit yetersiz"],
    ...patch,
  };
}

function seeded(rows: readonly Row[]) {
  const box = bootClient();
  box.setState({ outbox: rows, search: "", troubleOnly: false, page: 0, view: "stuck" });
  return box;
}

describe("the stuck view groups dead letters by what stopped them", () => {
  it("turns many rows carrying one cause into one card", () => {
    const rows: Row[] = [];
    for (let index = 0; index < 30; index = index + 1) {
      rows.push(row({ externalId: `a${String(index)}`, runId: `r${String(index)}` }));
    }
    rows.push(
      row({ externalId: "b", runId: "rb", name: "inventory.reserve", error: ["stokta kalmadi"] }),
    );
    const box = seeded(rows);

    assert.equal(box.call<number>("stuckCount()"), 31, "every dead letter is still counted");
    const groups = box.read<{ name: string; count: number }[]>(
      "stuckGroups().map((group) => ({ name: group.name, count: group.rows.length }))",
    );
    assert.equal(groups.length, 2, "thirty one rows carrying two causes read as two problems");
    assert.deepEqual(groups[0], { name: "payment.authorize", count: 30 }, "the widest cause leads");
    assert.deepEqual(groups[1], { name: "inventory.reserve", count: 1 });
  });

  it("splits one external into separate cards when it failed for different reasons", () => {
    const box = seeded([
      row({ externalId: "a", runId: "r1", error: ["limit yetersiz"] }),
      row({ externalId: "b", runId: "r2", error: ["kart süresi geçmiş"] }),
    ]);
    const reasons = box.read<string[]>("stuckGroups().map((group) => group.reason)");
    assert.equal(reasons.length, 2, "the same external stopped by two things is two problems");
    assert.ok(reasons.includes("limit yetersiz"));
    assert.ok(reasons.includes("kart süresi geçmiş"));
  });

  it("names a row with no recorded reason rather than grouping it under an empty string", () => {
    const box = seeded([row({ externalId: "a", runId: "r1", error: [] })]);
    const reasons = box.read<string[]>("stuckGroups().map((group) => group.reason)");
    assert.deepEqual(reasons, ["No reason was recorded"]);
  });

  it("says which stuck requests were never rolled back", () => {
    const box = seeded([
      row({ externalId: "a1", runId: "r1" }),
      row({ externalId: "a2", runId: "r2" }),
      row({
        externalId: "c1",
        runId: "r1",
        name: "inventory.release",
        status: "completed",
        compensationOf: ["a1"],
        error: [],
      }),
    ]);
    const undone = box.read<string[]>("compensatedRuns(stuckGroups()[0])");
    assert.deepEqual(undone, ["r1"], "only the request with a compensation counts as undone");

    box.call("renderStuck()");
    const shown = box.flatText(box.nodeById("stuck-body"));
    assert.ok(
      shown.includes("1 left without a rollback"),
      "a stuck request nobody undid is the one an operator has to act on",
    );
  });

  it("calls it out when a whole group rolled back and when none of it did", () => {
    const rolled = seeded([
      row({ externalId: "a1", runId: "r1" }),
      row({
        externalId: "c1",
        runId: "r1",
        name: "inventory.release",
        status: "completed",
        compensationOf: ["a1"],
        error: [],
      }),
    ]);
    rolled.call("renderStuck()");
    assert.ok(rolled.flatText(rolled.nodeById("stuck-body")).includes("every request rolled back"));

    const bare = seeded([row({ externalId: "a1", runId: "r1" })]);
    bare.call("renderStuck()");
    assert.ok(bare.flatText(bare.nodeById("stuck-body")).includes("nothing rolled back"));
  });

  it("reports how many attempts were spent before it gave up", () => {
    const box = seeded([row({ externalId: "a1", runId: "r1", attempt: 7 })]);
    box.call("renderStuck()");
    assert.ok(box.flatText(box.nodeById("stuck-body")).includes("gave up after 7 attempts"));
  });

  it("does not say one attempts", () => {
    const box = seeded([row({ externalId: "a1", runId: "r1", attempt: 1 })]);
    box.call("renderStuck()");
    const shown = box.flatText(box.nodeById("stuck-body"));
    assert.ok(shown.includes("gave up on the first attempt"), shown);
    assert.equal(shown.includes("1 attempts"), false, "a permanent failure never retried");
  });

  it("caps the requests it lists and says how many it did not", () => {
    const rows: Row[] = [];
    for (let index = 0; index < 12; index = index + 1) {
      rows.push(row({ externalId: `a${String(index)}`, runId: `r${String(index)}` }));
    }
    const box = seeded(rows);
    box.call("renderStuck()");
    const shown = box.flatText(box.nodeById("stuck-body"));
    assert.ok(
      shown.includes("4 more requests hit the same wall"),
      "a silent cap reads as completeness, so the count has to be stated",
    );
  });

  it("searches the reason, so an operator can type what the external answered", () => {
    const box = seeded([
      row({ externalId: "a", runId: "r1", error: ["limit yetersiz"] }),
      row({ externalId: "b", runId: "r2", name: "inventory.reserve", error: ["stokta kalmadi"] }),
    ]);
    box.setState({ search: "stokta" });
    const names = box.read<string[]>("stuckGroups().map((group) => group.name)");
    assert.deepEqual(names, ["inventory.reserve"]);
  });

  it("holds nothing back when the outbox carries no dead letter", () => {
    const box = seeded([row({ externalId: "ok", runId: "r1", status: "completed", error: [] })]);
    assert.equal(box.call<number>("stuckCount()"), 0);
    box.call("renderStuck()");
    assert.ok(box.flatText(box.nodeById("stuck-body")).includes("Nothing is stuck"));
  });
});
