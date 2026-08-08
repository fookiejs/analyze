import {
  badge,
  byId,
  clear,
  duration,
  el,
  emptyState,
  load,
  ms,
  runLink,
  shortId,
  state,
  toneForPhase,
} from "./core.ts";
import { drawMap, fitMap } from "./map.ts";
import { closeStep, openStep, renderRequestDetail } from "./detail.ts";
import { isOperationSpan, paint, pickRoot, show } from "./views.ts";
import type { OutboxRow, RunRow, SpanEntry } from "./wire.ts";
import { lookup } from "./slot.ts";

export type TraceGroup = { traceId: string; spans: SpanEntry[]; root: readonly SpanEntry[] };

export type TreeNode = { span: SpanEntry; children: TreeNode[] };

export function startsAt(span: SpanEntry): number {
  return Date.parse(span.startedAt);
}

export function endsAt(span: SpanEntry): number {
  return Date.parse(span.endedAt);
}

function contains(outer: SpanEntry, inner: SpanEntry): boolean {
  if (outer === inner) {
    return false;
  }
  const from = startsAt(outer);
  const to = endsAt(outer);
  const a = startsAt(inner);
  const b = endsAt(inner);
  if (!isFinite(from) || !isFinite(a)) {
    return false;
  }
  return from <= a && b <= to;
}

export function traceGroups(): TraceGroup[] {
  const order: string[] = [];
  const groups = new Map<string, TraceGroup>();
  for (const span of state.obs.spans) {
    const known = lookup(groups, span.traceId);
    if (known.length < 1) {
      groups.set(span.traceId, { traceId: span.traceId, spans: [span], root: [] });
      order.push(span.traceId);
      continue;
    }
    for (const group of known) {
      group.spans.push(span);
    }
  }
  const built: TraceGroup[] = [];
  for (const traceId of order) {
    for (const group of lookup(groups, traceId)) {
      group.root = pickRoot(group.spans);
      built.push(group);
    }
  }
  return built.toReversed();
}

export function passesOf(group: TraceGroup): SpanEntry[] {
  const root = group.root;
  const passes: SpanEntry[] = [];
  for (const held of root) {
    for (const span of group.spans) {
      if (isOperationSpan(span) === false) {
        continue;
      }
      if (span.model !== held.model) {
        continue;
      }
      if (span.entityId !== held.entityId) {
        continue;
      }
      if (span.name !== held.name) {
        continue;
      }
      passes.push(span);
    }
  }
  return passes.toSorted((left, right) => startsAt(left) - startsAt(right));
}

function operationSpansOf(group: TraceGroup): SpanEntry[] {
  const spans: SpanEntry[] = [];
  for (const span of group.spans) {
    if (isOperationSpan(span)) {
      spans.push(span);
    }
  }
  return spans;
}

function innermostContainer(
  span: SpanEntry,
  candidates: readonly SpanEntry[],
): readonly SpanEntry[] {
  let best: readonly SpanEntry[] = [];
  for (const candidate of candidates) {
    if (contains(candidate, span) === false) {
      continue;
    }
    if (tighterThan(candidate, best)) {
      best = [candidate];
    }
  }
  return best;
}

function tighterThan(candidate: SpanEntry, best: readonly SpanEntry[]): boolean {
  for (const held of best) {
    return endsAt(candidate) - startsAt(candidate) < endsAt(held) - startsAt(held);
  }
  return true;
}

function namedParent(group: TraceGroup, span: SpanEntry): readonly SpanEntry[] {
  if (span.parentModel.length === 0) {
    return [];
  }
  let best: readonly SpanEntry[] = [];
  for (const candidate of operationSpansOf(group)) {
    if (candidate === span) {
      continue;
    }
    if (candidate.model !== span.parentModel[0]) {
      continue;
    }
    if (candidate.entityId !== span.parentEntityId[0]) {
      continue;
    }
    if (contains(candidate, span) === false) {
      continue;
    }
    if (tighterThan(candidate, best)) {
      best = [candidate];
    }
  }
  return best;
}

function sortChildren(node: TreeNode): void {
  node.children = node.children.toSorted(
    (left, right) => startsAt(left.span) - startsAt(right.span),
  );
  for (const child of node.children) {
    sortChildren(child);
  }
}

