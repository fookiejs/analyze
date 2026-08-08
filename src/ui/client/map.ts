import { byId, clear, emptyState, state, svgEl } from "./core.ts";
import { cardFor, externalNodeIdOf } from "./card.ts";
import { renderInspector } from "./inspector.ts";
import type { GraphEdge, GraphResponse, ModelSummary, PlacedNode } from "./wire.ts";
import { lookup } from "./slot.ts";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.6;
export const CARD_HEADER = 58;
export const PORT_ROW = 34;
export const SECTION_HEAD = 24;
export const FIELD_ROW = 24;

const activeSurface: { svg: readonly SVGSVGElement[] } = { svg: [] };

function surfaceSvg(): readonly SVGSVGElement[] {
  return activeSurface.svg;
}

function surfaceViewport(): readonly SVGGElement[] {
  for (const svg of surfaceSvg()) {
    const group = svg.querySelector("g.viewport");
    if (group instanceof SVGGElement) {
      return [group];
    }
  }
  return [];
}

function applyCamera(): void {
  for (const group of surfaceViewport()) {
    const cam = state.camera;
    group.setAttribute("transform", "translate(" + cam.x + "," + cam.y + ") scale(" + cam.k + ")");
    const readout = byId("zoom-readout");
    if (readout) {
      readout.textContent = Math.round(cam.k * 100) + "%";
    }
    return;
  }
}

export function zoomAt(clientX: number, clientY: number, factor: number): void {
  for (const svg of surfaceSvg()) {
    const box = svg.getBoundingClientRect();
    const px = clientX - box.left;
    const py = clientY - box.top;
    const cam = state.camera;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.k * factor));
    if (next === cam.k) {
      return;
    }
    cam.x = px - ((px - cam.x) / cam.k) * next;
    cam.y = py - ((py - cam.y) / cam.k) * next;
    cam.k = next;
    applyCamera();
    return;
  }
}

export function zoomCenter(factor: number): void {
  for (const svg of surfaceSvg()) {
    const box = svg.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) {
      continue;
    }
    zoomAt(box.left + box.width / 2, box.top + box.height / 2, factor);
    return;
  }
}

export function fitMap(): void {
  for (const svg of surfaceSvg()) {
    if (drawnGraph().nodes.length === 0) {
      return;
    }
    const box = svg.getBoundingClientRect();
    if (box.width < 80 || box.height < 80) {
      return;
    }
    const pad = 64;
    const w = drawnGraph().width || 1;
    const h = drawnGraph().height || 1;
    const scale = Math.min((box.width - pad * 2) / w, (box.height - pad * 2) / h, MAX_ZOOM);
    const k = Math.max(MIN_ZOOM, scale);
    state.camera.k = k;
    state.camera.x = (box.width - w * k) / 2;
    state.camera.y = (box.height - h * k) / 2;
    state.camera.ready = true;
    applyCamera();
    return;
  }
}

export function nodesById(): Map<string, PlacedNode> {
  const index = new Map<string, PlacedNode>();
  for (const node of drawnGraph().nodes) {
    index.set(node.id, node);
  }
  return index;
}

function portIndex(node: PlacedNode, portId: string): number {
  let at = 0;
  for (const port of node.ports) {
    if (port.id === portId) {
      return at;
    }
    at = at + 1;
  }
  return -1;
}

function anchorY(node: PlacedNode, portId: string): number {
  const at = portIndex(node, portId);
  if (at >= 0) {
    return node.y + CARD_HEADER + at * PORT_ROW + PORT_ROW / 2;
  }
  let fieldAt = 0;
  for (const field of node.fields) {
    if (field.key === portId) {
      let top = node.y + CARD_HEADER + node.ports.length * PORT_ROW;
      if (node.ports.length > 0) {
        top = top + SECTION_HEAD;
      }
      return top + fieldAt * FIELD_ROW + FIELD_ROW / 2;
    }
    fieldAt = fieldAt + 1;
  }
  return node.y + node.height / 2;
}

