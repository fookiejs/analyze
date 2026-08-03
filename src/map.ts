import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "./errors.ts";
import type { ExternalSummary, ModelSummary } from "@fookiejs/core";
import { dataPlane, flowPlane } from "./graph/layout.ts";
import type { GraphEdge, GraphField, GraphNode, GraphPort } from "./graph/layout.ts";
import {
  cardPort,
  compensationLabel,
  compensatesEdgeKind,
  externalInputPort,
  externalNodeId,
  externalNodeKind,
  externalUndoPort,
  flowOperations,
  modelNodeId,
  modelNodeKind,
  relationEdgeKind,
} from "./map-ids.ts";
import { noCompensation } from "./map-ids.ts";
import type { FlowUse } from "./map-ids.ts";

export * from "./map-ids.ts";
export {
  callersFromSpans,
  flowUsesFrom,
  isCompensation,
  observedExternalEdges,
  observedNestingEdges,
} from "./map-edges.ts";
export type { CallerOf, OperationOf } from "./map-edges.ts";

function usedSteps(uses: readonly FlowUse[], model: string, operation: string): readonly string[] {
  for (const use of uses) {
    if (use.model !== model) {
      continue;
    }
    if (use.operation !== operation) {
      continue;
    }
    return use.steps;
  }
  return [];
}

export const maxFocusDepth = 4;

function reachableFrom(
  start: string,
  edges: readonly GraphEdge[],
  depth: number,
): readonly string[] {
  let reached: readonly string[] = [start];
  let frontier: readonly string[] = [start];
  for (let hop = 0; hop < depth; hop = hop + 1) {
    let next: readonly string[] = [];
    for (const edge of edges) {
      if (frontier.includes(edge.from) === false) {
        continue;
      }
      if (reached.includes(edge.to)) {
        continue;
      }
      reached = appendItem(reached, edge.to);
      next = appendItem(next, edge.to);
    }
    if (next.length < 1) {
      return reached;
    }
    frontier = next;
  }
  return reached;
}

export function focusedGraph(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  focus: string,
  depth: number = maxFocusDepth,
): { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] } {
  if (z.string().min(1).safeParse(focus).success === false) {
    return { nodes, edges };
  }
  const start = modelNodeId(focus);
  let known = false;
  for (const node of nodes) {
    if (node.id === start) {
      known = true;
    }
  }
  if (known === false) {
    return { nodes, edges };
  }
  const kept = reachableFrom(start, edges, Math.min(depth, maxFocusDepth));
  let keptNodes: readonly GraphNode[] = [];
  for (const node of nodes) {
    if (kept.includes(node.id) === false) {
      continue;
    }
    keptNodes = appendItem(keptNodes, node);
  }
  let keptEdges: readonly GraphEdge[] = [];
  for (const edge of edges) {
    if (kept.includes(edge.from) === false || kept.includes(edge.to) === false) {
      continue;
    }
    keptEdges = appendItem(keptEdges, edge);
  }
  return { nodes: keptNodes, edges: keptEdges };
}

export function touchedFlows(edges: readonly GraphEdge[]): readonly string[] {
  let touched: readonly string[] = [];
  for (const edge of edges) {
    if (edge.plane !== flowPlane) {
      continue;
    }
    for (const side of [`${edge.from} ${edge.fromPort}`, `${edge.to} ${edge.toPort}`]) {
      if (touched.includes(side)) {
        continue;
      }
      touched = appendItem(touched, side);
    }
  }
  return touched;
}

export const idleFlow = "not observed";

function stepSummary(steps: readonly string[], busy: boolean): string {
  if (steps.length > 1) {
    return `${String(steps.length)} calls`;
  }
  if (steps.length === 1) {
    return "1 call";
  }
  if (busy === true) {
    return "runs";
  }
  return idleFlow;
}

