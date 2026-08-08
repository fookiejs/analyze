import type {
  ExternalSummary,
  GraphResponse,
  LogRow,
  MetricEntry,
  ModelSummary,
  ObsPage,
  OutboxRow,
  RunRow,
  SpanEntry,
} from "./wire.ts";
import { openRequest } from "./trace.ts";

const TOKEN_KEY = "fookie-analyze-token";

export function rememberToken(value: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
  } catch {}
}

function forgetToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function resolveToken(): string {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) {
    rememberToken(fromUrl);
    history.replaceState({}, "", location.pathname);
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export const token = resolveToken();
const NS = "http://www.w3.org/2000/svg";

export type RunTrailStep = { name: string; status: string; stepIndex: number };

export type RunTrail = {
  steps: RunTrailStep[];
  phase: string;
  waiting: string[];
  model: string;
};

export type Camera = { x: number; y: number; k: number; ready: boolean };

export type ObsBuffer = {
  logs: readonly LogRow[];
  metrics: readonly MetricEntry[];
  spans: readonly SpanEntry[];
  nextSeq: number;
  oldestSeq: number;
};

export type ClientState = {
  view: string;
  catalog: readonly ModelSummary[];
  externals: readonly ExternalSummary[];
  graph: GraphResponse;
  relations: GraphResponse;
  runs: readonly RunRow[];
  outbox: readonly OutboxRow[];
  obs: ObsBuffer;
  obsCursor: number;
  dropped: number;
  ticks: number;
  selectedRun: string;
  runTrail: RunTrail;
  runRows: readonly OutboxRow[];
  selectedStep: string;
  selectedNode: string;
  selectedPort: string;
  selectedModel: string;
  focus: string;
  openTraces: Record<string, boolean>;
  filter: string;
  runFilter: string;
  lastTick: number;
  search: string;
  troubleOnly: boolean;
  page: number;
  camera: Camera;
};

export const state: ClientState = {
  view: "map",
  catalog: [],
  externals: [],
  graph: { nodes: [], edges: [], width: 0, height: 0 },
  relations: { nodes: [], edges: [], width: 0, height: 0 },
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

export async function load<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "x-analyze-token": token } });
  if (res.status === 401) {
    forgetToken();
    askForToken();
    throw new Error("this dashboard needs its access token");
  }
  if (!res.ok) {
    throw new Error(path + " answered " + res.status);
  }
  return (await res.json()) as T;
}

export function askForToken(): void {
  const gate = byId("gate");
  if (!gate) {
    return;
  }
  gate.classList.add("on");
  const input = byId("gate-input");
  if (input) {
    input.focus();
  }
}

export type Attrs = Readonly<Record<string, string | number>>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  text: string | number = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") {
      node.className = String(value);
      continue;
    }
    node.setAttribute(key, String(value));
  }
  node.textContent = String(text);
  return node;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs,
  text: string | number = "",
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  node.textContent = String(text);
  return node;
}

export function clear<T extends Element>(host: T): T {
  host.replaceChildren();
  return host;
}

export function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export function shortId(value: string): string {
  const text = String(value || "");
  if (text.length <= 10) {
    return text;
  }
  return text.slice(0, 8) + "…" + text.slice(-4);
}

export function ms(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!isFinite(a) || !isFinite(b)) {
    return 0;
  }
  return Math.max(b - a, 0);
}

export function duration(value: number): string {
  if (value < 1) {
    return "<1ms";
  }
  if (value < 1000) {
    return Math.round(value) + "ms";
  }
  return (value / 1000).toFixed(2) + "s";
}

export function clock(value: string): string {
  const parsed = Date.parse(value);
  if (!isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toLocaleTimeString();
}

export function badge(text: string, tone: string): HTMLElement {
  const node = el("span", { class: "badge " + (tone || "") });
  node.appendChild(el("span", { class: "dot" }));
  node.appendChild(document.createTextNode(text));
  return node;
}

export function toneForPhase(phase: string): string {
  if (phase === "completed") {
    return "ok";
  }
  if (phase === "compensated") {
    return "violet";
  }
  if (phase === "compensating") {
    return "warn";
  }
  if (phase === "stuck") {
    return "bad";
  }
  return "info";
}

export function toneForStatus(status: string): string {
  if (status === "completed") {
    return "ok";
  }
  if (status === "pending") {
    return "info";
  }
  if (status === "failed") {
    return "warn";
  }
  return "bad";
}

export function toneForLevel(level: string): string {
  if (level === "error") {
    return "bad";
  }
  if (level === "warn") {
    return "warn";
  }
  return "";
}

export function emptyState(host: Element, title: string, hint: string): void {
  const box = el("div", { class: "empty" });
  box.appendChild(el("div", { class: "big" }, title));
  box.appendChild(el("div", {}, hint));
  clear(host).appendChild(box);
}

export function tableOf<T>(
  host: Element,
  columns: readonly string[],
  rows: readonly T[],
  render: (row: T) => HTMLElement,
): void {
  clear(host);
  const table = el("table", {});
  const head = el("thead", {});
  const headRow = el("tr", {});
  for (const column of columns) {
    headRow.appendChild(el("th", {}, column));
  }
  head.appendChild(headRow);
  table.appendChild(head);
  const body = el("tbody", {});
  for (const row of rows) {
    body.appendChild(render(row));
  }
  table.appendChild(body);
  host.appendChild(table);
}

export function cell(row: HTMLElement, value: Node | string, cls?: string): HTMLElement {
  const td = el("td", cls ? { class: cls } : {});
  if (value instanceof Node) {
    td.appendChild(value);
  } else {
    td.textContent = String(value);
  }
  row.appendChild(td);
  return td;
}

export function fail(err: unknown): void {
  const banner = byId("banner");
  banner.textContent = err instanceof Error && err.message ? err.message : String(err);
  banner.classList.add("on");
}

export function clearFail(): void {
  byId("banner").classList.remove("on");
}

export function looksLikeRunId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(value));
}

export function runLink(runId: string, label?: string): HTMLElement {
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

export function keepLast<T>(existing: readonly T[], arriving: readonly T[]): readonly T[] {
  if (arriving.length === 0) {
    return existing;
  }
  const merged = existing.concat(arriving);
  if (merged.length <= KEPT_ENTRIES) {
    return merged;
  }
  return merged.slice(merged.length - KEPT_ENTRIES);
}

export function absorb(page: ObsPage): number {
  const missed =
    state.obsCursor > 0 && page.oldestSeq > state.obsCursor + 1
      ? page.oldestSeq - state.obsCursor - 1
      : 0;
  if (missed > 0) {
    state.dropped = state.dropped + missed;
  }
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
