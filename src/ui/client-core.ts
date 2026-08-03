export function clientCoreJs(): string {
  return `
const TOKEN_KEY = "fookie-analyze-token";

function rememberToken(value) {
  try { sessionStorage.setItem(TOKEN_KEY, value); } catch (err) { void err; }
}

function forgetToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { void err; }
}

function resolveToken() {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) {
    rememberToken(fromUrl);
    history.replaceState({}, "", location.pathname);
    return fromUrl;
  }
  try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch (err) { void err; return ""; }
}

let token = resolveToken();
const headers = token ? { "x-analyze-token": token } : {};
const NS = "http://www.w3.org/2000/svg";

const state = {
  view: "map",
  catalog: [],
  externals: [],
  graph: { nodes: [], edges: [], width: 0, height: 0 },
  runs: [],
  outbox: [],
  obs: { logs: [], metrics: [], spans: [], nextSeq: 0, oldestSeq: 0 },
  obsCursor: 0,
  dropped: 0,
  ticks: 0,
  selectedRun: "",
  runTrail: { steps: [], phase: "", waiting: [], model: "" },
  runRows: [],
  selectedStep: "",
  selectedNode: "",
  selectedPort: "",
  selectedModel: "",
  focus: "",
  openTraces: {},
  filter: "",
  runFilter: "",
  lastTick: 0,
  search: "",
  troubleOnly: false,
  page: 0,
  camera: { x: 40, y: 40, k: 1, ready: false },
};

async function load(path) {
  const res = await fetch(path, { headers: { "x-analyze-token": token } });
  if (res.status === 401) {
    forgetToken();
    askForToken();
    throw new Error("this dashboard needs its access token");
  }
  if (!res.ok) { throw new Error(path + " answered " + res.status); }
  return await res.json();
}

function askForToken() {
  const gate = byId("gate");
  if (!gate) { return; }
  gate.classList.add("on");
  const input = byId("gate-input");
  if (input) { input.focus(); }
}

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  const keys = Object.keys(attrs || {});
  for (const key of keys) {
    if (key === "class") { node.className = attrs[key]; continue; }
    if (key === "dataset") {
      const dataKeys = Object.keys(attrs[key]);
      for (const dk of dataKeys) { node.dataset[dk] = attrs[key][dk]; }
      continue;
    }
    node.setAttribute(key, attrs[key]);
  }
  if (text !== undefined && text !== null) { node.textContent = String(text); }
  return node;
}

function svgEl(tag, attrs, text) {
  const node = document.createElementNS(NS, tag);
  const keys = Object.keys(attrs || {});
  for (const key of keys) { node.setAttribute(key, attrs[key]); }
  if (text !== undefined && text !== null) { node.textContent = String(text); }
  return node;
}

function clear(host) { host.replaceChildren(); return host; }
function byId(id) { return document.getElementById(id); }

function shortId(value) {
  const text = String(value || "");
  if (text.length <= 10) { return text; }
  return text.slice(0, 8) + "\\u2026" + text.slice(-4);
}

function ms(from, to) {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!isFinite(a) || !isFinite(b)) { return 0; }
  return Math.max(b - a, 0);
}

function duration(value) {
  if (value < 1) { return "<1ms"; }
  if (value < 1000) { return Math.round(value) + "ms"; }
  return (value / 1000).toFixed(2) + "s";
}

function clock(value) {
  const parsed = Date.parse(value);
  if (!isFinite(parsed)) { return ""; }
  return new Date(parsed).toLocaleTimeString();
}

function badge(text, tone) {
  const node = el("span", { class: "badge " + (tone || "") });
  node.appendChild(el("span", { class: "dot" }));
  node.appendChild(document.createTextNode(text));
  return node;
}

function toneForPhase(phase) {
  if (phase === "completed") { return "ok"; }
  if (phase === "compensated") { return "violet"; }
  if (phase === "compensating") { return "warn"; }
  if (phase === "stuck") { return "bad"; }
  return "info";
}

function toneForStatus(status) {
  if (status === "completed") { return "ok"; }
  if (status === "pending") { return "info"; }
  if (status === "failed") { return "warn"; }
  return "bad";
}

function toneForLevel(level) {
  if (level === "error") { return "bad"; }
  if (level === "warn") { return "warn"; }
  return "";
}

function emptyState(host, title, hint) {
  const box = el("div", { class: "empty" });
  box.appendChild(el("div", { class: "big" }, title));
  box.appendChild(el("div", {}, hint));
  clear(host).appendChild(box);
}

function tableOf(host, columns, rows, render) {
  clear(host);
  const table = el("table", {});
  const head = el("thead", {});
  const headRow = el("tr", {});
  for (const column of columns) { headRow.appendChild(el("th", {}, column)); }
  head.appendChild(headRow);
  table.appendChild(head);
  const body = el("tbody", {});
  for (const row of rows) { body.appendChild(render(row)); }
  table.appendChild(body);
  host.appendChild(table);
}

function cell(row, value, cls) {
  const td = el("td", cls ? { class: cls } : {});
  if (value instanceof Node) { td.appendChild(value); } else { td.textContent = value === undefined || value === null ? "" : String(value); }
  row.appendChild(td);
  return td;
}

function fail(err) {
  const banner = byId("banner");
  banner.textContent = String(err && err.message ? err.message : err);
  banner.classList.add("on");
}

function clearFail() { byId("banner").classList.remove("on"); }

function looksLikeRunId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(value));
}

function runLink(runId, label) {
  if (looksLikeRunId(runId) === false) {
    return el("span", { class: "mono dim" }, label ? label : String(runId));
  }
  const shown = label ? label : shortId(runId);
  const link = el("button", { class: "run-link", title: "Follow this request" }, shown);
  link.addEventListener("click", (event) => {
    event.stopPropagation();
    openRequest(runId).catch(fail);
  });
  return link;
}

const KEPT_ENTRIES = 4000;

function keepLast(existing, arriving) {
  if (arriving.length === 0) { return existing; }
  const merged = existing.concat(arriving);
  if (merged.length <= KEPT_ENTRIES) { return merged; }
  return merged.slice(merged.length - KEPT_ENTRIES);
}

function absorb(page) {
  const missed = state.obsCursor > 0 && page.oldestSeq > state.obsCursor + 1
    ? page.oldestSeq - state.obsCursor - 1
    : 0;
  if (missed > 0) { state.dropped = state.dropped + missed; }
  state.obs = {
    logs: keepLast(state.obs.logs, page.logs),
    metrics: keepLast(state.obs.metrics, page.metrics),
    spans: keepLast(state.obs.spans, page.spans),
    nextSeq: page.nextSeq,
    oldestSeq: page.oldestSeq,
  };
  state.obsCursor = page.nextSeq;
  return missed;
}
`.trim();
}
