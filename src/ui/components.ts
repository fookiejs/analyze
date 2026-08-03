export function shellCss(): string {
  return `
.shell { display: grid; grid-template-columns: 216px 1fr; height: 100vh; }

.sidebar {
  border-right: 1px solid var(--border);
  background: var(--card);
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  gap: 14px;
  min-height: 0;
}

.brand { display: flex; align-items: center; gap: 9px; padding: 4px 8px 0; }
.brand-mark {
  width: 22px; height: 22px; border-radius: 6px;
  background: var(--primary); color: var(--primary-foreground);
  display: grid; place-items: center; font-size: 12px; font-weight: 700;
}
.brand-name { font-weight: 600; letter-spacing: -0.02em; }
.brand-sub { color: var(--muted-foreground); font-size: 11px; }

.nav { display: flex; flex-direction: column; gap: 2px; }
.nav-label {
  padding: 6px 8px 2px; font-size: 10.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted-foreground);
}
.nav button {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 8px; border: 0; border-radius: 6px;
  background: transparent; color: var(--muted-foreground);
  font: inherit; text-align: left; cursor: pointer;
}
.nav button:hover { background: var(--accent); color: var(--foreground); }
.nav button[aria-selected="true"] { background: var(--accent); color: var(--foreground); font-weight: 500; }
.nav .count { margin-left: auto; font-size: 11px; color: var(--muted-foreground); }

.sidebar-foot { margin-top: auto; padding: 8px; border-top: 1px solid var(--border); }
.pulse { display: inline-flex; align-items: center; gap: 7px; color: var(--muted-foreground); font-size: 11.5px; }
.pulse .dot { width: 7px; height: 7px; border-radius: 99px; background: var(--success); }
.pulse.stale .dot { background: var(--muted-foreground); }
.dropped { margin-top: 6px; font-size: 10.5px; color: var(--warning); line-height: 1.35; }

.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }

.gate {
  position: fixed; inset: 0; z-index: 20; display: none;
  align-items: center; justify-content: center;
  background: var(--background);
}
.gate.on { display: flex; }
.gate-card {
  display: flex; flex-direction: column; gap: 10px; width: 320px;
  padding: 24px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--card); box-shadow: var(--shadow-lg);
}
.gate-card h2 { margin-top: 4px; }
.gate-card .input { min-width: 0; width: 100%; height: 32px; }
.gate-card .btn { height: 32px; }

.topbar {
  display: flex; align-items: center; gap: 12px;
  padding: 13px 20px; border-bottom: 1px solid var(--border);
}
.topbar .title { display: flex; flex-direction: column; gap: 1px; }
.topbar .subtitle { color: var(--muted-foreground); font-size: 11.5px; }
.topbar .actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

.content { flex: 1; min-height: 0; overflow: auto; padding: 18px 20px 28px; }
.content.flush { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
section[hidden] { display: none; }
`.trim();
}

