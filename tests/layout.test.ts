import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cardFooterHeight,
  cardHeaderHeight,
  heightOf,
  layerAssignment,
  layerFor,
  layoutOf,
  portIndexOf,
  portRowHeight,
} from "../src/graph/layout.ts";
import type { GraphEdge, GraphNode } from "../src/graph/layout.ts";
import {
  declaredEdges,
  modelNodeId,
  nodesOf,
  observedExternalEdges,
  observedNestingEdges,
} from "../src/map.ts";
import type { ExternalSummary, ModelSummary, OutboxEntry, SpanEntry } from "@fookiejs/core";

function node(id: string): GraphNode {
  return { id, label: id, kind: "model", subtitle: "", ports: [], fields: [] };
}

function edge(from: string, to: string): GraphEdge {
  return {
    from,
    fromPort: "card",
    to,
    toPort: "card",
    kind: "relation",
    label: "",
    weight: 1,
    step: 0,
    plane: "data",
  };
}

describe("layered layout", () => {
  it("puts a source before what depends on it", () => {
    const layers = layerAssignment(
      [node("a"), node("b"), node("c")],
      [edge("a", "b"), edge("b", "c")],
    );
    assert.equal(layerFor(layers, "a"), 0);
    assert.equal(layerFor(layers, "b"), 1);
    assert.equal(layerFor(layers, "c"), 2);
  });

  it("places a node after its deepest parent, not its first", () => {
    const layers = layerAssignment(
      [node("a"), node("b"), node("c")],
      [edge("a", "c"), edge("a", "b"), edge("b", "c")],
    );
    assert.equal(layerFor(layers, "c"), 2, "c waits for b even though a is also a parent");
  });

  it("terminates on a cycle instead of spinning", () => {
    const layers = layerAssignment([node("a"), node("b")], [edge("a", "b"), edge("b", "a")]);
    assert.equal(layers.length, 2, "every node still gets a layer");
  });

  it("ignores a self reference", () => {
    const placed = layoutOf([node("a")], [edge("a", "a")]);
    assert.equal(placed.nodes.length, 1);
    assert.equal(placed.edges.length, 0, "a self edge would be a loop on one box");
  });

  it("drops an edge pointing at a node that is not on the graph", () => {
    const placed = layoutOf([node("a")], [edge("a", "ghost")]);
    assert.equal(placed.edges.length, 0);
  });

  it("is deterministic so two renders can be compared by eye", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d")];
    const first = layoutOf(nodes, edges);
    const second = layoutOf(nodes, edges);
    assert.deepEqual(first.nodes, second.nodes);
  });

  it("never overlaps two boxes", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d"), node("e")];
    const placed = layoutOf(nodes, [edge("a", "b"), edge("a", "c")]);
    for (const left of placed.nodes) {
      for (const right of placed.nodes) {
        if (left.id === right.id) {
          continue;
        }
        const apart =
          left.x + left.width <= right.x ||
          right.x + right.width <= left.x ||
          left.y + left.height <= right.y ||
          right.y + right.height <= left.y;
        assert.ok(apart, `${left.id} overlaps ${right.id}`);
      }
    }
  });

  it("reports an empty graph rather than throwing", () => {
    const placed = layoutOf([], []);
    assert.equal(placed.nodes.length, 0);
    assert.equal(placed.width, 0);
  });

  it("refuses a duplicate node id", () => {
    assert.throws(() => layoutOf([node("a"), node("a")], []), /appears twice/);
  });
});

const models: readonly ModelSummary[] = [
  {
    name: "Order",
    table: "order",
    fields: [
      {
        key: "id",
        column: "id",
        pgType: "UUID",
        relation: [],
        unique: false,
        index: false,
        system: true,
      },
      {
        key: "buyer",
        column: "buyer",
        pgType: "UUID",
        relation: ["User"],
        unique: false,
        index: true,
        system: false,
      },
    ],
  },
  {
    name: "User",
    table: "user",
    fields: [
      {
        key: "id",
        column: "id",
        pgType: "UUID",
        relation: [],
        unique: false,
        index: false,
        system: true,
      },
    ],
  },
];

