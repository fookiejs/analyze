import {
  absorb,
  badge,
  byId,
  cell,
  clear,
  clearFail,
  clock,
  el,
  emptyState,
  load,
  rememberToken,
  runLink,
  state,
  tableOf,
  toneForLevel,
  toneForStatus,
} from "./core.ts";
import { drawMap, drawRelations, fitMap, selectPort, zoomCenter } from "./map.ts";
import { renderInspector } from "./inspector.ts";
import { graphPath, renderCrumb, renderRuns, traceGroups } from "./trace.ts";
import { openStep } from "./detail.ts";
import { renderStuck, stuckCount } from "./stuck.ts";
import type {
  CatalogResponse,
  GraphResponse,
  LogRow,
  ObsPage,
  OutboxRow,
  RunRow,
  SpanEntry,
} from "./wire.ts";

function rootOf(span: SpanEntry): boolean {
  return span.parentModel.length === 0;
}

export function isOperationSpan(span: SpanEntry): boolean {
  const attributes = span.attributes || {};
  if (attributes["externalName"]) {
    return false;
  }
  return span.name.indexOf(".") > 0;
}

function enclosesBetter(candidate: SpanEntry, current: readonly SpanEntry[]): boolean {
  for (const held of current) {
    const a = Date.parse(candidate.startedAt);
    const b = Date.parse(held.startedAt);
    if (a !== b) {
      return a < b;
    }
    return Date.parse(candidate.endedAt) > Date.parse(held.endedAt);
  }
  return true;
}

export function pickRoot(spans: readonly SpanEntry[]): readonly SpanEntry[] {
  let root: readonly SpanEntry[] = [];
  for (const span of spans) {
    if (rootOf(span) === false) {
      continue;
    }
    if (isOperationSpan(span) === false) {
      continue;
    }
    if (enclosesBetter(span, root)) {
      root = [span];
    }
  }
  if (root.length > 0) {
    return root;
  }
  for (const span of spans) {
    if (rootOf(span) === false) {
      continue;
    }
    if (enclosesBetter(span, root)) {
      root = [span];
    }
  }
  if (root.length > 0) {
    return root;
  }
  return spans.slice(0, 1);
}