export function widgetCss(): string {
  return `
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; padding: 0 10px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--card); color: var(--foreground);
  font: inherit; font-size: 12.5px; cursor: pointer;
}
.btn:hover { background: var(--accent); }
.btn.icon { width: 28px; padding: 0; font-size: 14px; line-height: 1; }
.btn.ghost { border-color: transparent; background: transparent; color: var(--muted-foreground); }
.btn.ghost:hover { background: var(--accent); color: var(--foreground); }

.input {
  height: 28px; padding: 0 9px; border-radius: 6px; font: inherit; font-size: 12.5px;
  border: 1px solid var(--border); background: var(--background); color: var(--foreground);
  min-width: 190px;
}
.input::placeholder { color: var(--muted-foreground); }

.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 1px 7px; border-radius: 99px; border: 1px solid var(--border);
  background: var(--muted); color: var(--muted-foreground);
  font-size: 10.5px; font-weight: 500; letter-spacing: 0.01em; white-space: nowrap;
}
.badge .dot { width: 6px; height: 6px; border-radius: 99px; background: currentColor; }
.badge.ok { color: var(--success); border-color: color-mix(in srgb, var(--success) 35%, transparent); background: color-mix(in srgb, var(--success) 12%, transparent); }
.badge.warn { color: var(--warning); border-color: color-mix(in srgb, var(--warning) 35%, transparent); background: color-mix(in srgb, var(--warning) 12%, transparent); }
.badge.bad { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.badge.info { color: var(--info); border-color: color-mix(in srgb, var(--info) 35%, transparent); background: color-mix(in srgb, var(--info) 12%, transparent); }
.badge.violet { color: var(--violet); border-color: color-mix(in srgb, var(--violet) 35%, transparent); background: color-mix(in srgb, var(--violet) 12%, transparent); }

.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); box-shadow: var(--shadow);
}
.card-head { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
.card-body { padding: 14px; }
.card-body.tight { padding: 0; }
.card-title { font-weight: 600; }
.card-desc { color: var(--muted-foreground); font-size: 11.5px; }

.grid { display: grid; gap: 12px; }
.grid.cards { grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); }
.grid.stats { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }

.stat { padding: 12px 14px; }
.stat .k { color: var(--muted-foreground); font-size: 11px; }
.stat .v { font-size: 20px; font-weight: 600; letter-spacing: -0.02em; margin-top: 2px; }

table { border-collapse: separate; border-spacing: 0; width: 100%; }
thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; padding: 8px 12px; font-size: 11px; font-weight: 500;
  color: var(--muted-foreground); background: var(--card);
  border-bottom: 1px solid var(--border); white-space: nowrap;
}
tbody td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr.clickable { cursor: pointer; }
tbody tr.clickable:hover { background: var(--card-hover); }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.dim { color: var(--muted-foreground); }
.truncate { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty { padding: 44px 16px; text-align: center; color: var(--muted-foreground); }
.empty .big { font-size: 13px; color: var(--foreground); font-weight: 500; margin-bottom: 3px; }

.banner {
  display: none; margin-bottom: 12px; padding: 9px 12px; border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  color: var(--danger); font-size: 12.5px;
}
.banner.on { display: block; }

.kv { display: grid; grid-template-columns: 116px 1fr; gap: 6px 12px; font-size: 12.5px; }
.kv .k { color: var(--muted-foreground); }

.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
`.trim();
}

