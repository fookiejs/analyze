import { appendItem } from "@fookiejs/core";
import type { ExternalSummary, ModelSummary } from "@fookiejs/core";
import { AnalyzeError } from "../errors.ts";
import { flowOperations, noCompensation } from "../map-ids.ts";
import type { FlowUse } from "../map-ids.ts";

export type StepCard = {
  name: string;
  step: number;
  undo: readonly string[];
  observed: boolean;
  x: number;
  y: number;
};

export type OperationLane = {
  operation: string;
  observed: boolean;
  steps: readonly StepCard[];
  y: number;
  height: number;
};

export type RelationRow = {
  key: string;
  target: string;
};

export type ModelBlock = {
  model: string;
  table: string;
  fieldCount: number;
  relations: readonly RelationRow[];
  lanes: readonly OperationLane[];
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BlockLayout = {
  blocks: readonly ModelBlock[];
  width: number;
  height: number;
};

export const stepWidth = 172;
export const stepHeight = 46;
export const stepGap = 26;
export const undoGap = 14;
export const laneLabelWidth = 96;
export const laneGap = 12;
export const blockHeaderHeight = 62;
export const blockPadding = 16;
export const blockGap = 40;

function undoFor(externals: readonly ExternalSummary[], name: string): readonly string[] {
  for (const external of externals) {
    if (external.name !== name) {
      continue;
    }
    for (const undo of external.compensate) {
      return [undo];
    }
    return [];
  }
  return [];
}

function stepsFor(uses: readonly FlowUse[], model: string, operation: string): readonly string[] {
  if (model.length < 1 || operation.length < 1) {
    throw AnalyzeError.create("a lane needs a model and an operation");
  }
  for (const use of uses) {
    if (use.model === model && use.operation === operation) {
      return use.steps;
    }
  }
  return [];
}

function relationsOf(model: ModelSummary): readonly RelationRow[] {
  let rows: readonly RelationRow[] = [];
  for (const field of model.fields) {
    for (const target of field.relation) {
      rows = appendItem(rows, { key: field.key, target });
    }
  }
  return rows;
}

function laneHeightOf(steps: readonly StepCard[]): number {
  let deepest = stepHeight;
  for (const card of steps) {
    if (card.undo.length > 0) {
      deepest = stepHeight + undoGap + stepHeight;
    }
  }
  return deepest;
}

function laneFor(
  externals: readonly ExternalSummary[],
  uses: readonly FlowUse[],
  model: string,
  operation: string,
  top: number,
): OperationLane {
  const names = stepsFor(uses, model, operation);
  let steps: readonly StepCard[] = [];
  let index = 0;
  for (const name of names) {
    steps = appendItem(steps, {
      name,
      step: index + 1,
      undo: undoFor(externals, name),
      observed: true,
      x: laneLabelWidth + index * (stepWidth + stepGap),
      y: top,
    });
    index += 1;
  }
  return {
    operation,
    observed: names.length > 0,
    steps,
    y: top,
    height: laneHeightOf(steps),
  };
}

function lanesFor(
  externals: readonly ExternalSummary[],
  uses: readonly FlowUse[],
  model: string,
): readonly OperationLane[] {
  let lanes: readonly OperationLane[] = [];
  let cursor = blockHeaderHeight;
  for (const operation of flowOperations) {
    const lane = laneFor(externals, uses, model, operation, cursor);
    lanes = appendItem(lanes, lane);
    cursor = cursor + lane.height + laneGap;
  }
  return lanes;
}

function widestLane(lanes: readonly OperationLane[]): number {
  let widest = laneLabelWidth + stepWidth;
  for (const lane of lanes) {
    const used = laneLabelWidth + lane.steps.length * (stepWidth + stepGap);
    if (used > widest) {
      widest = used;
    }
  }
  return widest;
}

function blockHeight(lanes: readonly OperationLane[], relations: number): number {
  if (relations < 0) {
    throw AnalyzeError.create("a block cannot have a negative relation count");
  }
  let bottom = blockHeaderHeight;
  for (const lane of lanes) {
    bottom = lane.y + lane.height + laneGap;
  }
  return bottom + relations * 22 + blockPadding * 2;
}

export function blocksOf(
  models: readonly ModelSummary[],
  externals: readonly ExternalSummary[],
  uses: readonly FlowUse[],
): BlockLayout {
  if (Array.isArray(models) === false) {
    throw AnalyzeError.create("the catalog is required to draw blocks");
  }
  let sized: readonly ModelBlock[] = [];
  for (const model of models) {
    const lanes = lanesFor(externals, uses, model.name);
    const relations = relationsOf(model);
    sized = appendItem(sized, {
      model: model.name,
      table: model.table,
      fieldCount: model.fields.length,
      relations,
      lanes,
      x: 0,
      y: 0,
      width: widestLane(lanes) + blockPadding * 2,
      height: blockHeight(lanes, relations.length),
    });
  }
  return placeBlocks(sized.toSorted((left, right) => busierBlock(left, right)));
}

function busierBlock(left: ModelBlock, right: ModelBlock): number {
  if (left.model.length < 1 || right.model.length < 1) {
    throw AnalyzeError.create("a block needs a model name to be ordered");
  }
  const gap = stepTotal(right) - stepTotal(left);
  if (gap !== 0) {
    return gap;
  }
  if (left.model === noCompensation) {
    return 1;
  }
  return left.model.localeCompare(right.model);
}

function stepTotal(block: ModelBlock): number {
  if (Array.isArray(block.lanes) === false) {
    throw AnalyzeError.create("a block always carries its operation lanes");
  }
  let total = 0;
  for (const lane of block.lanes) {
    total = total + lane.steps.length;
  }
  return total;
}

export const targetCanvasWidth = 1500;

function rowWidthFor(blocks: readonly ModelBlock[]): number {
  let widest = targetCanvasWidth;
  for (const block of blocks) {
    if (block.width > widest) {
      widest = block.width;
    }
  }
  return widest;
}

function placeBlocks(blocks: readonly ModelBlock[]): BlockLayout {
  const rowWidth = rowWidthFor(blocks);
  let placed: readonly ModelBlock[] = [];
  let cursorX = 0;
  let rowTop = 0;
  let rowTall = 0;
  let widest = 0;
  for (const block of blocks) {
    const wraps = cursorX > 0 && cursorX + block.width > rowWidth;
    if (wraps) {
      rowTop = rowTop + rowTall + blockGap;
      rowTall = 0;
      cursorX = 0;
    }
    placed = appendItem(placed, {
      model: block.model,
      table: block.table,
      fieldCount: block.fieldCount,
      relations: block.relations,
      lanes: block.lanes,
      x: cursorX,
      y: rowTop,
      width: block.width,
      height: block.height,
    });
    if (block.height > rowTall) {
      rowTall = block.height;
    }
    if (cursorX + block.width > widest) {
      widest = cursorX + block.width;
    }
    cursorX = cursorX + block.width + blockGap;
  }
  return { blocks: placed, width: widest, height: rowTop + rowTall };
}
