import { mapCss, shellCss, treeCss, widgetCss } from "./components.ts";
import { clientCoreJs } from "./client-core.ts";
import { clientMapJs } from "./client-map.ts";
import { clientViewsJs } from "./client-views.ts";
import { themeCss } from "./theme.ts";
import { AnalyzeError } from "../errors.ts";

export function stylesCss(): string {
  const sheets = [themeCss(), shellCss(), widgetCss(), mapCss(), treeCss()];
  for (const sheet of sheets) {
    if (sheet.length < 1) {
      throw AnalyzeError.create("every stylesheet must carry rules");
    }
  }
  const joined = sheets.join("\n\n");
  if (joined.includes("--background") === false) {
    throw AnalyzeError.create("the theme must define its tokens");
  }
  return joined;
}

export function clientJs(): string {
  const parts = [clientCoreJs(), clientMapJs(), clientViewsJs()];
  for (const part of parts) {
    if (part.length < 1) {
      throw AnalyzeError.create("every client module must carry code");
    }
    if (part.includes("</script") === true) {
      throw AnalyzeError.create("client code may not close its own script tag");
    }
  }
  return parts.join("\n\n");
}

function navItem(view: string, label: string, countId: string): string {
  if (/^[a-z]+$/.test(view) === false) {
    throw AnalyzeError.create("nav view names are lower case letters only");
  }
  if (/^[a-z0-9-]+$/.test(countId) === false) {
    throw AnalyzeError.create("nav count ids are slugs only");
  }
  const badge = `<span class="count" id="${countId}">0</span>`;
  return `<button data-view="${view}" aria-selected="false">${label}${badge}</button>`;
}

function sidebarHtml(): string {
  return `<aside class="sidebar">
<div class="brand">
<div class="brand-mark">f</div>
<div>
<div class="brand-name">fookie</div>
<div class="brand-sub">analyze</div>
</div>
</div>
<nav class="nav">
<div class="nav-label">Overview</div>
${navItem("map", "Map", "count-models")}
${navItem("models", "Models", "count-models-2")}
<div class="nav-label">Activity</div>
${navItem("runs", "Operations", "count-runs")}
${navItem("outbox", "Outbox", "count-outbox")}
${navItem("logs", "Logs", "count-logs")}
</nav>
<div class="sidebar-foot">
<span class="pulse" id="pulse"><span class="dot"></span><span id="pulse-text">connecting</span></span>
</div>
</aside>`;
}

function topbarHtml(): string {
  return `<header class="topbar">
<div class="title">
<h1 id="view-title">Application map</h1>
<div class="subtitle" id="view-subtitle">Declared relations and the calls actually observed</div>
</div>
<div class="actions">
<div id="runs-actions" hidden><input class="input" id="runs-filter" placeholder="Filter by model, span or run id" /></div>
<div id="map-actions" class="actions">
<button class="btn icon" id="zoom-out" title="Zoom out">&#8722;</button>
<button class="btn ghost" id="zoom-readout" title="Current zoom">100%</button>
<button class="btn icon" id="zoom-in" title="Zoom in">+</button>
<button class="btn" id="zoom-fit" title="Fit the whole map">Fit</button>
</div>
</div>
</header>`;
}

function mapViewHtml(): string {
  return `<section id="view-map" class="canvas-wrap">
<div id="map-canvas"></div>
<div class="map-legend">
<div class="row"><span class="swatch rel"></span><span><b>declared relation.</b> The arrow starts at the model that stores the column and points at the model it refers to.</span></div>
<div class="row"><span class="swatch inv"></span><span><b>observed call.</b> That flow really called that external, and the label says in which step.</span></div>
<div class="row"><span class="swatch comp"></span><span><b>compensation.</b> If the saga rolls back, the first external is undone by the second.</span></div>
<div class="row"><span class="swatch nest"></span><span><b>observed nesting.</b> The first model started an operation on the second inside its own flow.</span></div>
</div>
<div class="map-controls">
<span class="dim" style="padding:4px 8px;font-size:11px">drag to pan &middot; scroll to zoom &middot; click a node</span>
</div>
<div class="map-hint">press f to fit</div>
<div class="inspector" id="inspector"></div>
</section>`;
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
<div class="shell">
${sidebarHtml()}
<div class="main">
${topbarHtml()}
<div class="content flush" id="content">
<div class="banner" id="banner"></div>
${mapViewHtml()}
<section id="view-models" hidden><div id="models-body"></div></section>
<section id="view-runs" hidden><div class="card"><div id="runs-body"></div></div></section>
<section id="view-outbox" hidden><div class="card"><div id="outbox-body"></div></div></section>
<section id="view-logs" hidden><div class="card"><div id="logs-body"></div></div></section>
</div>
</div>
</div>
<script nonce="${pageNonce}">${clientJs()}</script>
</body>
</html>`;
}
