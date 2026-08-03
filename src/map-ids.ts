import { z } from "zod";
import { AnalyzeError } from "./errors.ts";

export const modelNodeKind = "model";
export const externalNodeKind = "external";

export const relationEdgeKind = "relation";
export const invokesEdgeKind = "invokes";
export const nestsEdgeKind = "nests";
export const compensatesEdgeKind = "compensates";

export const flowOperations: readonly string[] = ["create", "list", "update", "delete"];

export const externalInputPort = "in";
export const externalUndoPort = "undo";
export const cardPort = "card";

export const unknownOperation = "flow";
export const undoOperation = "undo";

export const nestingLabel = "nests";

export const compensationLabel = "undo";

export function modelNodeId(name: string): string {
  if (z.string().min(1).safeParse(name).success === false) {
    throw AnalyzeError.create("model name required");
  }
  const id = `model:${name}`;
  if (id.length <= "model:".length) {
    throw AnalyzeError.create("model node id required");
  }
  return id;
}

export function externalNodeId(name: string): string {
  if (z.string().min(1).safeParse(name).success === false) {
    throw AnalyzeError.create("external name required");
  }
  const id = `external:${name}`;
  if (id.length <= "external:".length) {
    throw AnalyzeError.create("external node id required");
  }
  return id;
}

export const noCompensation = "none";

export type FlowUse = {
  model: string;
  operation: string;
  steps: readonly string[];
};
