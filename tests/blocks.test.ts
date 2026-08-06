import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocksOf, targetCanvasWidth } from "../src/graph/blocks.ts";
import type { ExternalSummary, ModelSummary } from "@fookiejs/core";
import type { FlowUse } from "../src/map-ids.ts";

function model(name: string, relations: readonly [string, string][]): ModelSummary {
  const fields = relations.map(([key, target]) => ({
    key,
    column: key,
    pgType: "uuid",
    relation: [target],
    unique: false,
    index: true,
    system: false,
  }));
  return { name, table: name.toLowerCase(), fields };
}

function external(name: string, undo: readonly string[]): ExternalSummary {
  return {
    name,
    attempts: 3,
    backoff: "fixed",
    timeoutMs: 1000,
    compensate: undo,
    inputKeys: ["sku"],
    outputKeys: ["ok"],
  };
}

const externals = [
  external("inventory.reserve", ["inventory.release"]),
  external("payment.authorize", ["payment.void"]),
  external("notify.receipt", []),
  external("inventory.release", []),
  external("payment.void", []),
];

const uses: readonly FlowUse[] = [
  {
    model: "Order",
    operation: "create",
    steps: ["inventory.reserve", "payment.authorize", "notify.receipt"],
  },
];

const models = [
  model("Order", [
    ["customer", "Customer"],
    ["address", "Address"],
  ]),
  model("Customer", []),
  model("Address", [["customer", "Customer"]]),
];

function operationName(lane: { operation: string }): string {
  return lane.operation;
}

function cardName(card: { name: string }): string {
  return card.name;
}

function cardStep(card: { step: number }): number {
  return card.step;
}

function relationTarget(row: { target: string }): string {
  return row.target;
}
describe("every model is drawn as a root call", () => {
  it("gives each model a block with all four operations", () => {
    const laid = blocksOf(models, externals, uses);
    assert.equal(laid.blocks.length, models.length, "a model without traffic still gets a block");
    for (const block of laid.blocks) {
      const named = block.lanes.map(operationName);
      assert.deepEqual(
        named,
        ["create", "list", "update", "delete"],
        `${block.model} must show every operation, even the quiet ones`,
      );
    }
  });

  it("chains the observed steps in order and marks the quiet lanes", () => {
    const laid = blocksOf(models, externals, uses);
    for (const block of laid.blocks) {
      if (block.model !== "Order") {
        continue;
      }
      for (const lane of block.lanes) {
        if (lane.operation !== "create") {
          assert.equal(lane.observed, false, `${lane.operation} called nothing`);
          assert.equal(lane.steps.length, 0);
          continue;
        }
        assert.equal(lane.observed, true);
        assert.deepEqual(lane.steps.map(cardName), [
          "inventory.reserve",
          "payment.authorize",
          "notify.receipt",
        ]);
        assert.deepEqual(lane.steps.map(cardStep), [1, 2, 3]);
      }
    }
  });

  it("hangs a compensation off the step that declares one, and only that step", () => {
    const laid = blocksOf(models, externals, uses);
    for (const block of laid.blocks) {
      for (const lane of block.lanes) {
        for (const card of lane.steps) {
          if (card.name === "inventory.reserve") {
            assert.deepEqual(card.undo, ["inventory.release"]);
          }
          if (card.name === "notify.receipt") {
            assert.deepEqual(card.undo, [], "an external with no compensate declares no undo");
          }
        }
      }
    }
  });

  it("steps march left to right and never overlap", () => {
    const laid = blocksOf(models, externals, uses);
    for (const block of laid.blocks) {
      for (const lane of block.lanes) {
        let previousRight = -1;
        for (const card of lane.steps) {
          assert.ok(
            card.x > previousRight,
            `${card.name} starts at ${String(card.x)} which is not past ${String(previousRight)}`,
          );
          previousRight = card.x;
        }
      }
    }
  });

  it("carries relations as rows rather than as drawn edges", () => {
    const laid = blocksOf(models, externals, uses);
    for (const block of laid.blocks) {
      if (block.model === "Order") {
        assert.deepEqual(
          block.relations.map(relationTarget),
          ["Customer", "Address"],
          "a relation is a row naming its target, which is what removed the long arrows",
        );
      }
      if (block.model === "Customer") {
        assert.deepEqual(block.relations, []);
      }
    }
  });

  it("packs blocks into rows without letting one wide block stretch the rest", () => {
    const laid = blocksOf(models, externals, uses);
    for (const block of laid.blocks) {
      assert.ok(block.x + block.width <= laid.width, `${block.model} sticks out past the canvas`);
      assert.ok(block.y + block.height <= laid.height, `${block.model} hangs below the canvas`);
    }
    assert.ok(
      laid.width <= Math.max(targetCanvasWidth, widestBlock(laid.blocks)),
      "rows must wrap at the target width",
    );
  });

  it("puts the busiest model first so the flow is what you see", () => {
    const laid = blocksOf(models, externals, uses);
    const first = laid.blocks[0];
    assert.ok(first !== undefined);
    assert.equal(first.model, "Order", "the model that actually runs a saga leads");
  });

  it("never overlaps two blocks", () => {
    const laid = blocksOf(models, externals, uses);
    for (const left of laid.blocks) {
      for (const right of laid.blocks) {
        if (left.model === right.model) {
          continue;
        }
        const apart =
          left.x + left.width <= right.x ||
          right.x + right.width <= left.x ||
          left.y + left.height <= right.y ||
          right.y + right.height <= left.y;
        assert.ok(apart, `${left.model} overlaps ${right.model}`);
      }
    }
  });
});

function widestBlock(blocks: readonly { width: number }[]): number {
  let widest = 0;
  for (const block of blocks) {
    if (block.width > widest) {
      widest = block.width;
    }
  }
  return widest;
}
