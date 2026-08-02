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
          label: field.key,
          weight: 1,
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
        label: "undo",
        weight: 1,
      });
    }
  }
  return edges;
}

export function observedExternalEdges(rows: readonly OutboxEntry[]): readonly GraphEdge[] {
  let counts: readonly { from: string; to: string; weight: number }[] = [];
  for (const row of rows) {
    const from = modelNodeId(row.model);
    const to = externalNodeId(row.name);
    let seen = false;
    let next: readonly { from: string; to: string; weight: number }[] = [];
    for (const tally of counts) {
      if (tally.from === from && tally.to === to) {
        seen = true;
        next = appendItem(next, { from, to, weight: tally.weight + 1 });
        continue;
      }
      next = appendItem(next, tally);
    }
    if (seen === false) {
      next = appendItem(next, { from, to, weight: 1 });
    }
    counts = next;
  }
  let edges: readonly GraphEdge[] = [];
  for (const tally of counts) {
    edges = appendItem(edges, {
      from: tally.from,
      to: tally.to,
      kind: invokesEdgeKind,
      label: `${tally.weight}`,
      weight: tally.weight,
    });
  }
  return edges;
}

export function observedNestingEdges(spans: readonly SpanEntry[]): readonly GraphEdge[] {
  let counts: readonly { from: string; to: string; weight: number }[] = [];
  for (const span of spans) {
    for (const parent of span.parentModel) {
      if (parent === span.model) {
        continue;
      }
      const from = modelNodeId(parent);
      const to = modelNodeId(span.model);
      let seen = false;
      let next: readonly { from: string; to: string; weight: number }[] = [];
      for (const tally of counts) {
        if (tally.from === from && tally.to === to) {
          seen = true;
          next = appendItem(next, { from, to, weight: tally.weight + 1 });
          continue;
        }
        next = appendItem(next, tally);
      }
      if (seen === false) {
        next = appendItem(next, { from, to, weight: 1 });
      }
      counts = next;
    }
  }
  let edges: readonly GraphEdge[] = [];
  for (const tally of counts) {
    edges = appendItem(edges, {
      from: tally.from,
      to: tally.to,
      kind: nestsEdgeKind,
      label: `${tally.weight}`,
      weight: tally.weight,
    });
  }
  return edges;
}
