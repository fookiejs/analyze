import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "../errors.ts";

export type GraphNode = {
  id: string;
  label: string;
  kind: string;
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: string;
  label: string;
  weight: number;
};

export type LayerOf = {
  id: string;
  layer: number;
};

export type PlacedNode = GraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
};

export type Layout = {
  nodes: readonly PlacedNode[];
  edges: readonly GraphEdge[];
  width: number;
  height: number;
};

export const nodeWidth = 208;
export const nodeHeight = 64;
export const columnGap = 132;
export const rowGap = 28;

function idsOf(nodes: readonly GraphNode[]): readonly string[] {
  let ids: readonly string[] = [];
  for (const node of nodes) {
    if (z.string().min(1).safeParse(node.id).success === false) {
      throw AnalyzeError.create("graph node id required");
    }
    if (ids.includes(node.id)) {
      throw AnalyzeError.create(`graph node ${node.id} appears twice`);
    }
    ids = appendItem(ids, node.id);
  }
  return ids;
}

function keptEdges(edges: readonly GraphEdge[], ids: readonly string[]): readonly GraphEdge[] {
  let kept: readonly GraphEdge[] = [];
  for (const edge of edges) {
    if (ids.includes(edge.from) === false) {
      continue;
    }
    if (ids.includes(edge.to) === false) {
      continue;
    }
    if (edge.from === edge.to) {
      continue;
    }
    kept = appendItem(kept, edge);
  }
  return kept;
}

export function layerFor(layers: readonly LayerOf[], id: string): number {
  if (Array.isArray(layers) === false) {
    throw AnalyzeError.create("layer assignment required");
  }
  for (const entry of layers) {
    if (entry.id === id) {
      return entry.layer;
    }
  }
  return 0;
}

function rankOf(order: readonly string[], id: string): number {
  let index = 0;
  for (const candidate of order) {
    if (candidate === id) {
      return index;
    }
    index = index + 1;
  }
  return order.length;
}

function outgoingOf(edges: readonly GraphEdge[], id: string): readonly string[] {
  let targets: readonly string[] = [];
  for (const edge of edges) {
    if (edge.from !== id) {
      continue;
    }
    if (targets.includes(edge.to)) {
      continue;
    }
    targets = appendItem(targets, edge.to);
  }
  return targets;
}

function visitOrder(ids: readonly string[], edges: readonly GraphEdge[]): readonly string[] {
  let finished: readonly string[] = [];
  let entered: readonly string[] = [];
  for (const root of ids) {
    if (entered.includes(root)) {
      continue;
    }
    let stack: readonly string[] = [root];
    while (stack.length > 0) {
      let current = root;
      for (const top of stack.slice(-1)) {
        current = top;
      }
      if (entered.includes(current) === false) {
        entered = appendItem(entered, current);
      }
      let pushed = false;
      for (const next of outgoingOf(edges, current)) {
        if (entered.includes(next)) {
          continue;
        }
        stack = appendItem(stack, next);
        pushed = true;
        break;
      }
      if (pushed === true) {
        continue;
      }
      if (finished.includes(current) === false) {
        finished = appendItem(finished, current);
      }
      stack = stack.slice(0, -1);
    }
  }
  return finished.toReversed();
}

export function acyclicEdges(
  ids: readonly string[],
  edges: readonly GraphEdge[],
): readonly GraphEdge[] {
  const order = visitOrder(ids, edges);
  let forward: readonly GraphEdge[] = [];
  for (const edge of edges) {
    if (rankOf(order, edge.from) >= rankOf(order, edge.to)) {
      continue;
    }
    forward = appendItem(forward, edge);
  }
  return forward;
}

function relaxOnce(layers: readonly LayerOf[], edges: readonly GraphEdge[]): readonly LayerOf[] {
  let next: readonly LayerOf[] = [];
  for (const entry of layers) {
    let deepest = entry.layer;
    for (const edge of edges) {
      if (edge.to !== entry.id) {
        continue;
      }
      const candidate = layerFor(layers, edge.from) + 1;
      if (candidate > deepest) {
        deepest = candidate;
      }
    }
    next = appendItem(next, { id: entry.id, layer: deepest });
  }
  return next;
}

function sameLayers(left: readonly LayerOf[], right: readonly LayerOf[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (const entry of left) {
    if (layerFor(right, entry.id) !== entry.layer) {
      return false;
    }
  }
  return true;
}

export function layerAssignment(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly LayerOf[] {
  const ids = idsOf(nodes);
  const forward = acyclicEdges(ids, keptEdges(edges, ids));
  let layers: readonly LayerOf[] = [];
  for (const id of ids) {
    layers = appendItem(layers, { id, layer: 0 });
  }
  for (let pass = 0; pass < ids.length; pass = pass + 1) {
    const relaxed = relaxOnce(layers, forward);
    if (sameLayers(relaxed, layers)) {
      return relaxed;
    }
    layers = relaxed;
  }
  return layers;
}

function incomingCount(edges: readonly GraphEdge[], id: string): number {
  let total = 0;
  for (const edge of edges) {
    if (edge.to === id) {
      total += 1;
    }
  }
  return total;
}

function orderKeyOf(edges: readonly GraphEdge[], node: GraphNode): string {
  if (z.string().min(1).safeParse(node.id).success === false) {
    throw AnalyzeError.create("graph node id required");
  }
  const incoming = incomingCount(edges, node.id);
  const padded = String(1000 - incoming).padStart(4, "0");
  if (padded.length < 4) {
    throw AnalyzeError.create("order key must sort lexically");
  }
  return `${padded}:${node.label}`;
}

function columnOf(
  nodes: readonly GraphNode[],
  layers: readonly LayerOf[],
  column: number,
  edges: readonly GraphEdge[],
): readonly GraphNode[] {
  let inColumn: readonly GraphNode[] = [];
  for (const node of nodes) {
    if (layerFor(layers, node.id) === column) {
      inColumn = appendItem(inColumn, node);
    }
  }
  return inColumn.toSorted((left, right) =>
    orderKeyOf(edges, left).localeCompare(orderKeyOf(edges, right)),
  );
}

export function layoutOf(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Layout {
  if (nodes.length < 1) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const ids = idsOf(nodes);
  const usable = keptEdges(edges, ids);
  const layers = layerAssignment(nodes, usable);

  let deepest = 0;
  for (const node of nodes) {
    const layer = layerFor(layers, node.id);
    if (layer > deepest) {
      deepest = layer;
    }
  }

  let placed: readonly PlacedNode[] = [];
  let tallest = 0;
  for (let column = 0; column <= deepest; column += 1) {
    let row = 0;
    for (const placedNode of columnOf(nodes, layers, column, usable)) {
      placed = appendItem(placed, {
        id: placedNode.id,
        label: placedNode.label,
        kind: placedNode.kind,
        layer: column,
        x: column * (nodeWidth + columnGap),
        y: row * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
      });
      row += 1;
    }
    if (row > tallest) {
      tallest = row;
    }
  }

  return {
    nodes: placed,
    edges: usable,
    width: (deepest + 1) * nodeWidth + deepest * columnGap,
    height: Math.max(tallest, 1) * nodeHeight + Math.max(tallest - 1, 0) * rowGap,
  };
}