export function buildTree(group: TraceGroup): { passes: TreeNode[]; loose: TreeNode[] } {
  const passes = passesOf(group);
  const operations = operationSpansOf(group);
  const nodes = new Map<number, TreeNode>();
  for (const span of group.spans) {
    nodes.set(span.seq, { span: span, children: [] });
  }

  const loose: TreeNode[] = [];
  for (const span of group.spans) {
    if (passes.includes(span)) {
      continue;
    }
    const named = namedParent(group, span);
    const parent = named.length > 0 ? named : innermostContainer(span, operations);
    for (const own of lookup(nodes, span.seq)) {
      let placed = false;
      for (const holder of parent) {
        for (const kept of lookup(nodes, holder.seq)) {
          kept.children.push(own);
          placed = true;
        }
      }
      if (placed === false) {
        loose.push(own);
      }
    }
  }

  const ordered: TreeNode[] = [];
  for (const pass of passes) {
    for (const node of lookup(nodes, pass.seq)) {
      ordered.push(node);
    }
  }
  for (const node of ordered) {
    sortChildren(node);
  }
  for (const node of loose) {
    sortChildren(node);
  }
  return {
    passes: ordered,
    loose: loose.toSorted((l, r) => startsAt(l.span) - startsAt(r.span)),
  };
}

function sourceOf(group: TraceGroup): { text: string; tone: string } {
  let attributes: Record<string, string> = {};
  let rootModel = "";
  for (const held of group.root) {
    attributes = held.attributes;
    rootModel = held.model;
  }
  const named = attributes["source"];
  if (named === "http") {
    return { text: "http request", tone: "info" };
  }
  if (named === "graphql") {
    return { text: "graphql", tone: "violet" };
  }
  if (named === "dispatcher") {
    return { text: "outbox dispatcher", tone: "warn" };
  }
  if (named === "boot") {
    return { text: "boot", tone: "" };
  }
  if (rootModel === "dispatcher") {
    return { text: "outbox dispatcher", tone: "warn" };
  }
  return { text: "direct call", tone: "" };
}

function signalOf(span: SpanEntry): string {
  const attributes = span.attributes || {};
  return attributes["signal"] || "";
}

function toneForSignal(signal: string): string {
  if (signal === "done") {
    return "ok";
  }
  if (signal === "failed") {
    return "bad";
  }
  if (signal === "running") {
    return "warn";
  }
  return "";
}

function runFor(traceId: string): readonly RunRow[] {
  for (const run of state.runs) {
    if (run.runId === traceId) {
      return [run];
    }
  }
  return [];
}

function stepRow(
  node: TreeNode,
  depth: number,
  span0: number,
  total: number,
  label: string,
): HTMLElement[] {
  const span = node.span;
  const rows: HTMLElement[] = [];
  const line = el("div", { class: "step" });
  line.appendChild(el("span", { class: "rail" }));
  line.appendChild(el("span", { class: "tick" }));
  line.appendChild(el("span", { style: "width:" + depth * 18 + "px" }));
  if (label) {
    line.appendChild(badge(label, ""));
  }
  line.appendChild(el("span", { class: "name" }, span.name));
  const signal = signalOf(span);
  if (signal) {
    line.appendChild(badge(signal, toneForSignal(signal)));
  }
  line.appendChild(el("span", { class: "grow" }));

  const took = ms(span.startedAt, span.endedAt);
  const track = el("div", { class: "bar-track" });
  const width = total > 0 ? Math.max((took / total) * 100, 1.2) : 100;
  const started = startsAt(span);
  const offset = total > 0 && isFinite(started) ? ((started - span0) / total) * 100 : 0;
  const tone = signal === "failed" ? "bad" : signal === "done" ? "ok" : "warn";
  const bar = el("div", { class: "bar " + tone });
  bar.setAttribute(
    "style",
    "left:" + Math.max(Math.min(offset, 99), 0) + "%;width:" + Math.min(width, 100) + "%",
  );
  track.appendChild(bar);
  line.appendChild(track);
  line.appendChild(el("span", { class: "meta dim mono" }, duration(took)));
  const attributes = span.attributes || {};
  const externalId = attributes["externalId"];
  if (externalId) {
    line.classList.add("openable");
    line.addEventListener("click", () => openStep(externalId));
  }
  rows.push(line);

  for (const child of node.children) {
    for (const nested of stepRow(child, depth + 1, span0, total, "")) {
      rows.push(nested);
    }
  }
  return rows;
}

