import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "./errors.ts";
import type { ExternalSummary, ModelSummary, OutboxEntry, SpanEntry } from "@fookiejs/core";
import { dataPlane, flowPlane } from "./graph/layout.ts";
import type { GraphEdge, GraphField, GraphNode, GraphPort } from "./graph/layout.ts";

export const modelNodeKind = "model";
export const externalNodeKind = "external";

export const relationEdgeKind = "relation";
export const invokesEdgeKind = "invokes";
export const nestsEdgeKind = "nests";
export const compensatesEdgeKind = "compensates";

export const flowOperations: readonly string[] = ["create", "list", "update", "delete"];

export const externalInputPort = "in";
export const externalUndoPort = "undo";
export const cardPort = "card";

export const unknownOperation = "flow";
export const undoOperation = "undo";

export const nestingLabel = "nests";

export const compensationLabel = "undo";

export function modelNodeId(name: string): string {
  if (z.string().min(1).safeParse(name).success === false) {
    throw AnalyzeError.create("model name required");
  }
  const id = `model:${name}`;
  if (id.length <= "model:".length) {
    throw AnalyzeError.create("model node id required");
  }
  return id;
}

export function externalNodeId(name: string): string {
  if (z.string().min(1).safeParse(name).success === false) {
    throw AnalyzeError.create("external name required");
  }
  const id = `external:${name}`;
  if (id.length <= "external:".length) {
    throw AnalyzeError.create("external node id required");
  }
  return id;
}

export type FlowUse = {
  model: string;
  operation: string;
  steps: readonly string[];
};

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

export const noCompensation = "none";

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

export type OperationOf = {
  runId: string;
  operation: string;
};

export type CallerOf = {
  model: string;
  externalName: string;
  operation: string;
};

export function callersFromSpans(spans: readonly SpanEntry[]): readonly CallerOf[] {
  let callers: readonly CallerOf[] = [];
  for (const span of spans) {
    const named = z.string().min(1).safeParse(span.attributes.externalName);
    if (named.success === false) {
      continue;
    }
    const operation = z.string().min(1).safeParse(span.operation);
    if (operation.success === false) {
      continue;
    }
    callers = appendItem(callers, {
      model: span.model,
      externalName: named.data,
      operation: operation.data,
    });
  }
  return callers;
}

function callerOperation(
  callers: readonly CallerOf[],
  model: string,
  externalName: string,
): readonly string[] {
  for (const caller of callers) {
    if (caller.model !== model) {
      continue;
    }
    if (caller.externalName !== externalName) {
      continue;
    }
    return [caller.operation];
  }
  return [];
}

function operationFor(runs: readonly OperationOf[], runId: string): string {
  if (z.string().min(1).safeParse(runId).success === false) {
    return unknownOperation;
  }
  for (const run of runs) {
    if (run.runId !== runId) {
      continue;
    }
    if (run.operation.length < 1) {
      return unknownOperation;
    }
    return run.operation;
  }
  return unknownOperation;
}

function callingFlow(
  row: OutboxEntry,
  runs: readonly OperationOf[],
  callers: readonly CallerOf[],
): string {
  const named = operationFor(runs, row.runId);
  if (named !== unknownOperation) {
    return named;
  }
  for (const fromSpan of callerOperation(callers, row.model, row.name)) {
    return fromSpan;
  }
  return unknownOperation;
}

type CallTally = {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  weight: number;
  step: number;
};

function sameEndpoints(tally: CallTally, seen: CallTally): boolean {
  if (tally.from !== seen.from || tally.fromPort !== seen.fromPort) {
    return false;
  }
  if (tally.to !== seen.to || tally.toPort !== seen.toPort) {
    return false;
  }
  return true;
}

function tallyCall(counts: readonly CallTally[], seen: CallTally): readonly CallTally[] {
  let matched = false;
  let next: readonly CallTally[] = [];
  for (const tally of counts) {
    if (sameEndpoints(tally, seen) === true) {
      matched = true;
      next = appendItem(next, {
        from: tally.from,
        fromPort: tally.fromPort,
        to: tally.to,
        toPort: tally.toPort,
        weight: tally.weight + 1,
        step: Math.min(tally.step, seen.step),
      });
      continue;
    }
    next = appendItem(next, tally);
  }
  if (matched === false) {
    next = appendItem(next, seen);
  }
  return next;
}

export function isCompensation(row: OutboxEntry): boolean {
  if (Array.isArray(row.compensationOf) === false) {
    return false;
  }
  if (row.compensationOf.length < 1) {
    return false;
  }
  for (const forward of row.compensationOf) {
    if (z.string().min(1).safeParse(forward).success === false) {
      return false;
    }
    return true;
  }
  return false;
}