export function renderToolbar(host: HTMLElement, onChange: () => void, withTrouble: boolean): void {
  const bar = el("div", { class: "toolbar" });
  const box = el("input", {
    class: "input",
    id: "search-box",
    placeholder: "Search model, external, message or reason",
  });
  box.value = state.search;
  box.addEventListener("input", (event) => {
    state.search = (event.target as HTMLInputElement).value;
    state.page = 0;
    onChange();
  });
  bar.appendChild(box);

  if (withTrouble === false) {
    host.appendChild(bar);
    return;
  }
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

function pager(host: HTMLElement, shown: number, total: number, onChange: () => void): void {
  const bar = el("div", { class: "pager" });
  const back = el("button", { class: "btn ghost" }, "← newer");
  back.disabled = state.page < 1;
  back.addEventListener("click", () => {
    state.page = Math.max(state.page - 1, 0);
    onChange();
  });
  bar.appendChild(back);

  const from = total === 0 ? 0 : state.page * pageSize + 1;
  const to = state.page * pageSize + shown;
  bar.appendChild(el("span", { class: "dim" }, from + "–" + to + " of " + total));

  const on = el("button", { class: "btn ghost" }, "older →");
  on.disabled = (state.page + 1) * pageSize >= total;
  on.addEventListener("click", () => {
    state.page = state.page + 1;
    onChange();
  });
  bar.appendChild(on);
  host.appendChild(bar);
}

const pageSize = 40;

export function matchesSearch(haystack: readonly string[]): boolean {
  const needle = state.search.trim().toLowerCase();
  if (needle.length < 1) {
    return true;
  }
  for (const part of haystack) {
    if (String(part).toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

function troubledOutbox(row: OutboxRow): boolean {
  if (row.status === "dead_letter") {
    return true;
  }
  if (row.status === "failed") {
    return true;
  }
  if (row.error && row.error.length > 0) {
    return true;
  }
  if (row.compensationOf && row.compensationOf.length > 0) {
    return true;
  }
  return false;
}

function outboxRows(): OutboxRow[] {
  let source = state.outbox;
  if (state.runFilter.length > 0) {
    source = state.runRows.length > 0 ? state.runRows : state.outbox;
  }
  const kept: OutboxRow[] = [];
  for (const row of source) {
    if (state.runFilter.length > 0 && row.runId !== state.runFilter) {
      continue;
    }
    if (state.troubleOnly === true && troubledOutbox(row) === false) {
      continue;
    }
    const reason = row.error && row.error.length > 0 ? (row.error[0] ?? "") : "";
    if (matchesSearch([row.name, row.model, row.status, reason]) === false) {
      continue;
    }
    kept.push(row);
  }
  return kept;
}

export function renderOutbox(): void {
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
    emptyState(
      host,
      "The outbox is empty",
      "Call an external from a flow and every attempt is recorded here.",
    );
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

function troubledLog(entry: LogRow): boolean {
  if (entry.level === "error") {
    return true;
  }
  if (entry.level === "warn") {
    return true;
  }
  return false;
}

function logRows(): LogRow[] {
  const kept: LogRow[] = [];
  for (const entry of state.obs.logs.toReversed()) {
    if (state.runFilter.length > 0 && entry.traceId !== state.runFilter) {
      continue;
    }
    if (state.troubleOnly === true && troubledLog(entry) === false) {
      continue;
    }
    if (matchesSearch([entry.message, entry.model, entry.operation, entry.level]) === false) {
      continue;
    }
    kept.push(entry);
  }
  return kept;
}

export function renderLogs(): void {
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

function shapeIsDue(): boolean {
  if (state.catalog.length < 1) {
    return true;
  }
  return state.ticks % SHAPE_EVERY === 0;
}

export async function refresh(): Promise<void> {
  state.ticks = state.ticks + 1;
  const page = await load<ObsPage>("/api/obs?since=" + String(state.obsCursor));
  absorb(page);

  if (shapeIsDue()) {
    const [catalog, graph, relations, runs, outbox] = await Promise.all([
      load<CatalogResponse>("/api/catalog"),
      load<GraphResponse>(graphPath()),
      load<GraphResponse>(graphPath() + "?plane=data"),
      load<readonly RunRow[]>("/api/runs?limit=200"),
      load<readonly OutboxRow[]>("/api/outbox?limit=300"),
    ]);
    state.catalog = catalog.models;
    state.externals = catalog.externals;
    state.graph = graph;
    state.relations = relations;
    state.runs = runs;
    state.outbox = outbox;
  }
  clearFail();
  paint();
}

export function paint(): void {
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
  if (state.view === "map") {
    drawMap();
    renderInspector();
  }
  if (state.view === "models") {
    drawRelations();
  }
  if (state.view === "runs") {
    renderRuns();
  }
  if (state.view === "outbox") {
    renderOutbox();
  }
  if (state.view === "stuck") {
    renderStuck();
  }
  if (state.view === "logs") {
    renderLogs();
  }
}

const mapTitle: readonly [string, string] = [
  "Flows",
  "What each operation calls, in the order it called it",
];

const titles: Record<string, readonly [string, string]> = {
  map: mapTitle,
  models: ["Relations", "Every model, its columns and what it points at"],
  runs: ["Operations", "Each root operation with the flows it started underneath"],
  outbox: ["Outbox", "One row per external call attempt"],
  stuck: ["Stuck", "Steps that exhausted their attempts, grouped by what stopped them"],
  logs: ["Logs", "Everything the flows emitted"],
};

export const defaultView = "map";

function isCanvasView(name: string): boolean {
  if (name === "map") {
    return true;
  }
  if (name === "models") {
    return true;
  }
  return false;
}

export function viewFromPath(path: string): string {
  const slug = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (slug.length < 1) {
    return defaultView;
  }
  if (titles[slug] === undefined) {
    return defaultView;
  }
  return slug;
}

export function show(name: string): void {
  const previous = state.view;
  state.view = name;
  const wanted = name === defaultView ? "/" : "/" + name;
  if (location.pathname !== wanted) {
    history.pushState({}, "", wanted);
  }
  for (const section of document.querySelectorAll("section")) {
    section.hidden = section.id !== "view-" + name;
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(".nav button")) {
    button.setAttribute("aria-selected", String(button.dataset["view"] === name));
  }
  renderCrumb();
  const heading = titles[name] || mapTitle;
  byId("view-title").textContent = heading[0];
  byId("view-subtitle").textContent = heading[1];
  state.page = 0;
  byId("content").classList.toggle("flush", isCanvasView(name));
  byId("map-actions").hidden = isCanvasView(name) === false;
  byId("runs-actions").hidden = name !== "runs";
  if (previous !== name) {
    state.camera.ready = false;
  }
  paint();
}

export function wire(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".nav button")) {
    button.addEventListener("click", () => show(button.dataset["view"] ?? ""));
  }
  byId("zoom-in").addEventListener("click", () => {
    zoomCenter(1.2);
  });
  byId("zoom-out").addEventListener("click", () => {
    zoomCenter(1 / 1.2);
  });
  byId("zoom-fit").addEventListener("click", fitMap);
  byId("runs-filter").addEventListener("input", (event) => {
    state.filter = (event.target as HTMLInputElement).value;
    renderRuns();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      selectPort("");
    }
    if (event.key === "f" && isCanvasView(state.view) && event.target === document.body) {
      fitMap();
    }
  });
  window.addEventListener("resize", () => {
    if (isCanvasView(state.view) && !state.selectedPort) {
      fitMap();
    }
  });
}

export function markLive(on: boolean): void {
  const pulse = byId("pulse");
  pulse.classList.toggle("stale", !on);
  byId("pulse-text").textContent = on ? "live" : "disconnected";
}

export function wireGate(): void {
  const form = byId("gate-form");
  if (!form) {
    return;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId("gate-input") as HTMLInputElement;
    const offered = input ? input.value.trim() : "";
    if (offered.length < 1) {
      return;
    }
    rememberToken(offered);
    location.replace(location.pathname);
  });
}
