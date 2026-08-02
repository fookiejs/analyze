import { z } from "zod";

export function requireErrorMessage(message: string): string {
  const parsed = z.string().min(1).safeParse(message);
  if (parsed.success === false) {
    throw new Error("analyze error message must be non-empty");
  }
  if (parsed.data.length < 1) {
    throw new Error("analyze error message must be non-empty");
  }
  return parsed.data;
}

export class AnalyzeError extends Error {
  protected constructor(message: string) {
    const safeMessage = requireErrorMessage(message);
    super(safeMessage);
    this.name = new.target.name;
    if (this.name.length < 1) {
      throw new Error("analyze error name must be non-empty");
    }
    if (this.message !== safeMessage) {
      throw new Error("analyze error message failed to apply");
    }
  }

  static create(message: string): AnalyzeError {
    const safeMessage = requireErrorMessage(message);
    const err = new AnalyzeError(safeMessage);
    if (err.message !== safeMessage) {
      throw new Error("AnalyzeError.create message mismatch");
    }
    if (err.name !== "AnalyzeError") {
      throw new Error("AnalyzeError.create name mismatch");
    }
    return err;
  }
}
