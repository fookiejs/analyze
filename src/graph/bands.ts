import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "../errors.ts";
import { dataPlane, flowPlane, layerFor } from "./layout.ts";
import type { GraphEdge, GraphNode, LayerOf } from "./layout.ts";

export const dataBand = -1;
export const spineBand = 0;
export const undoBand = 1;

export const bandGap = 120;

export type BandOf = {
  id: string;
  band: number;
};

function undoTargets(edges: readonly GraphEdge[]): readonly string[] {
  let found: readonly string[] = [];
  for (const edge of edges) {
    if (edge.kind !== "compensates") {
      continue;
    }
    if (found.includes(edge.to)) {
      continue;
    }
    found = appendItem(found, edge.to);
  }
  return found;
}

function flowTouched(edges: readonly GraphEdge[]): readonly string[] {
  let found: readonly string[] = [];
  for (const edge of edges) {
    if (edge.plane !== flowPlane) {
      continue;
    }
    for (const end of [edge.from, edge.to]) {
      if (found.includes(end) === false) {
        found = appendItem(found, end);
      }
    }
  }
  return found;
}

export function bandAssignment(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly BandOf[] {
  const undone = undoTargets(edges);
  const touched = flowTouched(edges);
  let bands: readonly BandOf[] = [];
  for (const node of nodes) {
    if (undone.includes(node.id)) {
      bands = appendItem(bands, { id: node.id, band: undoBand });
      continue;
    }
    if (touched.includes(node.id)) {
      bands = appendItem(bands, { id: node.id, band: spineBand });
      continue;
    }
    bands = appendItem(bands, { id: node.id, band: dataBand });
  }
  return bands;
}

export function bandFor(bands: readonly BandOf[], id: string): number {
  if (Array.isArray(bands) === false) {
    throw AnalyzeError.create("band assignment required");
  }
  for (const entry of bands) {
    if (entry.id === id) {
      return entry.band;
    }
  }
  return spineBand;
}

function referrersOf(edges: readonly GraphEdge[], id: string): readonly string[] {
  let found: readonly string[] = [];
  for (const edge of edges) {
    if (edge.plane !== dataPlane) {
      continue;
    }
    if (edge.to !== id && edge.from !== id) {
      continue;
    }
    const other = edge.to === id ? edge.from : edge.to;
    if (found.includes(other) === false) {
      found = appendItem(found, other);
    }
  }
  return found;
}

function undoneBy(edges: readonly GraphEdge[], id: string): readonly string[] {
  let found: readonly string[] = [];
  for (const edge of edges) {
    if (edge.kind !== "compensates") {
      continue;
    }
    if (edge.to !== id) {
      continue;
    }
    found = appendItem(found, edge.from);
  }
  return found;
}

export function columnAssignment(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  layers: readonly LayerOf[],
  bands: readonly BandOf[],
): readonly LayerOf[] {
  let columns: readonly LayerOf[] = [];
  for (const node of nodes) {
    if (bandFor(bands, node.id) === undoBand) {
      let under = layerFor(layers, node.id);
      for (const forward of undoneBy(edges, node.id)) {
        under = layerFor(layers, forward);
      }
      columns = appendItem(columns, { id: node.id, layer: under });
      continue;
    }
    if (bandFor(bands, node.id) !== dataBand) {
      columns = appendItem(columns, { id: node.id, layer: layerFor(layers, node.id) });
      continue;
    }
    let nearest = -1;
    for (const referrer of referrersOf(edges, node.id)) {
      if (bandFor(bands, referrer) === dataBand) {
        continue;
      }
      const column = layerFor(layers, referrer);
      if (nearest < 0 || column < nearest) {
        nearest = column;
      }
    }
    columns = appendItem(columns, { id: node.id, layer: nearest < 0 ? 0 : nearest });
  }
  return columns;
}

function relationDegree(edges: readonly GraphEdge[], id: string): number {
  let total = 0;
  for (const edge of edges) {
    if (edge.plane !== dataPlane) {
      continue;
    }
    if (edge.from === id || edge.to === id) {
      total += 1;
    }
  }
  return total;
}

export function shelfOrder(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  bands: readonly BandOf[],
): readonly GraphNode[] {
  let shelved: readonly GraphNode[] = [];
  for (const node of nodes) {
    if (bandFor(bands, node.id) !== dataBand) {
      continue;
    }
    shelved = appendItem(shelved, node);
  }
  return shelved.toSorted((left, right) => shelfRank(edges, left, right));
}

function shelfRank(edges: readonly GraphEdge[], left: GraphNode, right: GraphNode): number {
  if (left.id.length < 1 || right.id.length < 1) {
    throw AnalyzeError.create("graph node id required to order the shelf");
  }
  const busier = relationDegree(edges, right.id) - relationDegree(edges, left.id);
  if (busier !== 0) {
    return busier;
  }
  return left.label.localeCompare(right.label);
}
