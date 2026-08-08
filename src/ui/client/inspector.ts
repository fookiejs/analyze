import { badge, byId, cell, clear, el, state, tableOf, toneForStatus } from "./core.ts";
import { modelNamed, nodesById, selectPort } from "./map.ts";
import { paint, show } from "./views.ts";
import type { ExternalSummary, PlacedNode } from "./wire.ts";
import { lookup } from "./slot.ts";

function externalNamed(name: string): readonly ExternalSummary[] {
  for (const external of state.externals) {
    if (external.name === name) {
      return [external];
    }
  }
  return [];
}

function metricsForModel(name: string): { name: string; value: number }[] {
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const entry of state.obs.metrics) {
    if (entry.model !== name) {
      continue;
    }
    const seen = lookup(totals, entry.name);
    if (seen.length < 1) {
      totals.set(entry.name, entry.value);
      order.push(entry.name);
      continue;
    }
    for (const held of seen) {
      totals.set(entry.name, held + entry.value);
    }
  }
  const built: { name: string; value: number }[] = [];
  for (const key of order) {
    for (const value of lookup(totals, key)) {
      built.push({ name: key, value });
    }
  }
  return built;
}

function openFiltered(view: string, model: string): void {
  state.search = model;
  state.troubleOnly = false;
  state.page = 0;
  state.runFilter = "";
  show(view);
  paint();
}

function jumpRow(panel: HTMLElement, label: string, view: string, model: string): void {
  const row = el("button", { class: "btn ghost jump" }, label);
  row.addEventListener("click", () => openFiltered(view, model));
  panel.appendChild(row);
}

function modelActivity(panel: HTMLElement, name: string): void {
  const counters = metricsForModel(name);
  panel.appendChild(el("h3", {}, "Counted here"));
  if (counters.length === 0) {
    panel.appendChild(el("div", { class: "dim" }, "Nothing counted yet."));
  }
  for (const counter of counters) {
    const row = el("div", { class: "meter" });
    row.appendChild(el("span", {}, counter.name));
    row.appendChild(el("span", { class: "meter-value mono" }, String(counter.value)));
    panel.appendChild(row);
  }

  panel.appendChild(el("h3", {}, "Look at it in full"));
  panel.appendChild(
    el(
      "div",
      { class: "dim card-desc" },
      "The listings page and filters beat a short list in a side panel.",
    ),
  );
  jumpRow(panel, "Operations on " + name, "runs", name);
  jumpRow(panel, "Logs from " + name, "logs", name);
  jumpRow(panel, "Outbox for " + name, "outbox", name);
}

export function renderInspector(): void {
  const panel = byId("inspector");
  if (!state.selectedNode) {
    panel.classList.remove("on");
    clear(panel);
    return;
  }
  clear(panel);
  panel.classList.add("on");

  for (const node of lookup(nodesById(), state.selectedNode)) {
    const head = el("div", { class: "inspector-head" });
    const grow = el("div", { class: "grow" });
    grow.appendChild(el("h2", {}, node.label));
    grow.appendChild(el("div", { class: "card-desc mono" }, node.subtitle));
    head.appendChild(grow);
    const close = el("button", { class: "btn icon ghost", title: "Close" }, "×");
    close.addEventListener("click", () => selectPort(""));
    head.appendChild(close);
    panel.appendChild(head);

    const parts = state.selectedPort.split("#");
    const port = parts.length > 1 ? (parts[1] ?? "") : "";
    if (node.kind === "model") {
      inspectModel(panel, node, port);
    } else {
      inspectExternal(panel, node.label);
    }
  }
}

function inspectModel(panel: HTMLElement, node: PlacedNode, port: string): void {
  for (const model of modelNamed(node.label)) {
    panel.appendChild(el("h3", {}, "Flows"));
    for (const flow of node.ports) {
      const row = el("div", { class: "flow-row" + (flow.id === port ? " on" : "") });
      row.appendChild(badge(flow.label, flow.active ? "info" : ""));
      row.appendChild(
        el("span", { class: flow.active ? "" : "dim" }, flow.detail || "calls nothing"),
      );
      row.addEventListener("click", () => selectPort(node.id + "#" + flow.id));
      panel.appendChild(row);
    }

    modelActivity(panel, node.label);

    panel.appendChild(el("h3", {}, "Fields"));
    const host = el("div", {});
    tableOf(host, ["Field", "Type", ""], model.fields, (field) => {
      const row = el("tr", {});
      cell(row, field.key);
      cell(row, el("span", { class: "mono dim" }, field.pgType));
      const flags = el("div", { class: "chips" });
      if (field.relation.length > 0) {
        flags.appendChild(badge("→ " + field.relation[0], "violet"));
      }
      if (field.unique) {
        flags.appendChild(badge("unique", "info"));
      }
      if (field.index && !field.unique) {
        flags.appendChild(badge("index", ""));
      }
      cell(row, flags);
      return row;
    });
    panel.appendChild(host);
  }
}

function inspectExternal(panel: HTMLElement, name: string): void {
  for (const external of externalNamed(name)) {
    panel.appendChild(el("h3", {}, "Delivery"));
    const kv = el("div", { class: "kv" });
    kv.appendChild(el("div", { class: "k" }, "attempts"));
    kv.appendChild(el("div", {}, String(external.attempts)));
    kv.appendChild(el("div", { class: "k" }, "backoff"));
    kv.appendChild(el("div", {}, external.backoff));
    kv.appendChild(el("div", { class: "k" }, "timeout"));
    kv.appendChild(el("div", {}, external.timeoutMs + "ms"));
    kv.appendChild(el("div", { class: "k" }, "undone by"));
    kv.appendChild(
      el("div", {}, external.compensate.length > 0 ? external.compensate[0] : "nothing"),
    );
    panel.appendChild(kv);

    panel.appendChild(el("h3", {}, "Payload"));
    const chips = el("div", { class: "chips" });
    for (const key of external.inputKeys) {
      chips.appendChild(badge("in " + key, "info"));
    }
    for (const key of external.outputKeys) {
      chips.appendChild(badge("out " + key, "ok"));
    }
    panel.appendChild(chips);

    panel.appendChild(el("h3", {}, "Traffic"));
    const counts = outboxCountsFor(name);
    const traffic = el("div", { class: "chips" });
    const entries = Object.entries(counts);
    if (entries.length === 0) {
      traffic.appendChild(el("span", { class: "dim" }, "No calls recorded yet."));
    }
    for (const [key, total] of entries) {
      traffic.appendChild(badge(key + " " + total, toneForStatus(key)));
    }
    panel.appendChild(traffic);
  }
}

function outboxCountsFor(name: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of state.outbox) {
    if (row.name !== name) {
      continue;
    }
    let total = 0;
    for (const held of lookup(counts, row.status)) {
      total = held;
    }
    counts.set(row.status, total + 1);
  }
  return counts;
}