function flowPortsFor(
  model: ModelSummary,
  uses: readonly FlowUse[],
  touched: readonly string[],
): readonly GraphPort[] {
  let ports: readonly GraphPort[] = [];
  for (const operation of flowOperations) {
    const steps = usedSteps(uses, model.name, operation);
    const reached = touched.includes(`${modelNodeId(model.name)} ${operation}`);
    const busy = steps.length > 0 || reached === true;
    ports = appendItem(ports, {
      id: operation,
      label: operation,
      detail: stepSummary(steps, busy),
      active: busy,
    });
  }
  if (ports.length !== flowOperations.length) {
    throw AnalyzeError.create("every model shows all four flows");
  }
  return ports;
}

function firstText(values: readonly string[]): string {
  if (Array.isArray(values) === false) {
    return noCompensation;
  }
  for (const value of values) {
    if (value.length > 0) {
      return value;
    }
  }
  return noCompensation;
}

function externalPorts(external: ExternalSummary): readonly GraphPort[] {
  const undo = firstText(external.compensate);
  return [
    {
      id: externalInputPort,
      label: "called",
      detail: `${String(external.attempts)} attempts`,
      active: true,
    },
    {
      id: externalUndoPort,
      label: "undo",
      detail: undo,
      active: undo !== noCompensation,
    },
  ];
}

export const maxShownFields = 9;

function fieldRowsFor(model: ModelSummary, detailed: boolean): readonly GraphField[] {
  if (detailed === false) {
    return [];
  }
  let rows: readonly GraphField[] = [];
  let hidden = 0;
  for (const field of model.fields) {
    if (field.system === true) {
      continue;
    }
    if (rows.length >= maxShownFields) {
      hidden = hidden + 1;
      continue;
    }
    rows = appendItem(rows, {
      key: field.key,
      detail: field.relation.length > 0 ? firstText(field.relation) : field.pgType.toLowerCase(),
      relation: field.relation,
    });
  }
  if (hidden > 0) {
    rows = appendItem(rows, {
      key: `+${String(hidden)} more`,
      detail: "…",
      relation: [],
    });
  }
  return rows;
}

export function nodesOf(
  models: readonly ModelSummary[],
  externals: readonly ExternalSummary[],
  uses: readonly FlowUse[] = [],
  touched: readonly string[] = [],
  detailed: readonly string[] = [],
): readonly GraphNode[] {
  let nodes: readonly GraphNode[] = [];
  for (const model of models) {
    nodes = appendItem(nodes, {
      id: modelNodeId(model.name),
      label: model.name,
      kind: modelNodeKind,
      subtitle: `${model.table} · ${String(model.fields.length)} fields`,
      ports: flowPortsFor(model, uses, touched),
      fields: fieldRowsFor(model, detailed.includes(model.name)),
    });
  }
  for (const external of externals) {
    nodes = appendItem(nodes, {
      id: externalNodeId(external.name),
      label: external.name,
      kind: externalNodeKind,
      subtitle: `${external.backoff} · ${String(external.timeoutMs)}ms`,
      ports: externalPorts(external),
      fields: [],
    });
  }
  return nodes;
}

export function declaredEdges(
  models: readonly ModelSummary[],
  externals: readonly ExternalSummary[],
): readonly GraphEdge[] {
  let edges: readonly GraphEdge[] = [];
  for (const model of models) {
    for (const field of model.fields) {
      for (const target of field.relation) {
        edges = appendItem(edges, {
          from: modelNodeId(model.name),
          fromPort: cardPort,
          to: modelNodeId(target),
          toPort: cardPort,
          kind: relationEdgeKind,
          label: field.key,
          weight: 1,
          step: 0,
          plane: dataPlane,
        });
      }
    }
  }
  for (const external of externals) {
    for (const undo of external.compensate) {
      edges = appendItem(edges, {
        from: externalNodeId(external.name),
        fromPort: externalUndoPort,
        to: externalNodeId(undo),
        toPort: externalInputPort,
        kind: compensatesEdgeKind,
        label: compensationLabel,
        weight: 1,
        step: 0,
        plane: flowPlane,
      });
    }
  }
  return edges;
}
