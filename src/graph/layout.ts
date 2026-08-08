import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import { AnalyzeError } from "../errors.ts";
import dagre from "@dagrejs/dagre";

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
  if (Array.isArray(node.fields) === false) {
    throw AnalyzeError.create("graph node fields required");
  }
  if (node.ports.length < 1 && node.fields.length < 1) {
    return plainNodeHeight;
  }
  let height = cardHeaderHeight + cardFooterHeight;
  if (node.ports.length > 0) {
    height = height + node.ports.length * portRowHeight;
  }
  if (node.fields.length > 0) {
    if (node.ports.length > 0) {
      height = height + sectionHeaderHeight;
    }
    height = height + node.fields.length * fieldRowHeight;
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
  if (index >= 0) {
    const anchor = node.y + cardHeaderHeight + index * portRowHeight + portRowHeight / 2;
    if (anchor < node.y) {
      throw AnalyzeError.create("a port anchor sits inside its card");
    }
    return anchor;
  }
  let fieldAt = 0;
  for (const field of node.fields) {
    if (field.key === portId) {
      let top = node.y + cardHeaderHeight + node.ports.length * portRowHeight;
      if (node.ports.length > 0) {
        top = top + sectionHeaderHeight;
      }
      return top + fieldAt * fieldRowHeight + fieldRowHeight / 2;
    }
    fieldAt = fieldAt + 1;
  }
  return node.y + node.height / 2;
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

function rankingEdges(edges: readonly GraphEdge[], plane: string): readonly GraphEdge[] {
  let flowing: readonly GraphEdge[] = [];
  for (const edge of edges) {
    if (edge.plane !== plane) {
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
  plane: string = flowPlane,
): readonly LayerOf[] {
  const ids = idsOf(nodes);
  const forward = acyclicEdges(ids, rankingEdges(keptEdges(edges, ids), plane));
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









export function layoutOf(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  plane: string = flowPlane,
): Layout {
  if (nodes.length < 1) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  let kept: readonly GraphNode[] = nodes;
  if (plane === dataPlane) {
    let models: readonly GraphNode[] = [];
    for (const node of nodes) {
      if (node.kind === "model") {
        models = appendItem(models, node);
      }
    }
    kept = models;
  }
  if (kept.length < 1) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }
  const ids = idsOf(kept);
  const usable = keptEdges(edges, ids);

  const linkedIds = new Set<string>();
  for (const edge of usable) {
    if (edge.plane !== plane || edge.from === edge.to) {
      continue;
    }
    linkedIds.add(edge.from);
    linkedIds.add(edge.to);
  }
  let linked: readonly GraphNode[] = [];
  let loose: readonly GraphNode[] = [];
  for (const node of kept) {
    if (linkedIds.has(node.id)) {
      linked = appendItem(linked, node);
    } else {
      loose = appendItem(loose, node);
    }
  }

  if (plane === flowPlane && flowSpineHasModel(linked) === false) {
    return layoutFlowFromRelations(kept, usable);
  }

  const engine = new dagre.graphlib.Graph();
  engine.setGraph({
    rankdir: plane === dataPlane ? "TB" : "LR",
    nodesep: plane === dataPlane ? 48 : 64,
    ranksep: plane === dataPlane ? 120 : 160,
    edgesep: 40,
    marginx: layoutMargin,
    marginy: layoutMargin,
  });
  engine.setDefaultEdgeLabel(() => ({}));
  for (const node of linked) {
    engine.setNode(node.id, { width: nodeWidth, height: heightOf(node) });
  }
  for (const edge of usable) {
    if (edge.plane !== plane || edge.from === edge.to) {
      continue;
    }
    engine.setEdge(edge.from, edge.to);
  }
  dagre.layout(engine);

  let placed: readonly PlacedNode[] = [];
  let widest = 1;
  const ranks = new Map<string, number>();
  const shelf = shelfGrid(loose, Math.max(widest, 1));
  for (const seated of shelf.placed) {
    placed = appendItem(placed, seated);
    if (seated.x + seated.width > widest) {
      widest = seated.x + seated.width;
    }
  }
  let tallest = shelf.height;
  const drop = shelf.height > 0 ? shelf.height + bandGapRows : 0;
  for (const node of linked) {
    const seat = engine.node(node.id);
    const tall = heightOf(node);
    const x = seat.x - nodeWidth / 2;
    const y = seat.y - tall / 2 + drop;
    const rank = plane === dataPlane ? Math.round(seat.y) : Math.round(seat.x);
    if (ranks.has(rank.toString()) === false) {
      ranks.set(rank.toString(), ranks.size);
    }
    placed = appendItem(placed, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      subtitle: node.subtitle,
      ports: node.ports,
      fields: node.fields,
      layer: seatRankOf(ranks, rank.toString()),
      x,
      y,
      width: nodeWidth,
      height: tall,
    });
    if (x + nodeWidth > widest) {
      widest = x + nodeWidth;
    }
    if (y + tall > tallest) {
      tallest = y + tall;
    }
  }
  return {
    nodes: placed,
    edges: usable,
    width: widest + layoutMargin,
    height: Math.max(tallest, 1) + layoutMargin,
  };
}

function flowSpineHasModel(linked: readonly GraphNode[]): boolean {
  for (const node of linked) {
    if (node.kind === "model") {
      return true;
    }
  }
  return false;
}

function layoutFlowFromRelations(kept: readonly GraphNode[], usable: readonly GraphEdge[]): Layout {
  let models: readonly GraphNode[] = [];
  let externals: readonly GraphNode[] = [];
  for (const node of kept) {
    if (node.kind === "model") {
      models = appendItem(models, node);
    } else {
      externals = appendItem(externals, node);
    }
  }
  const engine = new dagre.graphlib.Graph();
  engine.setGraph({
    rankdir: "LR",
    nodesep: 64,
    ranksep: 160,
    edgesep: 40,
    marginx: layoutMargin,
    marginy: layoutMargin,
  });
  engine.setDefaultEdgeLabel(() => ({}));
  for (const node of models) {
    engine.setNode(node.id, { width: nodeWidth, height: heightOf(node) });
  }
  for (const edge of usable) {
    if (edge.plane !== dataPlane || edge.from === edge.to) {
      continue;
    }
    if (engine.hasNode(edge.from) === false || engine.hasNode(edge.to) === false) {
      continue;
    }
    engine.setEdge(edge.from, edge.to);
  }
  if (models.length > 0) {
    dagre.layout(engine);
  }

  let placed: readonly PlacedNode[] = [];
  let widest = 1;
  let tallest = 1;
  const ranks = new Map<string, number>();
  for (const node of models) {
    const seat = engine.node(node.id);
    const tall = heightOf(node);
    const x = seat.x - nodeWidth / 2;
    const y = seat.y - tall / 2;
    const rank = Math.round(seat.x);
    if (ranks.has(rank.toString()) === false) {
      ranks.set(rank.toString(), ranks.size);
    }
    placed = appendItem(placed, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      subtitle: node.subtitle,
      ports: node.ports,
      fields: node.fields,
      layer: seatRankOf(ranks, rank.toString()),
      x,
      y,
      width: nodeWidth,
      height: tall,
    });
    if (x + nodeWidth > widest) {
      widest = x + nodeWidth;
    }
    if (y + tall > tallest) {
      tallest = y + tall;
    }
  }

  const shelf = shelfGrid(externals, Math.max(widest, 1));
  const drop = tallest > 1 ? tallest + bandGapRows : 0;
  for (const seated of shelf.placed) {
    placed = appendItem(placed, {
      id: seated.id,
      label: seated.label,
      kind: seated.kind,
      subtitle: seated.subtitle,
      ports: seated.ports,
      fields: seated.fields,
      layer: seated.layer,
      x: seated.x,
      y: seated.y + drop,
      width: seated.width,
      height: seated.height,
    });
    if (seated.x + seated.width > widest) {
      widest = seated.x + seated.width;
    }
    if (seated.y + drop + seated.height > tallest) {
      tallest = seated.y + drop + seated.height;
    }
  }

  return {
    nodes: placed,
    edges: usable,
    width: widest + layoutMargin,
    height: Math.max(tallest, 1) + layoutMargin,
  };
}

export const shelfGap = 40;
export const bandGapRows = 90;

function shelfGrid(
  loose: readonly GraphNode[],
  minWidth: number,
): { placed: readonly PlacedNode[]; height: number } {
  if (loose.length < 1) {
    return { placed: [], height: 0 };
  }
  const perRow = Math.max(Math.ceil(Math.sqrt(loose.length)), 4);
  let placed: readonly PlacedNode[] = [];
  let rowTop = layoutMargin;
  let rowTall = 0;
  let at = 0;
  for (const node of loose) {
    const column = at % perRow;
    if (column === 0 && at > 0) {
      rowTop = rowTop + rowTall + shelfGap;
      rowTall = 0;
    }
    const tall = heightOf(node);
    placed = appendItem(placed, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      subtitle: node.subtitle,
      ports: node.ports,
      fields: node.fields,
      layer: column,
      x: layoutMargin + column * (nodeWidth + shelfGap),
      y: rowTop,
      width: nodeWidth,
      height: tall,
    });
    if (tall > rowTall) {
      rowTall = tall;
    }
    at = at + 1;
  }
  if (minWidth > 0) {
    return { placed, height: rowTop + rowTall };
  }
  return { placed, height: rowTop + rowTall };
}

export const layoutMargin = 48;

function seatRankOf(ranks: Map<string, number>, key: string): number {
  for (const held of ranks) {
    if (held[0] === key) {
      return held[1];
    }
  }
  return 0;
}


