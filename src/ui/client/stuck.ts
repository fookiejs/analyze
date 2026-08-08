import { badge, byId, clear, el, emptyState, runLink, state } from "./core.ts";
import { openStep } from "./detail.ts";
import { matchesSearch, renderToolbar } from "./views.ts";
import type { OutboxRow } from "./wire.ts";
import { lookup } from "./slot.ts";

const deadLetterStatus = "dead_letter";

export type StuckGroup = {
  name: string;
  reason: string;
  models: string[];
  rows: OutboxRow[];
};

function reasonOf(row: OutboxRow): string {
  if (row.error && row.error.length > 0) {
    return row.error[0] ?? "";
  }
  return "No reason was recorded";
}

function groupKeyOf(row: OutboxRow): string {
  return row.name + " → " + reasonOf(row);
}

export function stuckGroups(): StuckGroup[] {
  const byKey = new Map<string, StuckGroup>();
  const order: string[] = [];
  for (const row of state.outbox) {
    if (row.status !== deadLetterStatus) {
      continue;
    }
    if (matchesSearch([row.name, row.model, reasonOf(row)]) === false) {
      continue;
    }
    const key = groupKeyOf(row);
    if (lookup(byKey, key).length < 1) {
      byKey.set(key, { name: row.name, reason: reasonOf(row), models: [], rows: [] });
      order.push(key);
    }
    for (const group of lookup(byKey, key)) {
      if (group.models.includes(row.model) === false) {
        group.models.push(row.model);
      }
      group.rows.push(row);
    }
  }
  const built: StuckGroup[] = [];
  for (const key of order) {
    for (const group of lookup(byKey, key)) {
      built.push(group);
    }
  }
  return built.toSorted((left, right) => right.rows.length - left.rows.length);
}

export function compensatedRuns(group: StuckGroup): string[] {
  const undone: string[] = [];
  for (const row of group.rows) {
    if (rollbackOf(row.runId).length > 0 && undone.includes(row.runId) === false) {
      undone.push(row.runId);
    }
  }
  return undone;
}

function rollbackOf(runId: string): OutboxRow[] {
  const found: OutboxRow[] = [];
  for (const row of state.outbox) {
    if (row.runId !== runId) {
      continue;
    }
    if (row.compensationOf.length < 1) {
      continue;
    }
    found.push(row);
  }
  return found;
}

function stuckHeader(card: HTMLElement, group: StuckGroup): void {
  const head = el("div", { class: "stuck-head" });
  head.appendChild(el("span", { class: "stuck-count" }, String(group.rows.length)));
  const naming = el("div", { class: "stuck-naming" });
  naming.appendChild(el("div", { class: "stuck-name mono" }, group.name));
  naming.appendChild(el("div", { class: "reason" }, group.reason));
  head.appendChild(naming);
  card.appendChild(head);
}

function stuckFacts(card: HTMLElement, group: StuckGroup): void {
  const facts = el("div", { class: "stuck-facts" });
  facts.appendChild(el("span", { class: "dim" }, "on " + group.models.join(", ")));
  facts.appendChild(el("span", { class: "dim" }, attemptWording(highestAttempt(group))));
  const undone = compensatedRuns(group);
  if (undone.length === group.rows.length) {
    facts.appendChild(badge("every request rolled back", "ok"));
  }
  if (undone.length > 0 && undone.length < group.rows.length) {
    const left = group.rows.length - undone.length;
    facts.appendChild(badge(String(left) + " left without a rollback", "warn"));
  }
  if (undone.length === 0) {
    facts.appendChild(badge("nothing rolled back", "danger"));
  }
  card.appendChild(facts);
}

function attemptWording(attempts: number): string {
  if (attempts === 1) {
    return "gave up on the first attempt";
  }
  return "gave up after " + String(attempts) + " attempts";
}

function highestAttempt(group: StuckGroup): number {
  let highest = 0;
  for (const row of group.rows) {
    if (row.attempt > highest) {
      highest = row.attempt;
    }
  }
  return highest;
}

const stuckRunsShown = 8;

function stuckAffected(card: HTMLElement, group: StuckGroup): void {
  const list = el("div", { class: "stuck-runs" });
  const seen: string[] = [];
  for (const row of group.rows) {
    if (seen.length >= stuckRunsShown) {
      break;
    }
    if (seen.includes(row.runId)) {
      continue;
    }
    seen.push(row.runId);
    const line = el("div", { class: "stuck-run" });
    line.appendChild(el("span", { class: "dim mono" }, "step " + String(row.stepIndex)));
    line.appendChild(runLink(row.runId));
    const open = el("button", { class: "btn ghost" }, "why");
    open.addEventListener("click", () => openStep(row.externalId));
    line.appendChild(open);
    list.appendChild(line);
  }
  const hidden = group.rows.length - seen.length;
  if (hidden > 0) {
    list.appendChild(
      el("div", { class: "dim" }, String(hidden) + " more requests hit the same wall"),
    );
  }
  card.appendChild(list);
}

export function renderStuck(): void {
  const host = byId("stuck-body");
  const groups = stuckGroups();
  if (groups.length === 0 && state.search.length > 0) {
    emptyState(host, "Nothing stuck matches that", "Clear the search to see every dead letter.");
    return;
  }
  if (groups.length === 0) {
    emptyState(
      host,
      "Nothing is stuck",
      "A step lands here once it has exhausted its attempts and stopped retrying.",
    );
    return;
  }
  clear(host);
  renderToolbar(host, renderStuck, false);
  for (const group of groups) {
    const card = el("div", { class: "stuck" });
    stuckHeader(card, group);
    stuckFacts(card, group);
    stuckAffected(card, group);
    host.appendChild(card);
  }
}

export function stuckCount(): number {
  let total = 0;
  for (const row of state.outbox) {
    if (row.status === deadLetterStatus) {
      total = total + 1;
    }
  }
  return total;
}
