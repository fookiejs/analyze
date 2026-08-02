export function clientViewsJs(): string {
  return `
function spanKey(model, entityId) { return model + "\\u0000" + entityId; }

function rootOf(span) {
  return span.parentModel.length === 0;
}

function isOperationSpan(span) {
  const attributes = span.attributes || {};
  if (attributes.externalName) { return false; }
  return span.name.indexOf(".") > 0;
}

function enclosesBetter(candidate, current) {
  if (current === null) { return true; }
  const a = Date.parse(candidate.startedAt);
  const b = Date.parse(current.startedAt);
  if (a !== b) { return a < b; }
  return Date.parse(candidate.endedAt) > Date.parse(current.endedAt);
}

function pickRoot(spans) {
  let root = null;
  for (const span of spans) {
    if (rootOf(span) === false) { continue; }
    if (isOperationSpan(span) === false) { continue; }
    if (enclosesBetter(span, root)) { root = span; }
  }
  if (root !== null) { return root; }
  for (const span of spans) {
    if (rootOf(span) === false) { continue; }
    if (enclosesBetter(span, root)) { root = span; }
  }
  return root === null ? spans[0] : root;
}

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
  head.appendChild(el("span", { class: "meta mono" }, shortId(group.traceId)));

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

function renderModels() {
  const host = byId("models-body");
  if (state.selectedModel) { renderModelDetail(host, state.selectedModel); return; }
  if (state.catalog.length === 0) {
    emptyState(host, "No models registered", "Pass models to app() and they show up here.");
    return;
  }
  clear(host);
  const grid = el("div", { class: "grid cards" });
  for (const model of state.catalog) {
    const card = el("div", { class: "card" });
    const head = el("div", { class: "card-head" });
    const title = el("div", {});
    title.appendChild(el("div", { class: "card-title" }, model.name));
    title.appendChild(el("div", { class: "card-desc mono" }, model.table));
    head.appendChild(title);
    head.appendChild(el("span", { class: "grow", style: "flex:1" }));
    head.appendChild(badge(model.fields.length + " fields", ""));
    card.appendChild(head);

    const body = el("div", { class: "card-body" });
    const chips = el("div", { class: "chips" });
    let shown = 0;
    for (const field of model.fields) {
      if (field.system) { continue; }
      if (shown >= 6) { break; }
      chips.appendChild(badge(field.key, field.relation.length > 0 ? "violet" : ""));
      shown = shown + 1;
    }
    body.appendChild(chips);
    const stats = el("div", { class: "kv", style: "margin-top:12px" });
    stats.appendChild(el("div", { class: "k" }, "runs"));
    stats.appendChild(el("div", {}, String(runCountFor(model.name))));
    stats.appendChild(el("div", { class: "k" }, "relations"));
    stats.appendChild(el("div", {}, String(relationCountFor(model))));
    body.appendChild(stats);
    card.appendChild(body);

    card.addEventListener("click", () => {
      state.selectedModel = model.name;
      renderModels();
    });
    card.setAttribute("style", "cursor:pointer");
    grid.appendChild(card);
  }
  host.appendChild(grid);
}

function relationCountFor(model) {
  let total = 0;
  for (const field of model.fields) { if (field.relation.length > 0) { total = total + 1; } }
  return total;
}

function renderModelDetail(host, name) {
  const model = modelNamed(name);
  if (!model) { state.selectedModel = ""; renderModels(); return; }
  clear(host);

  const bar = el("div", { class: "toolbar" });
  const back = el("button", { class: "btn ghost" }, "\\u2190 All models");
  back.addEventListener("click", () => { state.selectedModel = ""; renderModels(); });
  bar.appendChild(back);
  bar.appendChild(el("h2", {}, model.name));
  bar.appendChild(badge(model.table, ""));
  host.appendChild(bar);

  const stats = el("div", { class: "grid stats", style: "margin-bottom:12px" });
  stats.appendChild(statCard("Fields", String(model.fields.length)));
  stats.appendChild(statCard("Relations", String(relationCountFor(model))));
  stats.appendChild(statCard("Runs seen", String(runCountFor(model.name))));
  stats.appendChild(statCard("Externals", String(externalsFor(model.name).length)));
  host.appendChild(stats);

  const fields = el("div", { class: "card" });
  const fieldsHead = el("div", { class: "card-head" });
  fieldsHead.appendChild(el("div", { class: "card-title" }, "Fields"));
  fields.appendChild(fieldsHead);
  const fieldsBody = el("div", { class: "card-body tight" });
  tableOf(fieldsBody, ["Field", "Column", "Postgres type", "Flags"], model.fields, (field) => {
    const row = el("tr", {});
    cell(row, field.key);
    cell(row, el("span", { class: "mono dim" }, field.column));
    cell(row, el("span", { class: "mono dim" }, field.pgType));
    const flags = el("div", { class: "chips" });
    if (field.relation.length > 0) { flags.appendChild(badge("\\u2192 " + field.relation[0], "violet")); }
    if (field.unique) { flags.appendChild(badge("unique", "info")); }
    if (field.index && !field.unique) { flags.appendChild(badge("index", "")); }
    if (field.system) { flags.appendChild(badge("system", "")); }
    cell(row, flags);
    return row;
  });
  fields.appendChild(fieldsBody);
  host.appendChild(fields);

  const calls = externalsFor(model.name);
  const callsCard = el("div", { class: "card", style: "margin-top:12px" });
  const callsHead = el("div", { class: "card-head" });
  callsHead.appendChild(el("div", { class: "card-title" }, "Externals this model has called"));
  callsCard.appendChild(callsHead);
  const callsBody = el("div", { class: "card-body tight" });
  if (calls.length === 0) {
    emptyState(callsBody, "Nothing called yet", "Observed calls appear here once the outbox records one.");
  } else {
    tableOf(callsBody, ["External", "Calls", "Dead letters"], calls, (entry) => {
      const row = el("tr", {});
      cell(row, entry.name);
      cell(row, String(entry.total), "num");
      cell(row, entry.dead > 0 ? badge(String(entry.dead), "bad") : el("span", { class: "dim" }, "0"), "num");
      return row;
    });
  }
  callsCard.appendChild(callsBody);
  host.appendChild(callsCard);
}

function statCard(label, value) {
  const card = el("div", { class: "card" });
  const body = el("div", { class: "stat" });
  body.appendChild(el("div", { class: "k" }, label));
  body.appendChild(el("div", { class: "v" }, value));
  card.appendChild(body);
  return card;
}

function externalsFor(model) {
  const index = {};
  const order = [];
  for (const row of state.outbox) {
    if (row.model !== model) { continue; }
    if (!index[row.name]) { index[row.name] = { name: row.name, total: 0, dead: 0 }; order.push(row.name); }
    index[row.name].total = index[row.name].total + 1;
    if (row.status === "dead_letter") { index[row.name].dead = index[row.name].dead + 1; }
  }
  const built = [];
  for (const name of order) { built.push(index[name]); }
  return built;
}

function renderOutbox() {
  const host = byId("outbox-body");
  if (state.outbox.length === 0) {
    emptyState(host, "The outbox is empty", "Call an external from a flow and every attempt is recorded here.");
    return;
  }
  clear(host);
  tableOf(host, ["External", "Model", "Status", "Attempt", "Step", "Run"], state.outbox, (row) => {
    const line = el("tr", {});
    cell(line, row.name);
    cell(line, row.model);
    cell(line, badge(row.status, toneForStatus(row.status)));
    cell(line, String(row.attempt), "num");
    cell(line, String(row.stepIndex), "num");
    cell(line, el("span", { class: "mono dim" }, shortId(row.runId)));
    return line;
  });
}

function renderLogs() {
  const host = byId("logs-body");
  const rows = state.obs.logs.toReversed();
  if (rows.length === 0) {
    emptyState(host, "No log lines yet", "Anything a flow logs shows up here as it happens.");
    return;
  }
  clear(host);
  tableOf(host, ["", "Time", "Model", "Operation", "Message", "Run"], rows.slice(0, 300), (entry) => {
    const line = el("tr", {});
    cell(line, badge(entry.level, toneForLevel(entry.level)));
    cell(line, el("span", { class: "dim mono" }, clock(entry.timestamp)));
    cell(line, entry.model);
    cell(line, el("span", { class: "dim" }, entry.operation));
    cell(line, el("span", { class: "truncate" }, entry.message));
    cell(line, el("span", { class: "mono dim" }, shortId(entry.traceId)));
    return line;
  });
}

async function refresh() {
  const [catalog, graph, runs, outbox, obs] = await Promise.all([
    load("/api/catalog"),
    load("/api/graph"),
    load("/api/runs?limit=200"),
    load("/api/outbox?limit=300"),
    load("/api/obs?since=0"),
  ]);
  state.catalog = catalog.models;
  state.externals = catalog.externals;
  state.graph = graph;
  state.runs = runs;
  state.outbox = outbox;
  state.obs = obs;
  clearFail();
  paint();
}

function paint() {
  byId("count-models").textContent = String(state.catalog.length);
  byId("count-models-2").textContent = String(state.catalog.length);
  byId("count-runs").textContent = String(traceGroups().length);
  byId("count-outbox").textContent = String(state.outbox.length);
  byId("count-logs").textContent = String(state.obs.logs.length);
  if (state.view === "map") { drawMap(); renderInspector(); }
  if (state.view === "models") { renderModels(); }
  if (state.view === "runs") { renderRuns(); }
  if (state.view === "outbox") { renderOutbox(); }
  if (state.view === "logs") { renderLogs(); }
}

const titles = {
  map: ["Application map", "Declared relations and the calls actually observed"],
  models: ["Models", "Every registered model, its columns and what it has called"],
  runs: ["Operations", "Each root operation with the flows it started underneath"],
  outbox: ["Outbox", "One row per external call attempt"],
  logs: ["Logs", "Everything the flows emitted"],
};

function show(name) {
  state.view = name;
  for (const section of document.querySelectorAll("section")) {
    section.hidden = section.id !== "view-" + name;
  }
  for (const button of document.querySelectorAll(".nav button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  }
  const heading = titles[name] || titles.map;
  byId("view-title").textContent = heading[0];
  byId("view-subtitle").textContent = heading[1];
  byId("content").classList.toggle("flush", name === "map");
  byId("map-actions").hidden = name !== "map";
  byId("runs-actions").hidden = name !== "runs";
  paint();
}

function wire() {
  for (const button of document.querySelectorAll(".nav button")) {
    button.addEventListener("click", () => show(button.dataset.view));
  }
  byId("zoom-in").addEventListener("click", () => {
    const svg = byId("map-svg");
    if (!svg) { return; }
    const box = svg.getBoundingClientRect();
    zoomAt(box.left + box.width / 2, box.top + box.height / 2, 1.2);
  });
  byId("zoom-out").addEventListener("click", () => {
    const svg = byId("map-svg");
    if (!svg) { return; }
    const box = svg.getBoundingClientRect();
    zoomAt(box.left + box.width / 2, box.top + box.height / 2, 1 / 1.2);
  });
  byId("zoom-fit").addEventListener("click", fitMap);
  byId("runs-filter").addEventListener("input", (event) => {
    state.filter = event.target.value;
    renderRuns();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { selectNode(""); }
    if (event.key === "f" && state.view === "map" && event.target === document.body) { fitMap(); }
  });
  window.addEventListener("resize", () => {
    if (state.view === "map" && !state.selectedNode) { fitMap(); }
  });
}

function markLive(on) {
  const pulse = byId("pulse");
  pulse.classList.toggle("stale", !on);
  byId("pulse-text").textContent = on ? "live" : "disconnected";
}

wire();
show("map");
refresh().catch(fail);

const stream = new EventSource("/api/stream" + (token ? "?token=" + encodeURIComponent(token) : ""));
stream.addEventListener("open", () => markLive(true));
stream.addEventListener("error", () => markLive(false));
stream.addEventListener("tick", () => {
  refresh().catch(fail);
});
`.trim();
}
