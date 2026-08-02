export function clientMapJs(): string {
  return `
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.6;

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
  const pad = 56;
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

function edgePath(from, to) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  if (x2 >= x1) {
    const mid = (x1 + x2) / 2;
    return "M " + x1 + " " + y1 + " C " + mid + " " + y1 + ", " + mid + " " + y2 + ", " + x2 + " " + y2;
  }
  const back = Math.max(60, (x1 - x2) / 2);
  const lift = y1 <= y2 ? -Math.max(46, back / 2) : Math.max(46, back / 2);
  return "M " + x1 + " " + y1 +
    " C " + (x1 + back) + " " + (y1 + lift) + ", " + (x2 - back) + " " + (y2 + lift) + ", " + x2 + " " + y2;
}

function nodesById() {
  const index = {};
  for (const node of state.graph.nodes) { index[node.id] = node; }
  return index;
}

function touchesSelection(edge) {
  if (!state.selectedNode) { return false; }
  return edge.from === state.selectedNode || edge.to === state.selectedNode;
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
  const dots = svgEl("pattern", { id: "dots", width: "22", height: "22", patternUnits: "userSpaceOnUse" });
  dots.appendChild(svgEl("circle", { cx: "1", cy: "1", r: "1", class: "map-dots" }));
  defs.appendChild(dots);
  for (const kind of ["relation", "invokes", "compensates", "nests"]) {
    const marker = svgEl("marker", {
      id: "arrow-" + kind, viewBox: "0 0 10 10", refX: "9", refY: "5",
      markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse",
    });
    marker.appendChild(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "edge " + kind, "stroke-width": "0", fill: "currentColor" }));
    defs.appendChild(marker);
  }
  svg.appendChild(defs);
  svg.appendChild(svgEl("rect", { x: "0", y: "0", width: "100%", height: "100%", fill: "url(#dots)" }));

  const group = svgEl("g", { id: "viewport" });
  const index = nodesById();

  for (const edge of state.graph.edges) {
    const from = index[edge.from];
    const to = index[edge.to];
    if (!from || !to) { continue; }
    let cls = "edge " + edge.kind;
    if (state.selectedNode) { cls = cls + (touchesSelection(edge) ? " lit" : " faded"); }
    group.appendChild(svgEl("path", {
      class: cls,
      "stroke-width": String(Math.min(1.1 + Math.log(edge.weight + 1) * 0.6, 3.4)),
      "marker-end": "url(#arrow-" + edge.kind + ")",
      d: edgePath(from, to),
    }));
  }

  for (const node of state.graph.nodes) {
    const selected = node.id === state.selectedNode ? " selected" : "";
    const wrap = svgEl("g", { class: "node " + node.kind + selected, tabindex: "0" });
    wrap.appendChild(svgEl("rect", { class: "body", x: node.x, y: node.y, width: node.width, height: node.height, rx: "10" }));
    wrap.appendChild(svgEl("rect", { class: "stripe", x: node.x, y: node.y + 12, width: "3", height: node.height - 24, rx: "2" }));
    wrap.appendChild(svgEl("text", { class: "label", x: node.x + 16, y: node.y + 27 }, node.label));
    wrap.appendChild(svgEl("text", { class: "sub", x: node.x + 16, y: node.y + 45 }, subtitleFor(node)));
    wrap.addEventListener("click", (event) => {
      event.stopPropagation();
      selectNode(node.id);
    });
    group.appendChild(wrap);
  }

  svg.appendChild(group);
  svg.addEventListener("click", () => selectNode(""));
  host.appendChild(svg);
  wireCamera(svg);
  if (!state.camera.ready) { fitMap(); } else { applyCamera(); }
}

function subtitleFor(node) {
  if (node.kind === "model") {
    const model = modelNamed(node.label);
    if (model) { return model.fields.length + " fields"; }
    return "model";
  }
  const external = externalNamed(node.label);
  if (external) { return external.attempts + " attempts, " + external.backoff; }
  return "external";
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

function selectNode(id) {
  state.selectedNode = id;
  drawMap();
  renderInspector();
}

function neighboursOf(id) {
  const out = [];
  const back = [];
  for (const edge of state.graph.edges) {
    if (edge.from === id) { out.push(edge); }
    if (edge.to === id) { back.push(edge); }
  }
  return { out: out, back: back };
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
  grow.appendChild(el("div", { class: "card-desc" }, node.kind === "model" ? "model" : "external"));
  head.appendChild(grow);
  const close = el("button", { class: "btn icon ghost", title: "Close" }, "\\u00d7");
  close.addEventListener("click", () => selectNode(""));
  head.appendChild(close);
  panel.appendChild(head);

  if (node.kind === "model") { inspectModel(panel, node.label); } else { inspectExternal(panel, node.label); }

  const links = neighboursOf(node.id);
  panel.appendChild(el("h3", {}, "Connections"));
  if (links.out.length === 0 && links.back.length === 0) {
    panel.appendChild(el("div", { class: "dim" }, "Nothing points at this node yet."));
    return;
  }
  const chips = el("div", { class: "chips" });
  for (const edge of links.out) { chips.appendChild(badge(edge.kind + " \\u2192 " + labelOf(edge.to), edgeTone(edge.kind))); }
  for (const edge of links.back) { chips.appendChild(badge(labelOf(edge.from) + " \\u2192 " + edge.kind, edgeTone(edge.kind))); }
  panel.appendChild(chips);
}

function edgeTone(kind) {
  if (kind === "relation") { return "violet"; }
  if (kind === "invokes") { return "info"; }
  if (kind === "compensates") { return "warn"; }
  return "ok";
}

function labelOf(id) {
  const node = nodesById()[id];
  return node ? node.label : id;
}

function inspectModel(panel, name) {
  const model = modelNamed(name);
  if (!model) { return; }
  panel.appendChild(el("h3", {}, "Table"));
  const kv = el("div", { class: "kv" });
  kv.appendChild(el("div", { class: "k" }, "table"));
  kv.appendChild(el("div", { class: "mono" }, model.table));
  kv.appendChild(el("div", { class: "k" }, "fields"));
  kv.appendChild(el("div", {}, String(model.fields.length)));
  kv.appendChild(el("div", { class: "k" }, "runs seen"));
  kv.appendChild(el("div", {}, String(runCountFor(name))));
  panel.appendChild(kv);

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
    if (field.system) { flags.appendChild(badge("system", "")); }
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
  kv.appendChild(el("div", { class: "k" }, "compensates"));
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
