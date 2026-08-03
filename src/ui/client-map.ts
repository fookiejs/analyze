export function clientMapJs(): string {
  return `
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.6;
const CARD_HEADER = 46;
const PORT_ROW = 26;

function viewport() { return byId("viewport"); }

function applyCamera() {
  const group = viewport();
  if (!group) { return; }
  const cam = state.camera;
  group.setAttribute("transform", "translate(" + cam.x + "," + cam.y + ") scale(" + cam.k + ")");
  const readout = byId("zoom-readout");
  if (readout) { readout.textContent = Math.round(cam.k * 100) + "%"; }
}

function zoomAt(clientX, clientY, factor) {
  const svg = byId("map-svg");
  if (!svg) { return; }
  const box = svg.getBoundingClientRect();
  const px = clientX - box.left;
  const py = clientY - box.top;
  const cam = state.camera;
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.k * factor));
  if (next === cam.k) { return; }
  cam.x = px - ((px - cam.x) / cam.k) * next;
  cam.y = py - ((py - cam.y) / cam.k) * next;
  cam.k = next;
  applyCamera();
}

function fitMap() {
  const svg = byId("map-svg");
  if (!svg || state.graph.nodes.length === 0) { return; }
  const box = svg.getBoundingClientRect();
  if (box.width < 80 || box.height < 80) { return; }
  const pad = 64;
  const w = state.graph.width || 1;
  const h = state.graph.height || 1;
  const scale = Math.min((box.width - pad * 2) / w, (box.height - pad * 2) / h, MAX_ZOOM);
  const k = Math.max(MIN_ZOOM, scale);
  state.camera.k = k;
  state.camera.x = (box.width - w * k) / 2;
  state.camera.y = (box.height - h * k) / 2;
  state.camera.ready = true;
  applyCamera();
}

function nodesById() {
  const index = {};
  for (const node of state.graph.nodes) { index[node.id] = node; }
  return index;
}

function portIndex(node, portId) {
  let at = 0;
  for (const port of node.ports) {
    if (port.id === portId) { return at; }
    at = at + 1;
  }
  return -1;
}

function anchorY(node, portId) {
  const at = portIndex(node, portId);
  if (at < 0) { return node.y + node.height / 2; }
  return node.y + CARD_HEADER + at * PORT_ROW + PORT_ROW / 2;
}

function edgePath(from, fromPort, to, toPort) {
  const x1 = from.x + from.width;
  const y1 = anchorY(from, fromPort);
  const x2 = to.x;
  const y2 = anchorY(to, toPort);
  if (x2 >= x1) {
    const reach = Math.max(40, (x2 - x1) * 0.55);
    return "M " + x1 + " " + y1 + " C " + (x1 + reach) + " " + y1 + ", " + (x2 - reach) + " " + y2 + ", " + x2 + " " + y2;
  }
  const back = Math.max(70, (x1 - x2) / 2);
  const lift = y1 <= y2 ? -Math.max(50, back / 2) : Math.max(50, back / 2);
  return "M " + x1 + " " + y1 +
    " C " + (x1 + back) + " " + (y1 + lift) + ", " + (x2 - back) + " " + (y2 + lift) + ", " + x2 + " " + y2;
}

function visibleEdges() {
  const shown = [];
  for (const edge of state.graph.edges) {
    if (state.plane === "flow" && edge.plane !== "flow") { continue; }
    if (state.plane === "data" && edge.plane !== "data") { continue; }
    shown.push(edge);
  }
  return shown;
}

function portKey(nodeId, portId) { return nodeId + "#" + portId; }

function edgeKey(edge) {
  return edge.from + ">" + edge.fromPort + ">" + edge.to + ">" + edge.toPort;
}

function downstreamOf(nodeId, portId) {
  const ports = {};
  const edges = {};
  let frontier = [portKey(nodeId, portId)];
  ports[frontier[0]] = true;
  let guard = 0;
  while (frontier.length > 0 && guard < 64) {
    guard = guard + 1;
    const next = [];
    for (const edge of visibleEdges()) {
      if (frontier.indexOf(portKey(edge.from, edge.fromPort)) < 0) { continue; }
      edges[edgeKey(edge)] = true;
      const target = portKey(edge.to, edge.toPort);
      if (ports[target]) { continue; }
      ports[target] = true;
      next.push(target);
    }
    frontier = next;
  }
  return { ports: ports, edges: edges };
}

function highlight() {
  if (!state.selectedPort) { return null; }
  const parts = state.selectedPort.split("#");
  return downstreamOf(parts[0], parts.length > 1 ? parts[1] : "");
}

function edgeIsLit(trail, edge) {
  if (!trail) { return false; }
  return trail.edges[edgeKey(edge)] === true;
}

function nodeIsLit(trail, node) {
  if (!trail) { return false; }
  if (trail.ports[portKey(node.id, "")] === true) { return true; }
  for (const port of node.ports) {
    if (trail.ports[portKey(node.id, port.id)] === true) { return true; }
  }
  return false;
}

function markerDefs(defs) {
  for (const kind of ["relation", "invokes", "compensates", "nests"]) {
    const marker = svgEl("marker", {
      id: "arrow-" + kind, viewBox: "0 0 10 10", refX: "8", refY: "5",
      markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M 0 1 L 9 5 L 0 9 z", class: "arrow " + kind }));
    defs.appendChild(marker);
  }
}

function drawMap() {
  const host = byId("map-canvas");
  if (!host) { return; }
  clear(host);
  if (state.graph.nodes.length === 0) {
    emptyState(host, "No models registered", "Boot an app with at least one model and the map appears here.");
    return;
  }

  const svg = svgEl("svg", { id: "map-svg" });
  const defs = svgEl("defs", {});
  const dots = svgEl("pattern", { id: "dots", width: "24", height: "24", patternUnits: "userSpaceOnUse" });
  dots.appendChild(svgEl("circle", { cx: "1", cy: "1", r: "1", class: "map-dots" }));
  defs.appendChild(dots);
  markerDefs(defs);
  svg.appendChild(defs);
  svg.appendChild(svgEl("rect", { x: "0", y: "0", width: "100%", height: "100%", fill: "url(#dots)" }));

  const group = svgEl("g", { id: "viewport" });
  const index = nodesById();
  const trail = highlight();

  for (const edge of visibleEdges()) {
    const from = index[edge.from];
    const to = index[edge.to];
    if (!from || !to) { continue; }
    let cls = "edge " + edge.kind;
    if (trail) { cls = cls + (edgeIsLit(trail, edge) ? " lit" : " faded"); }
    group.appendChild(svgEl("path", {
      class: cls,
      "stroke-width": String(Math.min(1.2 + Math.log(edge.weight + 1) * 0.5, 3)),
      "marker-end": "url(#arrow-" + edge.kind + ")",
      d: edgePath(from, edge.fromPort, to, edge.toPort),
    }));
    if (edge.label) {
      const x = (from.x + from.width + to.x) / 2;
      const y = (anchorY(from, edge.fromPort) + anchorY(to, edge.toPort)) / 2 - 7;
      let labelCls = "edge-label";
      if (trail) { labelCls = labelCls + (edgeIsLit(trail, edge) ? " lit" : " faded"); }
      group.appendChild(svgEl("text", { class: labelCls, x: x, y: y }, edge.label));
    }
  }

  for (const node of state.graph.nodes) { group.appendChild(cardFor(node, trail)); }

  svg.appendChild(group);
  svg.addEventListener("click", () => selectPort(""));
  host.appendChild(svg);
  wireCamera(svg);
  if (!state.camera.ready) { fitMap(); } else { applyCamera(); }
}

function portRow(node, port, at, trail) {
  const y = node.y + CARD_HEADER + at * PORT_ROW;
  const mid = y + PORT_ROW / 2;
  const key = portKey(node.id, port.id);
  const lit = trail && trail.ports[key] === true ? " lit" : "";
  const row = svgEl("g", { class: "port" + (port.active ? " active" : "") + lit });
  row.appendChild(svgEl("rect", { class: "hit", x: node.x + 1, y: y, width: node.width - 2, height: PORT_ROW }));
  row.appendChild(svgEl("text", { class: "port-label", x: node.x + 15, y: mid + 4 }, port.label));
  if (port.detail) {
    row.appendChild(svgEl("text", { class: "port-detail", x: node.x + node.width - 15, y: mid + 4 }, port.detail));
  }
  if (port.active) {
    row.appendChild(svgEl("circle", { class: "port-dot out", cx: node.x + node.width, cy: mid, r: "3.5" }));
  }
  row.appendChild(svgEl("circle", { class: "port-dot in", cx: node.x, cy: mid, r: "3.5" }));
  row.addEventListener("click", (event) => {
    event.stopPropagation();
    selectPort(key);
  });
  return row;
}

function cardFor(node, trail) {
  const dimmed = trail && !nodeIsLit(trail, node) ? " faded" : "";
  const wrap = svgEl("g", { class: "node " + node.kind + dimmed });
  wrap.appendChild(svgEl("rect", { class: "body", x: node.x, y: node.y, width: node.width, height: node.height, rx: "11" }));
  wrap.appendChild(svgEl("path", { class: "cap", d: capPath(node) }));
  wrap.appendChild(svgEl("text", { class: "label", x: node.x + 15, y: node.y + 21 }, node.label));
  wrap.appendChild(svgEl("text", { class: "sub", x: node.x + 15, y: node.y + 36 }, node.subtitle));

  let at = 0;
  for (const port of node.ports) {
    wrap.appendChild(portRow(node, port, at, trail));
    at = at + 1;
  }

  wrap.addEventListener("click", (event) => {
    event.stopPropagation();
    selectPort(portKey(node.id, ""));
  });
  return wrap;
}

function capPath(node) {
  const x = node.x;
  const y = node.y;
  const w = node.width;
  const r = 11;
  return "M " + x + " " + (y + CARD_HEADER) +
    " L " + x + " " + (y + r) +
    " Q " + x + " " + y + " " + (x + r) + " " + y +
    " L " + (x + w - r) + " " + y +
    " Q " + (x + w) + " " + y + " " + (x + w) + " " + (y + r) +
    " L " + (x + w) + " " + (y + CARD_HEADER) + " Z";
}

function wireCamera(svg) {
  const drag = { on: false, x: 0, y: 0 };
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) { return; }
    drag.on = true;
    drag.x = event.clientX - state.camera.x;
    drag.y = event.clientY - state.camera.y;
    svg.classList.add("dragging");
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag.on) { return; }
    state.camera.x = event.clientX - drag.x;
    state.camera.y = event.clientY - drag.y;
    applyCamera();
  });
  const stop = (event) => {
    drag.on = false;
    svg.classList.remove("dragging");
    if (event.pointerId !== undefined && svg.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
  };
  svg.addEventListener("pointerup", stop);
  svg.addEventListener("pointercancel", stop);
}

function modelNamed(name) {
  for (const model of state.catalog) { if (model.name === name) { return model; } }
  return null;
}

function externalNamed(name) {
  for (const external of state.externals) { if (external.name === name) { return external; } }
  return null;
}

function selectPort(key) {
  state.selectedPort = key === state.selectedPort ? "" : key;
  state.selectedNode = state.selectedPort ? state.selectedPort.split("#")[0] : "";
  drawMap();
  renderInspector();
}

function setPlane(plane) {
  state.plane = plane;
  state.selectedPort = "";
  state.selectedNode = "";
  for (const button of document.querySelectorAll("#plane-switch button")) {
    button.setAttribute("aria-selected", String(button.dataset.plane === plane));
  }
  drawMap();
  renderInspector();
}

function renderInspector() {
  const panel = byId("inspector");
  if (!state.selectedNode) { panel.classList.remove("on"); clear(panel); return; }
  clear(panel);
  panel.classList.add("on");

  const node = nodesById()[state.selectedNode];
  if (!node) { panel.classList.remove("on"); return; }

  const head = el("div", { class: "inspector-head" });
  const grow = el("div", { class: "grow" });
  grow.appendChild(el("h2", {}, node.label));
  grow.appendChild(el("div", { class: "card-desc mono" }, node.subtitle));
  head.appendChild(grow);
  const close = el("button", { class: "btn icon ghost", title: "Close" }, "\\u00d7");
  close.addEventListener("click", () => selectPort(""));
  head.appendChild(close);
  panel.appendChild(head);

  const parts = state.selectedPort.split("#");
  const port = parts.length > 1 ? parts[1] : "";
  if (node.kind === "model") { inspectModel(panel, node, port); } else { inspectExternal(panel, node.label); }
}

function inspectModel(panel, node, port) {
  const model = modelNamed(node.label);
  if (!model) { return; }

  panel.appendChild(el("h3", {}, "Flows"));
  for (const flow of node.ports) {
    const row = el("div", { class: "flow-row" + (flow.id === port ? " on" : "") });
    row.appendChild(badge(flow.label, flow.active ? "info" : ""));
    row.appendChild(el("span", { class: flow.active ? "" : "dim" }, flow.detail || "calls nothing"));
    row.addEventListener("click", () => selectPort(node.id + "#" + flow.id));
    panel.appendChild(row);
  }

  panel.appendChild(el("h3", {}, "Fields"));
  const host = el("div", {});
  tableOf(host, ["Field", "Type", ""], model.fields, (field) => {
    const row = el("tr", {});
    cell(row, field.key);
    cell(row, el("span", { class: "mono dim" }, field.pgType));
    const flags = el("div", { class: "chips" });
    if (field.relation.length > 0) { flags.appendChild(badge("\\u2192 " + field.relation[0], "violet")); }
    if (field.unique) { flags.appendChild(badge("unique", "info")); }
    if (field.index && !field.unique) { flags.appendChild(badge("index", "")); }
    cell(row, flags);
    return row;
  });
  panel.appendChild(host);
}

function inspectExternal(panel, name) {
  const external = externalNamed(name);
  if (!external) { return; }
  panel.appendChild(el("h3", {}, "Delivery"));
  const kv = el("div", { class: "kv" });
  kv.appendChild(el("div", { class: "k" }, "attempts"));
  kv.appendChild(el("div", {}, String(external.attempts)));
  kv.appendChild(el("div", { class: "k" }, "backoff"));
  kv.appendChild(el("div", {}, external.backoff));
  kv.appendChild(el("div", { class: "k" }, "timeout"));
  kv.appendChild(el("div", {}, external.timeoutMs + "ms"));
  kv.appendChild(el("div", { class: "k" }, "undone by"));
  kv.appendChild(el("div", {}, external.compensate.length > 0 ? external.compensate[0] : "nothing"));
  panel.appendChild(kv);

  panel.appendChild(el("h3", {}, "Payload"));
  const chips = el("div", { class: "chips" });
  for (const key of external.inputKeys) { chips.appendChild(badge("in " + key, "info")); }
  for (const key of external.outputKeys) { chips.appendChild(badge("out " + key, "ok")); }
  panel.appendChild(chips);

  panel.appendChild(el("h3", {}, "Traffic"));
  const counts = outboxCountsFor(name);
  const traffic = el("div", { class: "chips" });
  const keys = Object.keys(counts);
  if (keys.length === 0) { traffic.appendChild(el("span", { class: "dim" }, "No calls recorded yet.")); }
  for (const key of keys) { traffic.appendChild(badge(key + " " + counts[key], toneForStatus(key))); }
  panel.appendChild(traffic);
}

function runCountFor(model) {
  let total = 0;
  for (const run of state.runs) { if (run.model === model) { total = total + 1; } }
  return total;
}

function outboxCountsFor(name) {
  const counts = {};
  for (const row of state.outbox) {
    if (row.name !== name) { continue; }
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  return counts;
}
`.trim();
}