function edgeAnchors(
  from: PlacedNode,
  fromPort: string,
  to: PlacedNode,
  toPort: string,
): { x1: number; y1: number; x2: number; y2: number } {
  const y1 = anchorY(from, fromPort);
  const y2 = anchorY(to, toPort);
  const fromMid = from.x + from.width / 2;
  const toMid = to.x + to.width / 2;
  if (toMid >= fromMid) {
    return { x1: from.x + from.width, y1: y1, x2: to.x, y2: y2 };
  }
  return { x1: from.x, y1: y1, x2: to.x + to.width, y2: y2 };
}

function edgePath(from: PlacedNode, fromPort: string, to: PlacedNode, toPort: string): string {
  const ends = edgeAnchors(from, fromPort, to, toPort);
  const x1 = ends.x1;
  const y1 = ends.y1;
  const x2 = ends.x2;
  const y2 = ends.y2;
  if (x2 >= x1) {
    const reach = Math.max(40, (x2 - x1) * 0.55);
    return (
      "M " +
      x1 +
      " " +
      y1 +
      " C " +
      (x1 + reach) +
      " " +
      y1 +
      ", " +
      (x2 - reach) +
      " " +
      y2 +
      ", " +
      x2 +
      " " +
      y2
    );
  }
  const back = Math.max(70, (x1 - x2) / 2);
  const lift = y1 <= y2 ? -Math.max(50, back / 2) : Math.max(50, back / 2);
  return (
    "M " +
    x1 +
    " " +
    y1 +
    " C " +
    (x1 + back) +
    " " +
    (y1 + lift) +
    ", " +
    (x2 - back) +
    " " +
    (y2 + lift) +
    ", " +
    x2 +
    " " +
    y2
  );
}

export const flowPlane = "flow";
export const dataPlane = "data";

const drawnPlane = { name: flowPlane };

function drawnGraph(): GraphResponse {
  return drawnPlane.name === dataPlane ? state.relations : state.graph;
}

function visibleEdges(): readonly GraphEdge[] {
  const shown: GraphEdge[] = [];
  for (const edge of drawnGraph().edges) {
    if (drawnPlane.name === flowPlane) {
      if (edge.plane !== flowPlane && edge.kind !== "relation") {
        continue;
      }
    } else if (edge.plane !== drawnPlane.name) {
      continue;
    }
    shown.push(edge);
  }
  return shown;
}

function edgeWalkedByRun(edge: GraphEdge): boolean {
  if (!state.selectedRun) {
    return true;
  }
  for (const step of state.runTrail.steps) {
    if (edge.to === externalNodeIdOf(step.name)) {
      return true;
    }
  }
  return false;
}

export function portKey(nodeId: string, portId: string): string {
  return nodeId + "#" + portId;
}

function edgeKey(edge: GraphEdge): string {
  return edge.from + ">" + edge.fromPort + ">" + edge.to + ">" + edge.toPort;
}

export type Trail = { ports: Record<string, boolean>; edges: Record<string, boolean> };

function downstreamOf(nodeId: string, portId: string): Trail {
  const ports: Record<string, boolean> = {};
  const edges: Record<string, boolean> = {};
  const root = portKey(nodeId, portId);
  let frontier: string[] = [root];
  ports[root] = true;
  let guard = 0;
  while (frontier.length > 0 && guard < 64) {
    guard = guard + 1;
    const next: string[] = [];
    for (const edge of visibleEdges()) {
      if (frontier.indexOf(portKey(edge.from, edge.fromPort)) < 0) {
        continue;
      }
      edges[edgeKey(edge)] = true;
      const target = portKey(edge.to, edge.toPort);
      if (ports[target]) {
        continue;
      }
      ports[target] = true;
      next.push(target);
    }
    frontier = next;
  }
  return { ports: ports, edges: edges };
}

function relationTrail(nodeId: string): Trail {
  const ports: Record<string, boolean> = {};
  const edges: Record<string, boolean> = {};
  ports[portKey(nodeId, "")] = true;
  for (const edge of drawnGraph().edges) {
    if (edge.from !== nodeId && edge.to !== nodeId) {
      continue;
    }
    edges[edgeKey(edge)] = true;
    ports[portKey(edge.from, edge.fromPort)] = true;
    ports[portKey(edge.to, "")] = true;
    ports[portKey(edge.from, "")] = true;
  }
  return { ports: ports, edges: edges };
}

