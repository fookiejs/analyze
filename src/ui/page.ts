export function stylesCss(): string {
  return `
:root { color-scheme: light dark; --line: #8883; --ink: #111; --bg: #fff; --muted: #666; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8e8e8; --bg: #16181c; --muted: #9aa; } }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: var(--ink); background: var(--bg); }
header { padding: 12px 18px; border-bottom: 1px solid var(--line); display: flex; gap: 18px; align-items: baseline; }
h1 { font-size: 15px; margin: 0; font-weight: 600; }
nav button { font: inherit; background: none; border: 0; color: var(--muted); cursor: pointer; padding: 4px 8px; border-radius: 6px; }
nav button[aria-selected="true"] { color: var(--ink); background: var(--line); }
main { padding: 18px; }
section[hidden] { display: none; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 500; }
.gap { color: #c0392b; padding: 8px 0; }
.note { color: var(--muted); padding-bottom: 10px; }
svg { max-width: 100%; border: 1px solid var(--line); border-radius: 8px; }
.node rect { fill: var(--bg); stroke: var(--ink); stroke-width: 1; }
.node.external rect { stroke-dasharray: 4 3; }
.node text { font-size: 12px; fill: var(--ink); }
.edge { fill: none; stroke: var(--muted); }
.edge.relation { stroke-dasharray: 5 4; }
.legend { color: var(--muted); padding: 8px 0; display: flex; gap: 16px; }
`.trim();
}

export function clientJs(): string {
  return `
const token = new URLSearchParams(location.search).get("token") || "";
const headers = token ? { "x-analyze-token": token } : {};
const NS = "http://www.w3.org/2000/svg";

async function load(path) {
  const res = await fetch(path, { headers });
  if (!res.ok) { throw new Error(path + " -> " + res.status); }
  return await res.json();
}

function el(tag, attrs, text) {
  const node = document.createElementNS(NS, tag);
  for (const key of Object.keys(attrs || {})) { node.setAttribute(key, attrs[key]); }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function cell(row, value) {
  const td = document.createElement("td");
  td.textContent = value === undefined || value === null ? "" : String(value);
  row.appendChild(td);
}

function table(host, columns, rows, pick) {
  host.replaceChildren();
  const t = document.createElement("table");
  const head = document.createElement("tr");
  for (const name of columns) {
    const th = document.createElement("th");
    th.textContent = name;
    head.appendChild(th);
  }
  t.appendChild(head);
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of pick(row)) { cell(tr, value); }
    t.appendChild(tr);
  }
  host.appendChild(t);
}

function drawGraph(host, layout) {
  host.replaceChildren();
  if (!layout.nodes.length) { return; }
  const pad = 24;
  const svg = el("svg", {
    viewBox: [-pad, -pad, layout.width + pad * 2, layout.height + pad * 2].join(" "),
    height: Math.min(layout.height + pad * 2, 620),
  });
  const byId = {};
  for (const node of layout.nodes) { byId[node.id] = node; }
  for (const edge of layout.edges) {
    const from = byId[edge.from];
    const to = byId[edge.to];
    if (!from || !to) { continue; }
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const mid = (x1 + x2) / 2;
    svg.appendChild(el("path", {
      class: "edge " + edge.kind,
      "stroke-width": String(Math.min(1 + Math.log(edge.weight + 1), 4)),
      d: ["M", x1, y1, "C", mid, y1, mid, y2, x2, y2].join(" "),
    }));
  }
  for (const node of layout.nodes) {
    const group = el("g", { class: "node " + node.kind });
    group.appendChild(el("rect", { x: node.x, y: node.y, width: node.width, height: node.height, rx: 8 }));
    group.appendChild(el("text", { x: node.x + 12, y: node.y + 24 }, node.label));
    group.appendChild(el("text", { x: node.x + 12, y: node.y + 42, class: "kind" }, node.kind));
    svg.appendChild(group);
  }
  host.appendChild(svg);
}

const views = {
  async map() {
    const layout = await load("/api/graph");
    drawGraph(document.getElementById("graph"), layout);
  },
  async runs() {
    const rows = await load("/api/runs?limit=100");
    table(document.getElementById("runs-table"), ["run", "model", "operation", "phase", "updated"], rows,
      (r) => [r.runId, r.model, r.operation, r.phase, (r.updatedAt || [])[0]]);
  },
  async outbox() {
    const rows = await load("/api/outbox?limit=100");
    table(document.getElementById("outbox-table"), ["external", "model", "name", "status", "attempt"], rows,
      (r) => [r.externalId, r.model, r.name, r.status, r.attempt]);
  },
  async logs() {
    const page = await load("/api/obs?since=0");
    const host = document.getElementById("logs-table");
    table(host, ["seq", "level", "model", "operation", "message"], page.logs,
      (r) => [r.seq, r.level, r.model, r.operation, r.message]);
  },
};

function show(name) {
  for (const section of document.querySelectorAll("section")) {
    section.hidden = section.id !== "view-" + name;
  }
  for (const button of document.querySelectorAll("nav button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  }
  views[name]().catch((err) => {
    const banner = document.getElementById("error");
    banner.textContent = String(err.message || err);
  });
}

for (const button of document.querySelectorAll("nav button")) {
  button.addEventListener("click", () => show(button.dataset.view));
}
show("map");

const stream = new EventSource("/api/stream" + (token ? "?token=" + encodeURIComponent(token) : ""));
stream.addEventListener("tick", () => {
  const active = document.querySelector("nav button[aria-selected='true']");
  if (active) { show(active.dataset.view); }
});
`.trim();
}

export function indexHtml(pageNonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fookie analyze</title>
<style nonce="${pageNonce}">${stylesCss()}</style>
</head>
<body>
<header>
<h1>fookie analyze</h1>
<nav>
<button data-view="map" aria-selected="true">Map</button>
<button data-view="runs" aria-selected="false">Runs</button>
<button data-view="outbox" aria-selected="false">Outbox</button>
<button data-view="logs" aria-selected="false">Logs</button>
</nav>
</header>
<main>
<p class="gap" id="error"></p>
<section id="view-map">
<p class="note">Solid edges were observed. Dashed edges are declared relations, which describe the data model rather than the call graph.</p>
<div class="legend"><span>model</span><span>external (dashed border)</span><span>relation (dashed line)</span><span>invokes / nests (solid)</span></div>
<div id="graph"></div>
</section>
<section id="view-runs" hidden><div id="runs-table"></div></section>
<section id="view-outbox" hidden><div id="outbox-table"></div></section>
<section id="view-logs" hidden><div id="logs-table"></div></section>
</main>
<script nonce="${pageNonce}">${clientJs()}</script>
</body>
</html>`;
}