const externals: readonly ExternalSummary[] = [
  {
    name: "pay.charge",
    attempts: 3,
    backoff: "fixed",
    timeoutMs: 1000,
    inputKeys: ["amount"],
    outputKeys: ["ref"],
    compensate: ["pay.refund"],
  },
  {
    name: "pay.refund",
    attempts: 3,
    backoff: "fixed",
    timeoutMs: 1000,
    inputKeys: ["ref"],
    outputKeys: ["ok"],
    compensate: [],
  },
];

describe("application map", () => {
  it("makes a node for every model and every external", () => {
    const nodes = nodesOf(models, externals);
    assert.equal(nodes.length, 4);
    assert.deepEqual(
      nodes.map((entry) => entry.kind),
      ["model", "model", "external", "external"],
    );
  });

  it("draws declared relations from the field metadata", () => {
    const edges = declaredEdges(models, externals);
    const relations = edges.filter((entry) => entry.kind === "relation");
    assert.equal(relations.length, 1);
    for (const relation of relations) {
      assert.equal(relation.from, modelNodeId("Order"));
      assert.equal(relation.to, modelNodeId("User"));
      assert.equal(relation.label, "buyer", "the edge names the column that carries the link");
    }
  });

  it("pairs an external with its compensation", () => {
    const edges = declaredEdges(models, externals);
    const undo = edges.filter((entry) => entry.kind === "compensates");
    assert.equal(undo.length, 1);
  });

  it("counts observed model to external calls from the outbox", () => {
    const rows = [
      { model: "Order", name: "pay.charge", runId: "run-1", stepIndex: 1 },
      { model: "Order", name: "pay.charge", runId: "run-1", stepIndex: 1 },
      { model: "User", name: "pay.charge", runId: "run-2", stepIndex: 0 },
    ] as unknown as readonly OutboxEntry[];
    const runs = [
      { runId: "run-1", operation: "create" },
      { runId: "run-2", operation: "update" },
    ];
    const edges = observedExternalEdges(rows, runs);
    assert.equal(edges.length, 2, "two distinct caller pairs");
    const heavy = edges.filter((call) => call.from === modelNodeId("Order"));
    for (const call of heavy) {
      assert.equal(call.weight, 2, "the repeated call is counted, not duplicated");
      assert.equal(call.fromPort, "create", "the edge leaves the create flow port");
      assert.equal(call.label, "2", "the edge carries the step number");
      assert.equal(call.step, 2);
    }
  });

  it("draws model to model edges from the recorded parent, not from timing", () => {
    const spans = [
      {
        model: "Note",
        parentModel: ["Order"],
        parentEntityId: ["e1"],
        operation: "create",
        traceId: "t1",
      },
      {
        model: "Note",
        parentModel: ["Order"],
        parentEntityId: ["e1"],
        operation: "create",
        traceId: "t1",
      },
      { model: "Order", parentModel: [] },
    ] as unknown as readonly SpanEntry[];
    const edges = observedNestingEdges(spans);
    assert.equal(edges.length, 1);
    for (const entry of edges) {
      assert.equal(entry.from, modelNodeId("Order"));
      assert.equal(entry.to, modelNodeId("Note"));
      assert.equal(entry.weight, 2);
    }
  });

  it("ignores a span whose parent is its own model", () => {
    const spans = [
      {
        model: "Order",
        parentModel: ["Order"],
        parentEntityId: ["e1"],
        operation: "create",
        traceId: "t1",
      },
    ] as unknown as readonly SpanEntry[];
    assert.equal(observedNestingEdges(spans).length, 0);
  });
});

