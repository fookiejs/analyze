export function clientStuckJs(): string {
  return `
const deadLetterStatus = "dead_letter";

function reasonOf(row) {
  if (row.error && row.error.length > 0) { return row.error[0]; }
  return "No reason was recorded";
}

function groupKeyOf(row) {
  return row.name + " \\u2192 " + reasonOf(row);
}

function stuckGroups() {
  const byKey = {};
  const order = [];
  for (const row of state.outbox) {
    if (row.status !== deadLetterStatus) { continue; }
    if (matchesSearch([row.name, row.model, reasonOf(row)]) === false) { continue; }
    const key = groupKeyOf(row);
    if (byKey[key] === undefined) {
      byKey[key] = { name: row.name, reason: reasonOf(row), models: [], rows: [] };
      order.push(key);
    }
    const group = byKey[key];
    if (group.models.includes(row.model) === false) { group.models.push(row.model); }
    group.rows.push(row);
  }
  const built = [];
  for (const key of order) { built.push(byKey[key]); }
  return built.toSorted((left, right) => right.rows.length - left.rows.length);
}

function compensatedRuns(group) {
  const undone = [];
  for (const row of group.rows) {
    if (rollbackOf(row.runId).length > 0 && undone.includes(row.runId) === false) {
      undone.push(row.runId);
    }
  }
  return undone;
}

function rollbackOf(runId) {
  const found = [];
  for (const row of state.outbox) {
    if (row.runId !== runId) { continue; }
    if (row.compensationOf.length < 1) { continue; }
    found.push(row);
  }
  return found;
}

function stuckHeader(card, group) {
  const head = el("div", { class: "stuck-head" });
  head.appendChild(el("span", { class: "stuck-count" }, String(group.rows.length)));
  const naming = el("div", { class: "stuck-naming" });
  naming.appendChild(el("div", { class: "stuck-name mono" }, group.name));
  naming.appendChild(el("div", { class: "reason" }, group.reason));
  head.appendChild(naming);
  card.appendChild(head);
}

function stuckFacts(card, group) {
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

function attemptWording(attempts) {
  if (attempts === 1) { return "gave up on the first attempt"; }
  return "gave up after " + String(attempts) + " attempts";
}

function highestAttempt(group) {
  let highest = 0;
  for (const row of group.rows) {
    if (row.attempt > highest) { highest = row.attempt; }
  }
  return highest;
}

const stuckRunsShown = 8;

function stuckAffected(card, group) {
  const list = el("div", { class: "stuck-runs" });
  const seen = [];
  for (const row of group.rows) {
    if (seen.length >= stuckRunsShown) { break; }
    if (seen.includes(row.runId)) { continue; }
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
    list.appendChild(el("div", { class: "dim" }, String(hidden) + " more requests hit the same wall"));
  }
  card.appendChild(list);
}

function renderStuck() {
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

function stuckCount() {
  let total = 0;
  for (const row of state.outbox) {
    if (row.status === deadLetterStatus) { total = total + 1; }
  }
  return total;
}
`;
}