export function mapCss(): string {
  return `
.canvas-wrap { position: relative; flex: 1; min-height: 0; width: 100%; overflow: hidden; background: var(--background); }
#map-canvas { position: absolute; inset: 0; }
.canvas-wrap svg { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
.canvas-wrap svg.dragging { cursor: grabbing; }

.map-dots { fill: var(--border); }

.map-controls {
  position: absolute; left: 14px; bottom: 14px; display: flex; gap: 2px;
  padding: 4px; border-radius: 9px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--card) 90%, transparent);
  backdrop-filter: blur(8px); box-shadow: var(--shadow-lg);
}
.map-controls button[aria-selected="true"] { background: var(--accent); color: var(--foreground); }

.focus-rail {
  position: absolute; left: 14px; top: 14px; width: 182px; max-height: calc(100% - 80px);
  overflow: auto; padding: 6px; border-radius: 10px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--card) 92%, transparent);
  backdrop-filter: blur(8px); box-shadow: var(--shadow-lg);
}
.focus-rail .rail-label {
  padding: 5px 8px 3px; font-size: 9.5px; font-weight: 600; letter-spacing: 0.09em;
  text-transform: uppercase; color: var(--muted-foreground);
}
.focus-rail button {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px;
  border: 0; border-radius: 6px; background: transparent; color: var(--muted-foreground);
  font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.focus-rail button:hover { background: var(--accent); color: var(--foreground); }
.focus-rail button[aria-selected="true"] { background: var(--accent); color: var(--foreground); font-weight: 500; }
.focus-rail .tag { margin-left: auto; font-size: 10px; color: var(--muted-foreground); }
.focus-rail .badge { margin-left: auto; }
.focus-rail { width: 208px; }
.rail-waiting {
  margin: 6px 4px 2px; padding: 7px 8px; border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
}
.rail-waiting-label {
  font-size: 9px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase;
  color: var(--warning);
}
.rail-waiting-name { font-size: 11.5px; color: var(--foreground); margin-top: 2px; }

.node.run-untouched { opacity: 0.3; }
.node.run-completed rect.body { stroke: var(--success); }
.node.run-completed path.cap { fill: color-mix(in srgb, var(--success) 18%, transparent); }
.node.run-pending rect.body { stroke: var(--warning); stroke-width: 2; }
.node.run-pending path.cap { fill: color-mix(in srgb, var(--warning) 22%, transparent); }
.node.run-dead_letter rect.body { stroke: var(--danger); stroke-width: 2; }
.node.run-dead_letter path.cap { fill: color-mix(in srgb, var(--danger) 20%, transparent); }
.node.run-failed rect.body { stroke: var(--danger); }
.node.run-phase-completed path.cap { fill: color-mix(in srgb, var(--success) 16%, transparent); }
.node.run-phase-compensating path.cap { fill: color-mix(in srgb, var(--warning) 18%, transparent); }
.node.run-phase-compensated path.cap { fill: color-mix(in srgb, var(--violet) 18%, transparent); }
.node.run-phase-stuck path.cap { fill: color-mix(in srgb, var(--danger) 18%, transparent); }

.run-tag-bg { fill: var(--muted); stroke: var(--border); }
.run-tag-text {
  fill: var(--muted-foreground); font-size: 9.5px; font-weight: 600; text-anchor: middle;
}
.run-tag.completed .run-tag-bg { fill: color-mix(in srgb, var(--success) 20%, transparent); stroke: var(--success); }
.run-tag.completed .run-tag-text { fill: var(--success); }
.run-tag.pending .run-tag-bg { fill: color-mix(in srgb, var(--warning) 24%, transparent); stroke: var(--warning); }
.run-tag.pending .run-tag-text { fill: var(--warning); }
.run-tag.dead_letter .run-tag-bg { fill: color-mix(in srgb, var(--danger) 22%, transparent); stroke: var(--danger); }
.run-tag.dead_letter .run-tag-text { fill: var(--danger); }

.node rect.body { fill: var(--card); stroke: var(--border); stroke-width: 1.25; }
.node path.cap { fill: var(--muted); stroke: none; }
.node.external path.cap { fill: color-mix(in srgb, var(--warning) 14%, transparent); }
.node.model path.cap { fill: color-mix(in srgb, var(--info) 12%, transparent); }
.node text.label { fill: var(--foreground); font-size: 15px; font-weight: 600; }
.node text.sub { fill: var(--muted-foreground); font-size: 11px; }
.node line.divider { stroke: var(--border); stroke-width: 1; }
.node text.section-label {
  fill: var(--muted-foreground); font-size: 9px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.09em;
}
.field text.field-key { fill: var(--foreground); font-size: 12px; }
.field text.field-detail { fill: var(--muted-foreground); font-size: 11px; text-anchor: end; }
.field.relation text.field-detail { fill: var(--violet); }
.node.faded { opacity: 0.28; }

.port rect.hit { fill: transparent; cursor: pointer; }
.port:hover rect.hit { fill: var(--accent); }
.port.lit rect.hit { fill: color-mix(in srgb, var(--info) 14%, transparent); }
.port text.port-label { fill: var(--muted-foreground); font-size: 13px; }
.port.active text.port-label { fill: var(--foreground); font-weight: 600; }
.port.lit text.port-label { fill: var(--info); }
.port text.port-detail { fill: var(--muted-foreground); font-size: 10.5px; text-anchor: end; }
.port:not(.active) text.port-detail { opacity: 0.6; }
.port circle.port-dot { fill: var(--background); stroke: var(--border); stroke-width: 1.5; }
.port.active circle.port-dot.out { fill: var(--info); stroke: var(--info); }
.port.lit circle.port-dot { fill: var(--info); stroke: var(--info); }
.port circle.port-dot.in { opacity: 0; }
.port.lit circle.port-dot.in { opacity: 1; }

.edge { fill: none; stroke: var(--muted-foreground); opacity: 0.5; }
.edge.relation { stroke: var(--violet); stroke-dasharray: 5 4; }
.edge.invokes { stroke: var(--info); }
.edge.compensates { stroke: var(--warning); stroke-dasharray: 2 3; }
.edge.nests { stroke: var(--success); }
.edge.faded { opacity: 0.07; }
.edge.lit { opacity: 1; stroke-width: 2.2; }

.arrow { stroke: none; }
.arrow.relation { fill: var(--violet); }
.arrow.invokes { fill: var(--info); }
.arrow.compensates { fill: var(--warning); }
.arrow.nests { fill: var(--success); }

.edge-label {
  fill: var(--muted-foreground); font-size: 10px; font-weight: 600;
  paint-order: stroke; stroke: var(--background); stroke-width: 4px; stroke-linejoin: round;
  pointer-events: none; text-anchor: middle;
}
.edge-label.faded { opacity: 0.08; }
.edge-label.lit { fill: var(--info); }

.inspector {
  position: absolute; right: 0; top: 0; bottom: 0; width: 340px;
  border-left: 1px solid var(--border); background: var(--card);
  box-shadow: var(--shadow-lg); overflow: auto; padding: 14px;
  display: none;
}
.inspector.on { display: block; }
.inspector-head { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.inspector-head .grow { flex: 1; min-width: 0; }
.inspector h3 { margin: 16px 0 7px; color: var(--muted-foreground); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; }
.inspector h3:first-of-type { margin-top: 0; }

.flow-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
  cursor: pointer; font-size: 12px;
}
.flow-row:hover { background: var(--accent); }
.flow-row.on { background: color-mix(in srgb, var(--info) 12%, transparent); }
`.trim();
}

