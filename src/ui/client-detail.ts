export function clientDetailJs(): string {
  return `
function jsonBlock(value) {
  const box = el("pre", { class: "json" });
  try {
    box.textContent = JSON.stringify(value, null, 2);
  } catch (err) {
    void err;
    box.textContent = String(value);
  }
  return box;
}

function stepRowsFor(externalId) {
  const found = [];
  for (const row of state.runRows) {
    if (row.externalId === externalId) { found.push(row); }
  }
  for (const row of state.outbox) {
    if (row.externalId !== externalId) { continue; }
    let known = false;
    for (const hit of found) { if (hit.externalId === externalId) { known = true; } }
    if (known === false) { found.push(row); }
  }
  return found;
}

function spanForExternal(externalId) {
  for (const span of state.obs.spans) {
    const attributes = span.attributes || {};
    if (attributes.externalId === externalId) { return span; }
  }
  return null;
}

function logsForRun(runId) {
  const found = [];
  for (const entry of state.obs.logs) {
    if (entry.traceId !== runId) { continue; }
    found.push(entry);
  }
  return found.toReversed().slice(0, 20);
}

function closeStep() {
  state.selectedStep = "";
  const panel = byId("detail");
  panel.classList.remove("on");
  clear(panel);
}

function openStep(externalId) {
  state.selectedStep = externalId;
  renderStepDetail();
}

function detailHead(panel, row) {
  const head = el("div", { class: "inspector-head" });
  const grow = el("div", { class: "grow" });
  grow.appendChild(el("h2", {}, row.name));
  grow.appendChild(el("div", { class: "card-desc mono" }, shortId(row.externalId)));
  head.appendChild(grow);
  const close = el("button", { class: "btn icon ghost", title: "Close" }, "\\u00d7");
  close.addEventListener("click", () => closeStep());
  head.appendChild(close);
  panel.appendChild(head);

  const chips = el("div", { class: "chips" });
  chips.appendChild(badge(row.status, toneForStatus(row.status)));
  chips.appendChild(badge("attempt " + String(row.attempt), row.attempt > 1 ? "warn" : ""));
  chips.appendChild(badge("step " + String(row.stepIndex), ""));
  if (row.compensationOf && row.compensationOf.length > 0) {
    chips.appendChild(badge("undoes a step", "violet"));
  }
  panel.appendChild(chips);
}

function renderStepDetail() {
  const panel = byId("detail");
  if (!panel) { return; }
  if (state.selectedStep.length < 1) { closeStep(); return; }
  const rows = stepRowsFor(state.selectedStep);
  if (rows.length < 1) {
    clear(panel);
    panel.classList.add("on");
    emptyState(panel, "That step is no longer listed", "Fetch the request again to bring its rows back.");
    return;
  }
  clear(panel);
  panel.classList.add("on");

  for (const row of rows.slice(0, 1)) {
    detailHead(panel, row);

    if (row.error && row.error.length > 0) {
      panel.appendChild(el("h3", {}, "Why it failed"));
      const reason = el("div", { class: "reason" });
      for (const line of row.error) { reason.appendChild(el("div", {}, line)); }
      panel.appendChild(reason);
    }

    const span = spanForExternal(row.externalId);
    if (span) {
      panel.appendChild(el("h3", {}, "Timing"));
      const kv = el("div", { class: "kv" });
      kv.appendChild(el("div", { class: "k" }, "started"));
      kv.appendChild(el("div", { class: "mono" }, clock(span.startedAt)));
      kv.appendChild(el("div", { class: "k" }, "took"));
      kv.appendChild(el("div", { class: "mono" }, duration(ms(span.startedAt, span.endedAt))));
      panel.appendChild(kv);
    }

    panel.appendChild(el("h3", {}, "Input it was given"));
    panel.appendChild(jsonBlock(row.input));

    if (row.output && row.output.length > 0) {
      panel.appendChild(el("h3", {}, "Output it returned"));
      for (const carried of row.output) { panel.appendChild(jsonBlock(carried)); }
    }

    panel.appendChild(el("h3", {}, "Request"));
    const link = el("div", {});
    link.appendChild(runLink(row.runId));
    panel.appendChild(link);

    const lines = logsForRun(row.runId);
    if (lines.length > 0) {
      panel.appendChild(el("h3", {}, "What the flow logged"));
      for (const entry of lines) {
        const line = el("div", { class: "log-line" });
        line.appendChild(badge(entry.level, toneForLevel(entry.level)));
        line.appendChild(el("span", {}, entry.message));
        panel.appendChild(line);
      }
    }
  }
}

function requestBodyOf(runId) {
  for (const run of state.runs) {
    if (run.runId !== runId) { continue; }
    return [run.body];
  }
  return [];
}

function renderRequestDetail(runId) {
  const panel = byId("detail");
  if (!panel) { return; }
  clear(panel);
  panel.classList.add("on");
  state.selectedStep = "";

  const head = el("div", { class: "inspector-head" });
  const grow = el("div", { class: "grow" });
  grow.appendChild(el("h2", {}, "Request"));
  grow.appendChild(el("div", { class: "card-desc mono" }, shortId(runId)));
  head.appendChild(grow);
  const close = el("button", { class: "btn icon ghost", title: "Close" }, "\\u00d7");
  close.addEventListener("click", () => closeStep());
  head.appendChild(close);
  panel.appendChild(head);

  if (state.runTrail.phase) {
    const chips = el("div", { class: "chips" });
    chips.appendChild(badge(state.runTrail.phase, toneForPhase(state.runTrail.phase)));
    if (state.runTrail.model) { chips.appendChild(badge(state.runTrail.model, "info")); }
    panel.appendChild(chips);
  }

  const bodies = requestBodyOf(runId);
  if (bodies.length > 0) {
    panel.appendChild(el("h3", {}, "What was asked for"));
    for (const body of bodies) { panel.appendChild(jsonBlock(body)); }
  }

  panel.appendChild(el("h3", {}, "Steps"));
  const host = el("div", {});
  tableOf(host, ["External", "Status", "Attempt"], state.runRows, (row) => {
    const line = el("tr", { class: "clickable" });
    cell(line, row.name);
    cell(line, badge(row.status, toneForStatus(row.status)));
    cell(line, String(row.attempt), "num");
    line.addEventListener("click", () => openStep(row.externalId));
    return line;
  });
  panel.appendChild(host);
}
`.trim();
}
