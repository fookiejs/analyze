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

function renderToolbar(host, onChange, withTrouble) {
  const bar = el("div", { class: "toolbar" });
  const box = el("input", {
    class: "input",
    id: "search-box",
    placeholder: "Search model, external, message or reason",
  });
  box.value = state.search;
  box.addEventListener("input", (event) => {
    state.search = event.target.value;
    state.page = 0;
    onChange();
  });
  bar.appendChild(box);

  if (withTrouble === false) { host.appendChild(bar); return; }
  const trouble = el("button", { class: "btn" + (state.troubleOnly ? " on" : "") }, "Trouble only");
  trouble.setAttribute("aria-selected", String(state.troubleOnly));
  trouble.addEventListener("click", () => {
    state.troubleOnly = !state.troubleOnly;
    state.page = 0;
    onChange();
  });
  bar.appendChild(trouble);
  host.appendChild(bar);
}

function pager(host, shown, total, onChange) {
  const bar = el("div", { class: "pager" });
  const back = el("button", { class: "btn ghost" }, "\u2190 newer");
  back.disabled = state.page < 1;
  back.addEventListener("click", () => {
    state.page = Math.max(state.page - 1, 0);
    onChange();
  });
  bar.appendChild(back);

  const from = total === 0 ? 0 : state.page * pageSize + 1;
  const to = state.page * pageSize + shown;
  bar.appendChild(el("span", { class: "dim" }, from + "\u2013" + to + " of " + total));

  const on = el("button", { class: "btn ghost" }, "older \u2192");
  on.disabled = (state.page + 1) * pageSize >= total;
  on.addEventListener("click", () => {
    state.page = state.page + 1;
    onChange();
  });
  bar.appendChild(on);
  host.appendChild(bar);
}

const pageSize = 40;

function matchesSearch(haystack) {
  const needle = state.search.trim().toLowerCase();
  if (needle.length < 1) { return true; }
  for (const part of haystack) {
    if (String(part).toLowerCase().includes(needle)) { return true; }
  }
  return false;
}

function troubledOutbox(row) {
  if (row.status === "dead_letter") { return true; }
  if (row.status === "failed") { return true; }
  if (row.error && row.error.length > 0) { return true; }
  if (row.compensationOf && row.compensationOf.length > 0) { return true; }
  return false;
}

function outboxRows() {
  let source = state.outbox;
  if (state.runFilter.length > 0) {
    source = state.runRows.length > 0 ? state.runRows : state.outbox;
  }
  const kept = [];
  for (const row of source) {
    if (state.runFilter.length > 0 && row.runId !== state.runFilter) { continue; }
    if (state.troubleOnly === true && troubledOutbox(row) === false) { continue; }
    const reason = row.error && row.error.length > 0 ? row.error[0] : "";
    if (matchesSearch([row.name, row.model, row.status, reason]) === false) { continue; }
    kept.push(row);
  }
  return kept;
}

function renderOutbox() {
  const host = byId("outbox-body");
  if (outboxRows().length === 0 && state.runFilter.length > 0) {
    emptyState(
      host,
      "This request called nothing",
      "No external was dispatched for it, so the outbox has nothing to show.",
    );
    return;
  }
  if (state.outbox.length === 0) {
    emptyState(host, "The outbox is empty", "Call an external from a flow and every attempt is recorded here.");
    return;
  }
  clear(host);
  renderToolbar(host, renderOutbox, true);
  const found = outboxRows();
  const shown = found.slice(state.page * pageSize, state.page * pageSize + pageSize);
  const table = el("div", {});
  host.appendChild(table);
  pager(host, shown.length, found.length, renderOutbox);
  tableOf(table, ["External", "Model", "Status", "Attempt", "Step", "Request"], shown, (row) => {
    const line = el("tr", {});
    cell(line, row.name);
    cell(line, row.model);
    cell(line, badge(row.status, toneForStatus(row.status)));
    cell(line, String(row.attempt), "num");
    cell(line, String(row.stepIndex), "num");
    cell(line, runLink(row.runId));
    line.classList.add("clickable");
    line.addEventListener("click", () => openStep(row.externalId));
    return line;
  });
}

function troubledLog(entry) {
  if (entry.level === "error") { return true; }
  if (entry.level === "warn") { return true; }
  return false;
}

function logRows() {
  const kept = [];
  for (const entry of state.obs.logs.toReversed()) {
    if (state.runFilter.length > 0 && entry.traceId !== state.runFilter) { continue; }
    if (state.troubleOnly === true && troubledLog(entry) === false) { continue; }
    if (matchesSearch([entry.message, entry.model, entry.operation, entry.level]) === false) { continue; }
    kept.push(entry);
  }
  return kept;
}