describe("cyclic graphs", () => {
  it("still spreads a graph whose relation and nesting edges disagree", () => {
    const nodes = [
      { id: "model:Order", label: "Order", kind: "model", subtitle: "", ports: [], fields: [] },
      {
        id: "model:OrderLog",
        label: "OrderLog",
        kind: "model",
        subtitle: "",
        ports: [],
        fields: [],
      },
      {
        id: "model:Customer",
        label: "Customer",
        kind: "model",
        subtitle: "",
        ports: [],
        fields: [],
      },
      { id: "external:pay", label: "pay", kind: "external", subtitle: "", ports: [], fields: [] },
    ];
    const edges = [
      {
        from: "model:Order",
        fromPort: "card",
        to: "model:Customer",
        toPort: "card",
        kind: "relation",
        label: "",
        weight: 1,
        step: 0,
        plane: "data",
      },
      {
        from: "model:OrderLog",
        fromPort: "card",
        to: "model:Order",
        toPort: "card",
        kind: "relation",
        label: "",
        weight: 1,
        step: 0,
        plane: "data",
      },
      {
        from: "model:Order",
        fromPort: "card",
        to: "model:OrderLog",
        toPort: "card",
        kind: "nests",
        label: "",
        weight: 1,
        step: 0,
        plane: "flow",
      },
      {
        from: "model:Order",
        fromPort: "card",
        to: "external:pay",
        toPort: "card",
        kind: "invokes",
        label: "",
        weight: 1,
        step: 1,
        plane: "flow",
      },
    ];

    const layout = layoutOf(nodes, edges);
    const columns = new Set(layout.nodes.map((node) => node.x));
    assert.ok(
      columns.size >= 2,
      "a two node cycle must not collapse the whole map into one column",
    );
    assert.ok(layout.width > 0);
    for (const placed of layout.nodes) {
      assert.ok(placed.layer < nodes.length, "no node may be pushed past the node count");
    }
  });

  it("keeps a plain chain in dependency order", () => {
    const nodes = [
      { id: "a", label: "a", kind: "model", subtitle: "", ports: [], fields: [] },
      { id: "b", label: "b", kind: "model", subtitle: "", ports: [], fields: [] },
      { id: "c", label: "c", kind: "model", subtitle: "", ports: [], fields: [] },
    ];
    const edges = [
      {
        from: "a",
        fromPort: "card",
        to: "b",
        toPort: "card",
        kind: "invokes",
        label: "",
        weight: 1,
        step: 1,
        plane: "flow",
      },
      {
        from: "b",
        fromPort: "card",
        to: "c",
        toPort: "card",
        kind: "invokes",
        label: "",
        weight: 1,
        step: 2,
        plane: "flow",
      },
    ];
    const layout = layoutOf(nodes, edges);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    assert.equal(byId.get("a")?.layer, 0);
    assert.equal(byId.get("b")?.layer, 1);
    assert.equal(byId.get("c")?.layer, 2);
  });
});

describe("flow ports", () => {
  const orderOnly = [
    {
      name: "Order",
      table: "order",
      fields: [
        {
          key: "id",
          column: "id",
          pgType: "UUID",
          relation: [],
          unique: false,
          index: false,
          system: true,
        },
      ],
    },
  ] as unknown as readonly ModelSummary[];

  it("gives every model all four flows even when nothing was observed", () => {
    const portIds = (card: GraphNode) => card.ports.map((port) => port.id);
    for (const card of nodesOf(orderOnly, [])) {
      assert.deepEqual(
        portIds(card),
        ["create", "list", "update", "delete"],
        "an unused flow still has to be on the card",
      );
      for (const port of card.ports) {
        assert.equal(port.active, false, "nothing observed means nothing lit");
      }
    }
  });

  it("marks the flow that was actually seen calling something", () => {
    const uses = [{ model: "Order", operation: "create", steps: ["pay.charge"] }];
    for (const card of nodesOf(orderOnly, [], uses)) {
      for (const port of card.ports) {
        assert.equal(port.active, port.id === "create", `${port.id} activity`);
      }
    }
  });

  it("sizes a card from its ports so edges can anchor on a row", () => {
    for (const card of nodesOf(orderOnly, [])) {
      assert.equal(heightOf(card), cardHeaderHeight + 4 * portRowHeight + cardFooterHeight);
      assert.equal(portIndexOf(card, "delete"), 3);
      assert.equal(portIndexOf(card, "nope"), -1);
    }
  });
});
