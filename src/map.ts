import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "./errors.ts";
import type { ExternalSummary, ModelSummary, OutboxEntry, SpanEntry } from "@fookiejs/core";
import type { GraphEdge, GraphNode } from "./graph/layout.ts";

export const modelNodeKind = "model";
export const externalNodeKind = "external";

export const relationEdgeKind = "relation";
export const invokesEdgeKind = "invokes";
export const nestsEdgeKind = "nests";
export const compensatesEdgeKind = "compensates";

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

export function nodesOf(
  models: readonly ModelSummary[],
  externals: readonly ExternalSummary[],
): readonly GraphNode[] {
  let nodes: readonly GraphNode[] = [];
  for (const model of models) {
    nodes = appendItem(nodes, {
      id: modelNodeId(model.name),
      label: model.name,
      kind: modelNodeKind,
    });
  }
  for (const external of externals) {
    nodes = appendItem(nodes, {
      id: externalNodeId(external.name),
      label: external.name,
      kind: externalNodeKind,
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
          to: modelNodeId(target),
          kind: relationEdgeKind,
          label: `${field.key} →`,
          weight: 1,
          step: 0,
        });
      }
    }
  }
  for (const external of externals) {
    for (const undo of external.compensate) {
      edges = appendItem(edges, {
        from: externalNodeId(external.name),
        to: externalNodeId(undo),
        kind: compensatesEdgeKind,
        label: "undoes with",
        weight: 1,
        step: 0,
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

export const unknownOperation = "flow";

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

type CallTally = {
  from: string;
  to: string;
  operation: string;
  weight: number;
  step: number;
};

function tallyCall(counts: readonly CallTally[], seen: CallTally): readonly CallTally[] {
  let matched = false;
  let next: readonly CallTally[] = [];
  for (const tally of counts) {
    if (tally.from === seen.from && tally.to === seen.to && tally.operation === seen.operation) {
      matched = true;
      next = appendItem(next, {
        from: tally.from,
        to: tally.to,
        operation: tally.operation,
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

export const undoOperation = "undo";

function isCompensation(row: OutboxEntry): boolean {
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
    const undone = isCompensation(row);
    let named = operationFor(runs, row.runId);
    if (named === unknownOperation) {
      for (const fromSpan of callerOperation(callers, row.model, row.name)) {
        named = fromSpan;
      }
    }
    counts = tallyCall(counts, {
      from: modelNodeId(row.model),
      to: externalNodeId(row.name),
      operation: undone === true ? undoOperation : named,
      weight: 1,
      step: row.stepIndex + 1,
    });
  }
  let edges: readonly GraphEdge[] = [];
  for (const tally of counts) {
    const step = String(tally.step);
    const wording =
      tally.operation === undoOperation ? `undoes step ${step}` : `${tally.operation} step ${step}`;
    edges = appendItem(edges, {
      from: tally.from,
      to: tally.to,
      kind: invokesEdgeKind,
      label: wording,
      weight: tally.weight,
      step: tally.step,
    });
  }
  return edges;
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
        to: modelNodeId(span.model),
        operation: named.success === true ? named.data : unknownOperation,
        weight: 1,
        step: 0,
      });
    }
  }
  let edges: readonly GraphEdge[] = [];
  for (const tally of counts) {
    const started = tally.operation;
    edges = appendItem(edges, {
      from: tally.from,
      to: tally.to,
      kind: nestsEdgeKind,
      label: `${started}s a`,
      weight: tally.weight,
      step: 0,
    });
  }
  return edges;
}