function highlight(): readonly Trail[] {
  if (!state.selectedPort) {
    return [];
  }
  const parts = state.selectedPort.split("#");
  const nodeId = parts[0] ?? "";
  if (drawnPlane.name === dataPlane) {
    return [relationTrail(nodeId)];
  }
  return [downstreamOf(nodeId, parts.length > 1 ? (parts[1] ?? "") : "")];
}

function edgeIsLit(trail: readonly Trail[], edge: GraphEdge): boolean {
  for (const lit of trail) {
    return lit.edges[edgeKey(edge)] === true;
  }
  return false;
}

export function nodeIsLit(trail: readonly Trail[], node: PlacedNode): boolean {
  for (const lit of trail) {
    if (lit.ports[portKey(node.id, "")] === true) {
      return true;
    }
    for (const port of node.ports) {
      if (lit.ports[portKey(node.id, port.id)] === true) {
        return true;
      }
    }
    for (const field of node.fields) {
      if (lit.ports[portKey(node.id, field.key)] === true) {
        return true;
      }
    }
  }
  return false;
}

function markerDefs(defs: SVGDefsElement, plane: string): void {
  for (const kind of ["relation", "invokes", "compensates", "nests"]) {
    const marker = svgEl("marker", {
      id: "arrow-" + kind + "-" + plane,
      viewBox: "0 0 10 10",
      refX: "8",
      refY: "5",
      markerWidth: "5",
      markerHeight: "5",
      orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M 0 1 L 9 5 L 0 9 z", class: "arrow " + kind }));
    defs.appendChild(marker);
  }
}

export function drawMap(): void {
  drawnPlane.name = flowPlane;
  clear(byId("models-body"));
  drawGraph(byId("map-canvas"), "No models registered");
}

export function drawRelations(): void {
  drawnPlane.name = dataPlane;
  clear(byId("map-canvas"));
  drawGraph(byId("models-body"), "No relations declared");
}

function wireEdgeRaise(bundle: SVGGElement, edgesLayer: SVGGElement, viewport: SVGGElement): void {
  bundle.addEventListener("pointerenter", () => {
    bundle.classList.add("raised");
    viewport.appendChild(bundle);
  });
  bundle.addEventListener("pointerleave", () => {
    bundle.classList.remove("raised");
    edgesLayer.appendChild(bundle);
  });
  bundle.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

function edgeBundle(
  edge: GraphEdge,
  from: PlacedNode,
  to: PlacedNode,
  trail: readonly Trail[],
  edgesLayer: SVGGElement,
  viewport: SVGGElement,
): SVGGElement {
  let cls = "edge " + edge.kind;
  if (trail.length > 0) {
    cls = cls + (edgeIsLit(trail, edge) ? " lit" : " faded");
  }
  if (state.selectedRun && edgeWalkedByRun(edge) === false) {
    cls = cls + " faded";
  }
  const path = edgePath(from, edge.fromPort, to, edge.toPort);
  const bundle = svgEl("g", { class: "edge-hit" });
  bundle.appendChild(
    svgEl("path", {
      class: "edge-hitbox",
      d: path,
    }),
  );
  bundle.appendChild(
    svgEl("path", {
      class: cls,
      "stroke-width": String(Math.min(1.2 + Math.log(edge.weight + 1) * 0.5, 3)),
      "marker-end": "url(#arrow-" + edge.kind + "-" + drawnPlane.name + ")",
      d: path,
    }),
  );
  if (edge.label) {
    const x = (from.x + from.width + to.x) / 2;
    const y = (anchorY(from, edge.fromPort) + anchorY(to, edge.toPort)) / 2 - 7;
    let labelCls = "edge-label";
    if (trail.length > 0) {
      labelCls = labelCls + (edgeIsLit(trail, edge) ? " lit" : " faded");
    }
    bundle.appendChild(svgEl("text", { class: labelCls, x: x, y: y }, edge.label));
  }
  wireEdgeRaise(bundle, edgesLayer, viewport);
  return bundle;
}

function drawGraph(host: HTMLElement, emptyTitle: string): void {
  if (!host) {
    return;
  }
  clear(host);
  if (drawnGraph().nodes.length === 0) {
    emptyState(host, emptyTitle, "Boot an app with at least one model and it appears here.");
    return;
  }

  const plane = drawnPlane.name;
  const svg = svgEl("svg", {
    class: "map-surface",
    "data-plane": plane,
    width: "100%",
    height: "100%",
    preserveAspectRatio: "xMidYMid meet",
  });
  const defs = svgEl("defs", {});
  const dotsId = "dots-" + plane;
  const dots = svgEl("pattern", {
    id: dotsId,
    width: "24",
    height: "24",
    patternUnits: "userSpaceOnUse",
  });
  dots.appendChild(svgEl("circle", { cx: "1", cy: "1", r: "1", class: "map-dots" }));
  defs.appendChild(dots);
  markerDefs(defs, plane);
  svg.appendChild(defs);
  svg.appendChild(
    svgEl("rect", { x: "0", y: "0", width: "100%", height: "100%", fill: "url(#" + dotsId + ")" }),
  );

  const group = svgEl("g", { class: "viewport" });
  const edgesLayer = svgEl("g", { class: "edges" });
  const nodesLayer = svgEl("g", { class: "nodes" });
  const index = nodesById();
  const trail = highlight();

  for (const edge of visibleEdges()) {
    for (const from of lookup(index, edge.from)) {
      for (const to of lookup(index, edge.to)) {
        edgesLayer.appendChild(edgeBundle(edge, from, to, trail, edgesLayer, group));
      }
    }
  }

  for (const node of drawnGraph().nodes) {
    nodesLayer.appendChild(cardFor(node, trail));
  }

  group.appendChild(edgesLayer);
  group.appendChild(nodesLayer);
  svg.appendChild(group);
  svg.addEventListener("click", () => selectPort(""));
  host.appendChild(svg);
  activeSurface.svg = [svg];
  wireCamera(svg);
  let settleTries = 0;
  const settleCamera = (): void => {
    if (state.camera.ready) {
      applyCamera();
      return;
    }
    fitMap();
    settleTries = settleTries + 1;
    if (state.camera.ready || settleTries > 30) {
      applyCamera();
      return;
    }
    requestAnimationFrame(settleCamera);
  };
  requestAnimationFrame(settleCamera);
}

function wireCamera(svg: SVGSVGElement): void {
  const drag = { on: false, x: 0, y: 0 };
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
    },
    { passive: false },
  );
  svg.addEventListener("auxclick", (event) => {
    if (event.button === 1) {
      event.preventDefault();
    }
  });
  svg.addEventListener("contextmenu", (event) => event.preventDefault());
  svg.addEventListener("pointerdown", (event) => {
    const panning =
      event.button === 1 || event.button === 2 || (event.button === 0 && event.altKey);
    if (panning === false) {
      return;
    }
    event.preventDefault();
    drag.on = true;
    drag.x = event.clientX - state.camera.x;
    drag.y = event.clientY - state.camera.y;
    svg.classList.add("dragging");
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag.on) {
      return;
    }
    state.camera.x = event.clientX - drag.x;
    state.camera.y = event.clientY - drag.y;
    applyCamera();
  });
  const stop = (event: PointerEvent): void => {
    drag.on = false;
    svg.classList.remove("dragging");
    if (svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
}

export function modelNamed(name: string): readonly ModelSummary[] {
  for (const model of state.catalog) {
    if (model.name === name) {
      return [model];
    }
  }
  return [];
}

export function selectPort(key: string): void {
  state.selectedPort = key === state.selectedPort ? "" : key;
  state.selectedNode = state.selectedPort ? (state.selectedPort.split("#")[0] ?? "") : "";
  if (state.view === "models") {
    drawRelations();
  } else {
    drawMap();
  }
  renderInspector();
}

export function runCountFor(model: string): number {
  let total = 0;
  for (const run of state.runs) {
    if (run.model === model) {
      total = total + 1;
    }
  }
  return total;
}