function renderLogs() {
  const host = byId("logs-body");
  const rows = logRows();
  if (rows.length === 0 && state.runFilter.length > 0) {
    emptyState(
      host,
      "Nothing logged for this request",
      "Logs live in memory only, so anything older than the buffer is already gone.",
    );
    return;
  }
  if (rows.length === 0) {
    emptyState(host, "No log lines yet", "Anything a flow logs shows up here as it happens.");
    return;
  }
  clear(host);
  renderToolbar(host, renderLogs, true);
  const shown = rows.slice(state.page * pageSize, state.page * pageSize + pageSize);
  const table = el("div", {});
  host.appendChild(table);
  pager(host, shown.length, rows.length, renderLogs);
  tableOf(table, ["", "Time", "Model", "Operation", "Message", "Request"], shown, (entry) => {
    const line = el("tr", {});
    cell(line, badge(entry.level, toneForLevel(entry.level)));
    cell(line, el("span", { class: "dim mono" }, clock(entry.timestamp)));
    cell(line, entry.model);
    cell(line, el("span", { class: "dim" }, entry.operation));
    cell(line, el("span", { class: "truncate" }, entry.message));
    cell(line, runLink(entry.traceId));
    return line;
  });
}

const SHAPE_EVERY = 4;

function shapeIsDue() {
  if (state.catalog.length < 1) { return true; }
  return state.ticks % SHAPE_EVERY === 0;
}

async function refresh() {
  state.ticks = state.ticks + 1;
  const page = await load("/api/obs?since=" + String(state.obsCursor));
  absorb(page);

  if (shapeIsDue()) {
    const [catalog, graph, runs, outbox] = await Promise.all([
      load("/api/catalog"),
      load(graphPath()),
      load("/api/runs?limit=200"),
      load("/api/outbox?limit=300"),
    ]);
    state.catalog = catalog.models;
    state.externals = catalog.externals;
    state.graph = graph;
    state.runs = runs;
    state.outbox = outbox;
  }
  clearFail();
  paint();
}

function paint() {
  byId("count-models").textContent = String(state.catalog.length);
  byId("count-models-2").textContent = String(state.catalog.length);
  byId("count-runs").textContent = String(traceGroups().length);
  byId("count-outbox").textContent = String(state.outbox.length);
  byId("count-stuck").textContent = String(stuckCount());
  byId("count-logs").textContent = String(state.obs.logs.length);
  const gap = byId("dropped");
  if (gap) {
    gap.hidden = state.dropped < 1;
    gap.textContent = String(state.dropped) + " entries aged out before you saw them";
  }
  if (state.view === "map") { renderFocusRail(); drawMap(); renderInspector(); }
  if (state.view === "models") { renderModels(); }
  if (state.view === "runs") { renderRuns(); }
  if (state.view === "outbox") { renderOutbox(); }
  if (state.view === "stuck") { renderStuck(); }
  if (state.view === "logs") { renderLogs(); }
}

const titles = {
  map: ["Application map", "Declared relations and the calls actually observed"],
  models: ["Models", "Every registered model, its columns and what it has called"],
  runs: ["Operations", "Each root operation with the flows it started underneath"],
  outbox: ["Outbox", "One row per external call attempt"],
  stuck: ["Stuck", "Steps that exhausted their attempts, grouped by what stopped them"],
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
  renderCrumb();
  const heading = titles[name] || titles.map;
  byId("view-title").textContent = heading[0];
  byId("view-subtitle").textContent = heading[1];
  state.page = 0;
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
  for (const button of document.querySelectorAll("#plane-switch button")) {
    button.addEventListener("click", () => setPlane(button.dataset.plane));
  }
  byId("runs-filter").addEventListener("input", (event) => {
    state.filter = event.target.value;
    renderRuns();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { selectPort(""); }
    if (event.key === "f" && state.view === "map" && event.target === document.body) { fitMap(); }
  });
  window.addEventListener("resize", () => {
    if (state.view === "map" && !state.selectedPort) { fitMap(); }
  });
}

function markLive(on) {
  const pulse = byId("pulse");
  pulse.classList.toggle("stale", !on);
  byId("pulse-text").textContent = on ? "live" : "disconnected";
}

function wireGate() {
  const form = byId("gate-form");
  if (!form) { return; }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId("gate-input");
    const offered = input ? input.value.trim() : "";
    if (offered.length < 1) { return; }
    rememberToken(offered);
    location.replace(location.pathname);
  });
}

wire();
wireGate();
show("map");
if (token) { refresh().catch(fail); } else { askForToken(); }

const stream = new EventSource("/api/stream" + (token ? "?token=" + encodeURIComponent(token) : ""));
stream.addEventListener("open", () => {
  markLive(true);
  refresh().catch(fail);
});
stream.addEventListener("error", () => markLive(false));
stream.addEventListener("tick", () => {
  state.lastTick = Date.now();
  refresh().catch(fail);
});

const heartbeatMs = 5000;

setInterval(() => {
  if (!token) { return; }
  const quiet = Date.now() - state.lastTick;
  if (quiet < heartbeatMs) { return; }
  refresh()
    .then(() => {
      state.lastTick = Date.now();
      markLive(true);
    })
    .catch(fail);
}, heartbeatMs);
`.trim();
}
