import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "../errors.ts";

export type GraphPort = {
  id: string;
  label: string;
  detail: string;
  active: boolean;
};

export type GraphField = {
  key: string;
  detail: string;
  relation: readonly string[];
};

export type GraphNode = {
  id: string;
  label: string;
  kind: string;
  subtitle: string;
  ports: readonly GraphPort[];
  fields: readonly GraphField[];
};

export type GraphEdge = {
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  kind: string;
  label: string;
  weight: number;
  step: number;
  plane: string;
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

export const nodeWidth = 300;
export const cardHeaderHeight = 58;
export const portRowHeight = 34;
export const sectionHeaderHeight = 24;
export const fieldRowHeight = 24;
export const cardFooterHeight = 12;
export const plainNodeHeight = 58;
export const columnGap = 190;
export const rowGap = 34;

export const flowPlane = "flow";
export const dataPlane = "data";

export function heightOf(node: GraphNode): number {
  if (Array.isArray(node.ports) === false) {
    throw AnalyzeError.create("graph node ports required");
  }
  if (node.ports.length < 1) {
    return plainNodeHeight;
  }
  let height = cardHeaderHeight + node.ports.length * portRowHeight + cardFooterHeight;
  if (node.fields.length > 0) {
    height = height + sectionHeaderHeight + node.fields.length * fieldRowHeight;
  }
  if (height < cardHeaderHeight) {
    throw AnalyzeError.create("a card is at least its header tall");
  }
  return height;
}

export function portIndexOf(node: GraphNode, portId: string): number {
  let index = 0;
  for (const port of node.ports) {
    if (port.id === portId) {
      return index;
    }
    index = index + 1;
  }
  return -1;
}

export function portAnchorY(node: PlacedNode, portId: string): number {
  if (z.string().min(1).safeParse(portId).success === false) {
    return node.y + node.height / 2;
  }
  const index = portIndexOf(node, portId);
  if (index < 0) {
    return node.y + node.height / 2;
  }
  const anchor = node.y + cardHeaderHeight + index * portRowHeight + portRowHeight / 2;
  if (anchor < node.y) {
    throw AnalyzeError.create("a port anchor sits inside its card");
  }
  return anchor;
}

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

export const maxStride = 8;

export function strideOf(edge: GraphEdge): number {
  if (Number.isInteger(edge.step) === false) {
    return 1;
  }
  if (edge.step < 1) {
    return 1;
  }
  if (edge.step > maxStride) {
    return maxStride;
  }
  return edge.step;
}

function relaxOnce(layers: readonly LayerOf[], edges: readonly GraphEdge[]): readonly LayerOf[] {
  let next: readonly LayerOf[] = [];
  for (const entry of layers) {
    let deepest = entry.layer;
    for (const edge of edges) {
      if (edge.to !== entry.id) {
        continue;
      }
      const candidate = layerFor(layers, edge.from) + strideOf(edge);
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

function rankingEdges(edges: readonly GraphEdge[]): readonly GraphEdge[] {
  let flowing: readonly GraphEdge[] = [];
  for (const edge of edges) {
    if (edge.plane !== flowPlane) {
      continue;
    }
    flowing = appendItem(flowing, edge);
  }
  if (flowing.length < 1) {
    return edges;
  }
  return flowing;
}

export function layerAssignment(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): readonly LayerOf[] {
  const ids = idsOf(nodes);
  const forward = acyclicEdges(ids, rankingEdges(keptEdges(edges, ids)));
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

function earliestStep(edges: readonly GraphEdge[], id: string): number {
  let earliest = 0;
  for (const edge of edges) {
    if (edge.to !== id) {
      continue;
    }
    if (edge.step < 1) {
      continue;
    }
    if (earliest === 0 || edge.step < earliest) {
      earliest = edge.step;
    }
  }
  return earliest === 0 ? 999 : earliest;
}

function orderKeyOf(edges: readonly GraphEdge[], node: GraphNode): string {
  if (z.string().min(1).safeParse(node.id).success === false) {
    throw AnalyzeError.create("graph node id required");
  }
  const step = String(earliestStep(edges, node.id)).padStart(4, "0");
  const incoming = incomingCount(edges, node.id);
  const padded = String(1000 - incoming).padStart(4, "0");
  if (padded.length < 4) {
    throw AnalyzeError.create("order key must sort lexically");
  }
  return `${step}:${padded}:${node.label}`;
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
    let cursor = 0;
    for (const seat of columnOf(nodes, layers, column, usable)) {
      const height = heightOf(seat);
      placed = appendItem(placed, {
        id: seat.id,
        label: seat.label,
        kind: seat.kind,
        subtitle: seat.subtitle,
        ports: seat.ports,
        fields: seat.fields,
        layer: column,
        x: column * (nodeWidth + columnGap),
        y: cursor,
        width: nodeWidth,
        height,
      });
      cursor = cursor + height + rowGap;
    }
    const used = cursor > 0 ? cursor - rowGap : 0;
    if (used > tallest) {
      tallest = used;
    }
  }

  const centred = centreColumns(placed, tallest);
  return {
    nodes: centred,
    edges: usable,
    width: (deepest + 1) * nodeWidth + deepest * columnGap,
    height: Math.max(tallest, 1),
  };
}

function columnHeight(nodes: readonly PlacedNode[], column: number): number {
  let lowest = 0;
  for (const placed of nodes) {
    if (placed.layer !== column) {
      continue;
    }
    if (placed.y + placed.height > lowest) {
      lowest = placed.y + placed.height;
    }
  }
  return lowest;
}

function centreColumns(nodes: readonly PlacedNode[], tallest: number): readonly PlacedNode[] {
  let centred: readonly PlacedNode[] = [];
  for (const node of nodes) {
    const used = columnHeight(nodes, node.layer);
    const shift = Math.max((tallest - used) / 2, 0);
    centred = appendItem(centred, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      subtitle: node.subtitle,
      ports: node.ports,
      fields: node.fields,
      layer: node.layer,
      x: node.x,
      y: node.y + shift,
      width: node.width,
      height: node.height,
    });
  }
  return centred;
}
