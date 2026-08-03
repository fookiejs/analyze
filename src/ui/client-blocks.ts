export function clientBlocksJs(): string {
  return `
const STEP_W = 172;
const STEP_H = 46;
const STEP_GAP = 26;
const UNDO_GAP = 14;
const LANE_LABEL = 96;
const BLOCK_HEAD = 62;
const BLOCK_PAD = 16;

function stepTone(name) {
  const status = state.runStatus[name];
  if (!status) { return "idle"; }
  return status;
}

function blockArrow(host, x1, y1, x2, y2, kind) {
  host.appendChild(svgEl("path", {
    class: "wire " + kind,
    d: "M " + x1 + " " + y1 + " L " + x2 + " " + y2,
    "marker-end": "url(#arrow-" + kind + ")",
  }));
}

function stepBox(host, card, kind) {
  const box = svgEl("g", { class: "stepbox " + kind + " " + stepTone(card.name) });
  box.appendChild(svgEl("rect", {
    class: "stepbox-body",
    x: card.x, y: card.y, width: STEP_W, height: STEP_H, rx: 9,
  }));
  const label = svgEl("text", { class: "stepbox-name", x: card.x + 12, y: card.y + 19 });
  label.textContent = card.name;
  box.appendChild(label);
  const under = svgEl("text", { class: "stepbox-sub", x: card.x + 12, y: card.y + 35 });
  under.textContent = kind === "undo" ? "undo" : "step " + String(card.step);
  box.appendChild(under);
  box.addEventListener("click", () => openExternal(card.name));
  host.appendChild(box);
  return box;
}

function laneRow(host, block, lane) {
  const label = svgEl("text", { class: "lane-label", x: 0, y: lane.y + 26 });
  label.textContent = lane.operation;
  host.appendChild(label);

  if (lane.steps.length < 1) {
    const quiet = svgEl("text", { class: "lane-quiet", x: LANE_LABEL, y: lane.y + 26 });
    quiet.textContent = "calls nothing";
    host.appendChild(quiet);
    return;
  }

  const entry = svgEl("path", {
    class: "wire invokes",
    d: "M " + (LANE_LABEL - 18) + " " + (lane.y + STEP_H / 2) + " L " + LANE_LABEL + " " + (lane.y + STEP_H / 2),
    "marker-end": "url(#arrow-invokes)",
  });
  host.appendChild(entry);

  let previous = false;
  for (const card of lane.steps) {
    if (previous) {
      blockArrow(host, previous.x + STEP_W, previous.y + STEP_H / 2, card.x, card.y + STEP_H / 2, "invokes");
    }
    stepBox(host, card, "forward");
    for (const undoName of card.undo) {
      const below = { name: undoName, step: card.step, x: card.x, y: card.y + STEP_H + UNDO_GAP, undo: [] };
      blockArrow(host, card.x + STEP_W / 2, card.y + STEP_H, card.x + STEP_W / 2, below.y, "compensates");
      stepBox(host, below, "undo");
    }
    previous = card;
  }
}

function relationRows(host, block, top) {
  let at = top;
  for (const row of block.relations) {
    const line = svgEl("text", { class: "rel-row", x: 0, y: at });
    line.textContent = row.key + " \\u2192 " + row.target;
    line.addEventListener("click", () => focusBlock(row.target));
    host.appendChild(line);
    at = at + 22;
  }
}

function blockHeader(host, block) {
  const name = svgEl("text", { class: "block-name", x: 0, y: 24 });
  name.textContent = block.model;
  host.appendChild(name);
  const sub = svgEl("text", { class: "block-sub", x: 0, y: 44 });
  sub.textContent = block.table + " \\u00b7 " + String(block.fieldCount) + " fields";
  host.appendChild(sub);
}

function drawBlock(host, block) {
  const group = svgEl("g", {
    class: "block" + (state.focusModel === block.model ? " on" : ""),
    transform: "translate(" + block.x + "," + block.y + ")",
  });
  group.appendChild(svgEl("rect", {
    class: "block-body",
    x: -BLOCK_PAD, y: -BLOCK_PAD,
    width: block.width, height: block.height, rx: 14,
  }));
  blockHeader(group, block);
  let bottom = BLOCK_HEAD;
  for (const lane of block.lanes) {
    laneRow(group, block, lane);
    bottom = lane.y + lane.height + 12;
  }
  relationRows(group, block, bottom + 14);
  group.addEventListener("click", () => selectBlock(block.model));
  host.appendChild(group);
}

function drawBlocks() {
  const host = byId("map-canvas");
  clear(host);
  const layout = state.blocks;
  if (!layout || layout.blocks.length < 1) {
    emptyState(host, "No models registered", "Hand analyze an app with models and they show up here.");
    return;
  }
  const svg = svgEl("svg", {
    id: "map-svg", class: "map-svg",
    width: "100%", height: "100%",
    viewBox: "0 0 " + layout.width + " " + layout.height,
  });
  const defs = svgEl("defs", {});
  markerDefs(defs);
  svg.appendChild(defs);
  const camera = svgEl("g", { id: "map-camera" });
  for (const block of layout.blocks) {
    drawBlock(camera, block);
  }
  svg.appendChild(camera);
  host.appendChild(svg);
  applyCamera();
  wireCamera(svg);
}

function selectBlock(name) {
  state.focusModel = state.focusModel === name ? "" : name;
  drawBlocks();
  renderInspector();
}

function focusBlock(name) {
  state.focusModel = name;
  drawBlocks();
  renderInspector();
  fitMap();
}

function blockNamed(name) {
  if (!state.blocks) { return false; }
  for (const block of state.blocks.blocks) {
    if (block.model === name) { return block; }
  }
  return false;
}

function openExternal(name) {
  state.focusExternal = name;
  renderInspector();
}
`;
}
