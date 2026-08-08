import { state, svgEl } from "./core.ts";
import {
  CARD_HEADER,
  FIELD_ROW,
  PORT_ROW,
  SECTION_HEAD,
  nodeIsLit,
  portKey,
  selectPort,
} from "./map.ts";
import type { Trail } from "./map.ts";
import type { GraphPort, PlacedNode } from "./wire.ts";

function portRow(
  node: PlacedNode,
  port: GraphPort,
  at: number,
  trail: readonly Trail[],
): SVGGElement {
  const y = node.y + CARD_HEADER + at * PORT_ROW;
  const mid = y + PORT_ROW / 2;
  const key = portKey(node.id, port.id);
  let lit = "";
  for (const shown of trail) {
    lit = shown.ports[key] === true ? " lit" : "";
  }
  const row = svgEl("g", { class: "port" + (port.active ? " active" : "") + lit });
  row.appendChild(
    svgEl("rect", {
      class: "hit",
      x: node.x + 1,
      y: y + 1,
      width: node.width - 2,
      height: PORT_ROW - 2,
      rx: "5",
    }),
  );
  row.appendChild(svgEl("text", { class: "port-label", x: node.x + 18, y: mid + 4.5 }, port.label));
  if (port.detail) {
    row.appendChild(
      svgEl(
        "text",
        { class: "port-detail", x: node.x + node.width - 18, y: mid + 4.5 },
        port.detail,
      ),
    );
  }
  if (port.active) {
    row.appendChild(
      svgEl("circle", { class: "port-dot out", cx: node.x + node.width, cy: mid, r: "4" }),
    );
  }
  row.appendChild(svgEl("circle", { class: "port-dot in", cx: node.x, cy: mid, r: "4" }));
  row.addEventListener("click", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    selectPort(key);
  });
  return row;
}

function fieldRows(node: PlacedNode): SVGGElement[] {
  const rows: SVGGElement[] = [];
  if (node.fields.length === 0) {
    return rows;
  }
  const top = node.y + CARD_HEADER + node.ports.length * PORT_ROW;
  let at = 0;
  if (node.ports.length > 0) {
    const head = svgEl("g", { class: "fields-head" });
    head.appendChild(
      svgEl("line", { class: "divider", x1: node.x, y1: top, x2: node.x + node.width, y2: top }),
    );
    head.appendChild(
      svgEl("text", { class: "section-label", x: node.x + 18, y: top + 16 }, "fields"),
    );
    rows.push(head);
  } else {
    const head = svgEl("g", { class: "fields-head" });
    head.appendChild(
      svgEl("line", { class: "divider", x1: node.x, y1: top, x2: node.x + node.width, y2: top }),
    );
    rows.push(head);
  }
  const bodyTop = node.ports.length > 0 ? top + SECTION_HEAD : top;
  for (const field of node.fields) {
    const y = bodyTop + at * FIELD_ROW;
    const line = svgEl("g", { class: "field" + (field.relation.length > 0 ? " relation" : "") });
    line.appendChild(svgEl("text", { class: "field-key", x: node.x + 18, y: y + 16 }, field.key));
    line.appendChild(
      svgEl(
        "text",
        { class: "field-detail", x: node.x + node.width - 18, y: y + 16 },
        field.detail,
      ),
    );
    if (field.relation.length > 0) {
      line.appendChild(
        svgEl("circle", {
          class: "port-dot out",
          cx: node.x + node.width,
          cy: y + FIELD_ROW / 2,
          r: "3.5",
        }),
      );
    }
    rows.push(line);
    at = at + 1;
  }
  return rows;
}

export function externalNodeIdOf(name: string): string {
  return "external:" + name;
}

function runStatusOf(node: PlacedNode): string {
  if (!state.selectedRun) {
    return "";
  }
  for (const step of state.runTrail.steps) {
    if (externalNodeIdOf(step.name) !== node.id) {
      continue;
    }
    return step.status;
  }
  if (node.kind === "model") {
    if (node.label !== state.runTrail.model) {
      return "untouched";
    }
    return state.runTrail.phase ? "phase-" + state.runTrail.phase : "";
  }
  return "untouched";
}

function statusBadge(node: PlacedNode, status: string): readonly SVGGElement[] {
  if (!status || status === "untouched") {
    return [];
  }
  const label = status.indexOf("phase-") === 0 ? status.slice(6) : status.replace("_", " ");
  const group = svgEl("g", { class: "run-tag " + status });
  const width = 8 + label.length * 6.2;
  group.appendChild(
    svgEl("rect", {
      class: "run-tag-bg",
      x: node.x + node.width - width - 12,
      y: node.y + 10,
      width: width,
      height: 17,
      rx: "8",
    }),
  );
  group.appendChild(
    svgEl(
      "text",
      { class: "run-tag-text", x: node.x + node.width - width / 2 - 12, y: node.y + 22 },
      label,
    ),
  );
  return [group];
}

export function cardFor(node: PlacedNode, trail: readonly Trail[]): SVGGElement {
  const dimmed = trail.length > 0 && nodeIsLit(trail, node) === false ? " faded" : "";
  const status = runStatusOf(node);
  const runClass = status ? " run-" + status : "";
  const wrap = svgEl("g", { class: "node " + node.kind + dimmed + runClass });
  wrap.appendChild(
    svgEl("rect", {
      class: "body",
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rx: "11",
    }),
  );
  wrap.appendChild(svgEl("path", { class: "cap", d: capPath(node) }));
  wrap.appendChild(svgEl("text", { class: "label", x: node.x + 15, y: node.y + 21 }, node.label));
  wrap.appendChild(svgEl("text", { class: "sub", x: node.x + 15, y: node.y + 36 }, node.subtitle));

  let at = 0;
  for (const port of node.ports) {
    wrap.appendChild(portRow(node, port, at, trail));
    at = at + 1;
  }
  for (const row of fieldRows(node)) {
    wrap.appendChild(row);
  }
  for (const tag of statusBadge(node, status)) {
    wrap.appendChild(tag);
  }

  wrap.addEventListener("click", (event) => {
    if (event.button !== 0) {
      return;
    }
    event.stopPropagation();
    selectPort(portKey(node.id, ""));
  });
  return wrap;
}

function capPath(node: PlacedNode): string {
  const x = node.x;
  const y = node.y;
  const w = node.width;
  const r = 11;
  return (
    "M " +
    x +
    " " +
    (y + CARD_HEADER) +
    " L " +
    x +
    " " +
    (y + r) +
    " Q " +
    x +
    " " +
    y +
    " " +
    (x + r) +
    " " +
    y +
    " L " +
    (x + w - r) +
    " " +
    y +
    " Q " +
    (x + w) +
    " " +
    y +
    " " +
    (x + w) +
    " " +
    (y + r) +
    " L " +
    (x + w) +
    " " +
    (y + CARD_HEADER) +
    " Z"
  );
}
