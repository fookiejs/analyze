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

export const nodeWidth = 190;
export const nodeHeight = 56;
export const columnGap = 110;
export const rowGap = 34;

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

function settledIds(layers: readonly LayerOf[]): readonly string[] {
  if (Array.isArray(layers) === false) {
    throw AnalyzeError.create("layer assignment required");
  }
  let ids: readonly string[] = [];
  for (const entry of layers) {
    ids = appendItem(ids, entry.id);
  }
  return ids;
}

function readyFor(id: string, edges: readonly GraphEdge[], settled: readonly string[]): boolean {
  for (const edge of edges) {
    if (edge.to !== id) {
      continue;
    }
    if (settled.includes(edge.from) === false) {
      return false;
    }
  }
  return true;
}

function deepestParentOf(
  id: string,
  edges: readonly GraphEdge[],
  layers: readonly LayerOf[],
): number {
  let deepest = 0;
  for (const edge of edges) {
    if (edge.to !== id) {
      continue;
    }
    const parentLayer = layerFor(layers, edge.from) + 1;
    if (parentLayer > deepest) {
      deepest = parentLayer;
    }
  }
  return deepest;
}

export function layerAssignment(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly LayerOf[] {
  const ids = idsOf(nodes);
  const usable = keptEdges(edges, ids);
  let layers: readonly LayerOf[] = [];
  let guard = 0;
  while (layers.length < ids.length) {
    guard += 1;
    if (guard > ids.length + 1) {
      for (const id of ids) {
        if (settledIds(layers).includes(id) === false) {
          layers = appendItem(layers, { id, layer: guard });
        }
      }
      return layers;
    }
    const settled = settledIds(layers);
    let placedThisRound = 0;
    for (const id of ids) {
      if (settled.includes(id)) {
        continue;
      }
      if (readyFor(id, usable, settled) === false) {
        continue;
      }
      layers = appendItem(layers, { id, layer: deepestParentOf(id, usable, layers) });
      placedThisRound += 1;
    }
    if (placedThisRound === 0) {
      continue;
    }
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
