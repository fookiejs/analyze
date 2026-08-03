export function clientTraceJs(): string {
  return `
function startsAt(span) { return Date.parse(span.startedAt); }
function endsAt(span) { return Date.parse(span.endedAt); }

function contains(outer, inner) {
  if (outer === inner) { return false; }
  const from = startsAt(outer);
  const to = endsAt(outer);
  const a = startsAt(inner);
  const b = endsAt(inner);
  if (!isFinite(from) || !isFinite(a)) { return false; }
  return from <= a && b <= to;
}

function traceGroups() {
  const order = [];
  const groups = {};
  for (const span of state.obs.spans) {
    if (!groups[span.traceId]) {
      groups[span.traceId] = { traceId: span.traceId, spans: [], root: null };
      order.push(span.traceId);
    }
    groups[span.traceId].spans.push(span);
  }
  const built = [];
  for (const traceId of order) {
    const group = groups[traceId];
    group.root = pickRoot(group.spans);
    built.push(group);
  }
  return built.toReversed();
}

function passesOf(group) {
  const root = group.root;
  const passes = [];
  if (!root) { return passes; }
  for (const span of group.spans) {
    if (isOperationSpan(span) === false) { continue; }
    if (span.model !== root.model) { continue; }
    if (span.entityId !== root.entityId) { continue; }
    if (span.name !== root.name) { continue; }
    passes.push(span);
  }
  return passes.toSorted((left, right) => startsAt(left) - startsAt(right));
}

function operationSpansOf(group) {
  const spans = [];
  for (const span of group.spans) { if (isOperationSpan(span)) { spans.push(span); } }
  return spans;
}

function innermostContainer(span, candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (contains(candidate, span) === false) { continue; }
    if (best === null) { best = candidate; continue; }
    if (endsAt(candidate) - startsAt(candidate) < endsAt(best) - startsAt(best)) { best = candidate; }
  }
  return best;
}

function namedParent(group, span) {
  if (span.parentModel.length === 0) { return null; }
  let best = null;
  for (const candidate of operationSpansOf(group)) {
    if (candidate === span) { continue; }
    if (candidate.model !== span.parentModel[0]) { continue; }
    if (candidate.entityId !== span.parentEntityId[0]) { continue; }
    if (contains(candidate, span) === false) { continue; }
    if (best === null || endsAt(candidate) - startsAt(candidate) < endsAt(best) - startsAt(best)) {
      best = candidate;
    }
  }
  return best;
}

function sortChildren(node) {
  node.children = node.children.toSorted((left, right) => startsAt(left.span) - startsAt(right.span));
  for (const child of node.children) { sortChildren(child); }
}

function buildTree(group) {
  const passes = passesOf(group);
  const operations = operationSpansOf(group);
  const nodes = {};
  for (const span of group.spans) { nodes[span.seq] = { span: span, children: [] }; }

  const loose = [];
  for (const span of group.spans) {
    if (passes.indexOf(span) >= 0) { continue; }
    const parent = namedParent(group, span) || innermostContainer(span, operations);
    if (parent === null || !nodes[parent.seq]) { loose.push(nodes[span.seq]); continue; }
    nodes[parent.seq].children.push(nodes[span.seq]);
  }

  const ordered = [];
  for (const pass of passes) { ordered.push(nodes[pass.seq]); }
  for (const node of ordered) { sortChildren(node); }
  for (const node of loose) { sortChildren(node); }
  return { passes: ordered, loose: loose.toSorted((l, r) => startsAt(l.span) - startsAt(r.span)) };
}

function sourceOf(group) {
  const attributes = group.root && group.root.attributes ? group.root.attributes : {};
  const named = attributes.source;
  if (named === "http") { return { text: "http request", tone: "info" }; }
  if (named === "graphql") { return { text: "graphql", tone: "violet" }; }
  if (named === "dispatcher") { return { text: "outbox dispatcher", tone: "warn" }; }
  if (named === "boot") { return { text: "boot", tone: "" }; }
  if (group.root && group.root.model === "dispatcher") { return { text: "outbox dispatcher", tone: "warn" }; }
  return { text: "direct call", tone: "" };
}

function signalOf(span) {
  const attributes = span.attributes || {};
  return attributes.signal || "";
}

function toneForSignal(signal) {
  if (signal === "done") { return "ok"; }
  if (signal === "failed") { return "bad"; }
  if (signal === "running") { return "warn"; }
  return "";
}

function runFor(traceId) {
  for (const run of state.runs) { if (run.runId === traceId) { return run; } }
  return null;
}

function stepRow(node, depth, span0, total, label) {
  const span = node.span;
  const rows = [];
  const line = el("div", { class: "step" });
  line.appendChild(el("span", { class: "rail" }));
  line.appendChild(el("span", { class: "tick" }));
  line.appendChild(el("span", { style: "width:" + depth * 18 + "px" }));
  if (label) { line.appendChild(badge(label, "")); }
  line.appendChild(el("span", { class: "name" }, span.name));
  const signal = signalOf(span);
  if (signal) { line.appendChild(badge(signal, toneForSignal(signal))); }
  line.appendChild(el("span", { class: "grow" }));

  const took = ms(span.startedAt, span.endedAt);
  const track = el("div", { class: "bar-track" });
  const width = total > 0 ? Math.max((took / total) * 100, 1.2) : 100;
  const started = startsAt(span);
  const offset = total > 0 && isFinite(started) ? ((started - span0) / total) * 100 : 0;
  const tone = signal === "failed" ? "bad" : signal === "done" ? "ok" : "warn";
  const bar = el("div", { class: "bar " + tone });
  bar.setAttribute("style", "left:" + Math.max(Math.min(offset, 99), 0) + "%;width:" + Math.min(width, 100) + "%");
  track.appendChild(bar);
  line.appendChild(track);
  line.appendChild(el("span", { class: "meta dim mono" }, duration(took)));
  const attributes = span.attributes || {};
  if (attributes.externalId) {
    line.classList.add("openable");
    line.addEventListener("click", () => openStep(attributes.externalId));
  }
  rows.push(line);

  for (const child of node.children) {
    for (const nested of stepRow(child, depth + 1, span0, total, "")) { rows.push(nested); }
  }
  return rows;
}

function renderTrace(host, group) {
  const wrap = el("div", { class: "trace" });
  const head = el("button", { class: "trace-head", "aria-expanded": state.openTraces[group.traceId] ? "true" : "false" });
  head.appendChild(el("span", { class: "caret" }, "\\u25b6"));

  const source = sourceOf(group);
  head.appendChild(badge(source.text, source.tone));
  head.appendChild(el("span", { class: "who" }, group.root ? group.root.name : group.traceId));

  const run = runFor(group.traceId);
  if (run) { head.appendChild(badge(run.phase, toneForPhase(run.phase))); }

  head.appendChild(el("span", { class: "grow" }));
  head.appendChild(el("span", { class: "meta" }, passesOf(group).length + " passes, " + group.spans.length + " spans"));
  head.appendChild(runLink(group.traceId));

  const body = el("div", { class: "trace-body" + (state.openTraces[group.traceId] ? " on" : "") });
  head.addEventListener("click", () => {
    const open = !state.openTraces[group.traceId];
    state.openTraces[group.traceId] = open;
    head.setAttribute("aria-expanded", open ? "true" : "false");
    body.classList.toggle("on", open);
  });

  let earliest = Number.MAX_SAFE_INTEGER;
  let latest = 0;
  for (const span of group.spans) {
    const from = Date.parse(span.startedAt);
    const to = Date.parse(span.endedAt);
    if (isFinite(from) && from < earliest) { earliest = from; }
    if (isFinite(to) && to > latest) { latest = to; }
  }
  const total = Math.max(latest - earliest, 1);
  const tree = buildTree(group);
  let passNumber = 0;
  for (const pass of tree.passes) {
    passNumber = passNumber + 1;
    const label = tree.passes.length > 1 ? "pass " + passNumber : "";
    for (const line of stepRow(pass, 0, earliest, total, label)) { body.appendChild(line); }
  }
  for (const orphan of tree.loose) {
    for (const line of stepRow(orphan, 0, earliest, total, "dispatcher")) { body.appendChild(line); }
  }

  wrap.appendChild(head);
  wrap.appendChild(body);
  host.appendChild(wrap);
}

function matchesFilter(group) {
  const needle = state.filter.trim().toLowerCase();
  if (needle.length === 0) { return true; }
  if (group.traceId.toLowerCase().includes(needle)) { return true; }
  for (const span of group.spans) {
    if (span.name.toLowerCase().includes(needle)) { return true; }
    if (span.model.toLowerCase().includes(needle)) { return true; }
  }
  return false;
}

function renderRuns() {
  const host = byId("runs-body");
  const groups = traceGroups().filter(matchesFilter);
  if (groups.length === 0) {
    emptyState(host, "No operations recorded", "Send a request through the app and its whole tree lands here.");
    return;
  }
  clear(host);
  for (const group of groups.slice(0, 120)) { renderTrace(host, group); }
}

function renderFocusRail() {
  const rail = byId("focus-rail");
  if (!rail) { return; }
  clear(rail);
  rail.appendChild(el("div", { class: "rail-label" }, "Lifecycle"));

  const all = el("button", { "aria-selected": String(state.focus === "") }, "Everything");
  all.addEventListener("click", () => setFocus(""));
  rail.appendChild(all);

  for (const model of state.catalog) {
    const button = el("button", { "aria-selected": String(state.focus === model.name) }, model.name);
    button.appendChild(el("span", { class: "tag" }, String(model.fields.length)));
    button.addEventListener("click", () => setFocus(model.name));
    rail.appendChild(button);
  }

  rail.appendChild(el("div", { class: "rail-label" }, "Recent requests"));
  const none = el("button", { "aria-selected": String(state.selectedRun === "") }, "No request");
  none.addEventListener("click", () => {
    selectRun("").catch(fail);
  });
  rail.appendChild(none);

  let shown = 0;
  for (const run of state.runs) {
    if (shown >= 12) { break; }
    shown = shown + 1;
    const chosen = state.selectedRun === run.runId;
    const button = el("button", { "aria-selected": String(chosen) }, shortRunLabel(run));
    button.appendChild(badge(run.phase, toneForPhase(run.phase)));
    button.addEventListener("click", () => {
      selectRun(run.runId).catch(fail);
    });
    rail.appendChild(button);
  }
  if (state.selectedRun.length > 0 && state.runTrail.waiting.length > 0) {
    const note = el("div", { class: "rail-waiting" });
    note.appendChild(el("div", { class: "rail-waiting-label" }, "waiting on"));
    for (const name of state.runTrail.waiting) {
      note.appendChild(el("div", { class: "rail-waiting-name" }, name));
    }
    rail.appendChild(note);
  }
}

function shortRunLabel(run) {
  return run.model + "." + run.operation;
}

async function openRequest(runId) {
  state.runFilter = runId;
  show("map");
  await selectRun(runId);
  state.camera.ready = false;
  drawMap();
  fitMap();
}

function clearRunFilter() {
  state.runFilter = "";
  state.selectedRun = "";
  state.runTrail = { steps: [], phase: "", waiting: [], model: "" };
  state.runRows = [];
  closeStep();
  renderFocusRail();
  renderCrumb();
  paint();
}

function renderCrumb() {
  const crumb = byId("crumb");
  if (!crumb) { return; }
  clear(crumb);
  if (state.selectedRun.length < 1) {
    crumb.hidden = true;
    return;
  }
  crumb.hidden = false;
  crumb.appendChild(el("span", { class: "crumb-label" }, "following"));
  crumb.appendChild(el("span", { class: "mono" }, shortId(state.selectedRun)));
  if (state.runTrail.phase) {
    crumb.appendChild(badge(state.runTrail.phase, toneForPhase(state.runTrail.phase)));
  }
  for (const target of ["map", "runs", "outbox", "logs"]) {
    const wording = target === "runs" ? "operations" : target;
    const jump = el("button", { class: "btn ghost" }, wording);
    jump.addEventListener("click", () => show(target));
    crumb.appendChild(jump);
  }
  const drop = el("button", { class: "btn ghost" }, "clear");
  drop.addEventListener("click", () => clearRunFilter());
  crumb.appendChild(drop);
}

async function selectRun(runId) {
  state.selectedRun = runId === state.selectedRun ? "" : runId;
  if (state.selectedRun.length < 1) {
    state.runTrail = { steps: [], phase: "", waiting: [], model: "" };
    state.runRows = [];
    renderFocusRail();
    drawMap();
    return;
  }
  const rows = await load("/api/outbox?limit=200&runId=" + encodeURIComponent(state.selectedRun));
  state.runRows = rows;
  const steps = [];
  const waiting = [];
  for (const row of rows) {
    steps.push({ name: row.name, status: row.status, stepIndex: row.stepIndex });
    if (row.status === "pending") { waiting.push(row.name); }
  }
  let phase = "";
  let model = "";
  for (const run of state.runs) {
    if (run.runId !== state.selectedRun) { continue; }
    phase = run.phase;
    model = run.model;
  }
  if (model.length < 1) {
    for (const row of rows) { model = row.model; }
  }
  state.runTrail = { steps: steps, phase: phase, waiting: waiting, model: model };
  state.runFilter = state.selectedRun;
  renderFocusRail();
  renderCrumb();
  renderRequestDetail(state.selectedRun);
  drawMap();
}

async function setFocus(name) {
  state.focus = name;
  state.selectedPort = "";
  state.selectedNode = "";
  state.camera.ready = false;
  renderFocusRail();
  state.graph = await load(graphPath());
  drawMap();
  renderInspector();
}

function graphPath() {
  if (state.focus.length < 1) { return "/api/graph"; }
  return "/api/graph?focus=" + encodeURIComponent(state.focus);
}
`.trim();
}