export function observedExternalEdges(
  rows: readonly OutboxEntry[],
  runs: readonly OperationOf[] = [],
  callers: readonly CallerOf[] = [],
): readonly GraphEdge[] {
  let counts: readonly CallTally[] = [];
  for (const row of rows) {
    if (isCompensation(row) === true) {
      continue;
    }
    const flow = callingFlow(row, runs, callers);
    if (flowOperations.includes(flow) === false) {
      continue;
    }
    counts = tallyCall(counts, {
      from: modelNodeId(row.model),
      fromPort: flow,
      to: externalNodeId(row.name),
      toPort: externalInputPort,
      weight: 1,
      step: row.stepIndex + 1,
    });
  }
  let edges: readonly GraphEdge[] = [];
  for (const tally of counts) {
    edges = appendItem(edges, {
      from: tally.from,
      fromPort: tally.fromPort,
      to: tally.to,
      toPort: tally.toPort,
      kind: invokesEdgeKind,
      label: String(tally.step),
      weight: tally.weight,
      step: tally.step,
      plane: flowPlane,
    });
  }
  return edges;
}

export function flowUsesFrom(
  rows: readonly OutboxEntry[],
  runs: readonly OperationOf[] = [],
  callers: readonly CallerOf[] = [],
): readonly FlowUse[] {
  let seen: readonly { key: string; at: number; name: string }[] = [];
  for (const row of rows) {
    if (isCompensation(row) === true) {
      continue;
    }
    const flow = callingFlow(row, runs, callers);
    if (flowOperations.includes(flow) === false) {
      continue;
    }
    let known = false;
    for (const hit of seen) {
      if (hit.key === `${row.model} ${flow}` && hit.at === row.stepIndex) {
        known = true;
      }
    }
    if (known === true) {
      continue;
    }
    seen = appendItem(seen, {
      key: `${row.model} ${flow}`,
      at: row.stepIndex,
      name: row.name,
    });
  }
  let uses: readonly FlowUse[] = [];
  for (const hit of seen) {
    const parts = hit.key.split(" ");
    const model = parts.length > 0 ? parts[0] : noCompensation;
    const operation = parts.length > 1 ? parts[1] : noCompensation;
    if (flowOperations.includes(String(operation)) === false) {
      continue;
    }
    let merged = false;
    let next: readonly FlowUse[] = [];
    for (const use of uses) {
      if (use.model === model && use.operation === operation) {
        merged = true;
        next = appendItem(next, {
          model: String(model),
          operation: String(operation),
          steps: appendItem(use.steps, hit.name),
        });
        continue;
      }
      next = appendItem(next, use);
    }
    const named = { model: String(model), operation: String(operation), steps: [hit.name] };
    uses = merged === true ? next : appendItem(uses, named);
  }
  return uses;
}

function parentOperationOf(spans: readonly SpanEntry[], child: SpanEntry): string {
  if (Array.isArray(child.parentModel) === false) {
    return unknownOperation;
  }
  if (Array.isArray(child.parentEntityId) === false) {
    return unknownOperation;
  }
  if (child.parentModel.length < 1 || child.parentEntityId.length < 1) {
    return unknownOperation;
  }
  for (const span of spans) {
    if (span.traceId !== child.traceId) {
      continue;
    }
    if (span.model !== child.parentModel[0]) {
      continue;
    }
    if (span.entityId !== child.parentEntityId[0]) {
      continue;
    }
    const named = z.string().min(1).safeParse(span.operation);
    if (named.success === false) {
      continue;
    }
    return named.data;
  }
  return unknownOperation;
}

export function observedNestingEdges(spans: readonly SpanEntry[]): readonly GraphEdge[] {
  let counts: readonly CallTally[] = [];
  for (const span of spans) {
    for (const parent of span.parentModel) {
      if (parent === span.model) {
        continue;
      }
      const named = z.string().min(1).safeParse(span.operation);
      counts = tallyCall(counts, {
        from: modelNodeId(parent),
        fromPort: parentOperationOf(spans, span),
        to: modelNodeId(span.model),
        toPort: named.success === true ? named.data : unknownOperation,
        weight: 1,
        step: 0,
      });
    }
  }
  let edges: readonly GraphEdge[] = [];
  for (const tally of counts) {
    edges = appendItem(edges, {
      from: tally.from,
      fromPort: tally.fromPort,
      to: tally.to,
      toPort: tally.toPort,
      kind: nestsEdgeKind,
      label: nestingLabel,
      weight: tally.weight,
      step: tally.step,
      plane: flowPlane,
    });
  }
  return edges;
}