export function treeCss(): string {
  return `
.trace { border-bottom: 1px solid var(--border); }
.trace:last-child { border-bottom: 0; }
.trace-head {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 9px 12px; background: transparent; border: 0; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.trace-head:hover { background: var(--card-hover); }
.trace-head .caret { width: 11px; color: var(--muted-foreground); font-size: 9px; transition: transform 120ms; }
.trace-head[aria-expanded="true"] .caret { transform: rotate(90deg); }
.trace-head .who { font-weight: 500; }
.trace-head .grow { flex: 1; min-width: 0; }
.trace-head .meta { color: var(--muted-foreground); font-size: 11.5px; }

.trace-body { display: none; padding: 2px 12px 12px 34px; }
.trace-body.on { display: block; }

.step { display: flex; align-items: center; gap: 8px; padding: 5px 0; position: relative; }
.step .rail { position: absolute; left: -14px; top: 0; bottom: 0; width: 1px; background: var(--border); }
.step .tick { position: absolute; left: -14px; top: 14px; width: 10px; height: 1px; background: var(--border); }
.step .name { font-weight: 500; }
.step .grow { flex: 1; }
.bar { height: 5px; border-radius: 99px; background: var(--info); opacity: 0.75; min-width: 3px; }
.bar.ok { background: var(--success); }
.bar.bad { background: var(--danger); }
.bar.warn { background: var(--warning); }
.bar-track { flex: 1; max-width: 320px; height: 5px; border-radius: 99px; background: var(--muted); position: relative; }
.bar-track .bar { position: absolute; top: 0; }
`.trim();
}