function renderTrace(host: HTMLElement, group: TraceGroup): void {
  const wrap = el("div", { class: "trace" });
  const head = el("button", {
    class: "trace-head",
    "aria-expanded": state.openTraces[group.traceId] ? "true" : "false",
  });
  head.appendChild(el("span", { class: "caret" }, "▶"));

  const source = sourceOf(group);
  head.appendChild(badge(source.text, source.tone));
  let who = group.traceId;
  for (const held of group.root) {
    who = held.name;
  }
  head.appendChild(el("span", { class: "who" }, who));

  for (const run of runFor(group.traceId)) {
    head.appendChild(badge(run.phase, toneForPhase(run.phase)));
  }

  head.appendChild(el("span", { class: "grow" }));
  head.appendChild(
    el(
      "span",
      { class: "meta" },
      passesOf(group).length + " passes, " + group.spans.length + " spans",
    ),
  );
  head.appendChild(runLink(group.traceId));

  const body = el("div", {
    class: "trace-body" + (state.openTraces[group.traceId] ? " on" : ""),
  });
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
    if (isFinite(from) && from < earliest) {
      earliest = from;
    }
    if (isFinite(to) && to > latest) {
      latest = to;
    }
  }
  const total = Math.max(latest - earliest, 1);
  const tree = buildTree(group);
  let passNumber = 0;
  for (const pass of tree.passes) {
    passNumber = passNumber + 1;
    const label = tree.passes.length > 1 ? "pass " + passNumber : "";
    for (const line of stepRow(pass, 0, earliest, total, label)) {
      body.appendChild(line);
    }
  }
  for (const orphan of tree.loose) {
    for (const line of stepRow(orphan, 0, earliest, total, "dispatcher")) {
      body.appendChild(line);
    }
  }

  wrap.appendChild(head);
  wrap.appendChild(body);
  host.appendChild(wrap);
}

function matchesFilter(group: TraceGroup): boolean {
  const needle = state.filter.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  if (group.traceId.toLowerCase().includes(needle)) {
    return true;
  }
  for (const span of group.spans) {
    if (span.name.toLowerCase().includes(needle)) {
      return true;
    }
    if (span.model.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

export function renderRuns(): void {
  const host = byId("runs-body");
  const groups = traceGroups().filter(matchesFilter);
  if (groups.length === 0) {
    emptyState(
      host,
      "No operations recorded",
      "Send a request through the app and its whole tree lands here.",
    );
    return;
  }
  clear(host);
  for (const group of groups.slice(0, 120)) {
    renderTrace(host, group);
  }
}

export async function openRequest(runId: string): Promise<void> {
  state.runFilter = runId;
  show("map");
  await selectRun(runId);
  state.camera.ready = false;
  drawMap();
  fitMap();
}

function clearRunFilter(): void {
  state.runFilter = "";
  state.selectedRun = "";
  state.runTrail = { steps: [], phase: "", waiting: [], model: "" };
  state.runRows = [];
  closeStep();
  renderCrumb();
  paint();
}

export function renderCrumb(): void {
  const crumb = byId("crumb");
  if (!crumb) {
    return;
  }
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

async function selectRun(runId: string): Promise<void> {
  state.selectedRun = runId === state.selectedRun ? "" : runId;
  if (state.selectedRun.length < 1) {
    state.runTrail = { steps: [], phase: "", waiting: [], model: "" };
    state.runRows = [];
    drawMap();
    return;
  }
  const rows = await load<readonly OutboxRow[]>(
    "/api/outbox?limit=200&runId=" + encodeURIComponent(state.selectedRun),
  );
  state.runRows = rows;
  const steps = [];
  const waiting = [];
  for (const row of rows) {
    steps.push({ name: row.name, status: row.status, stepIndex: row.stepIndex });
    if (row.status === "pending") {
      waiting.push(row.name);
    }
  }
  let phase = "";
  let model = "";
  for (const run of state.runs) {
    if (run.runId !== state.selectedRun) {
      continue;
    }
    phase = run.phase;
    model = run.model;
  }
  if (model.length < 1) {
    for (const entry of rows) {
      model = entry.model;
    }
  }
  state.runTrail = { steps: steps, phase: phase, waiting: waiting, model: model };
  state.runFilter = state.selectedRun;
  renderCrumb();
  renderRequestDetail(state.selectedRun);
  drawMap();
}

export function graphPath(): string {
  return "/api/graph";
}
