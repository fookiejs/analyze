import { z } from "zod";
import { appendItem } from "@fookiejs/core";
import type { EntityRecord, JsonValue, LogEntry } from "@fookiejs/core";
import { AnalyzeError } from "./errors.ts";

export const redactedMarker = "[redacted]";

export const defaultSensitiveKeys: readonly string[] = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "credential",
  "sessionid",
  "session_id",
  "ssn",
  "card",
  "cardnumber",
  "card_number",
  "cvv",
  "pin",
  "privatekey",
  "private_key",
];

function flattenKey(raw: string): string {
  let letters: readonly string[] = [];
  for (const letter of raw.toLowerCase()) {
    if (letter === "_") {
      continue;
    }
    if (letter === "-") {
      continue;
    }
    letters = appendItem(letters, letter);
  }
  return letters.join(joiner);
}

export function isSensitiveKey(key: string, deny: readonly string[]): boolean {
  const parsed = z.string().min(1).safeParse(key);
  if (parsed.success === false) {
    return false;
  }
  const flattened = flattenKey(parsed.data);
  for (const candidate of deny) {
    const target = flattenKey(candidate);
    if (flattened === target) {
      return true;
    }
    if (flattened.includes(target)) {
      return true;
    }
  }
  return false;
}

const joiner = redactedMarker.slice(0, 0);

export const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);

const shallowBag: z.ZodType<Record<string, JsonValue>> = z.record(
  z.string(),
  z.custom<JsonValue>(() => true),
);

const scalarShape = z.union([z.string(), z.number(), z.boolean()]);

export type RedactableKinds = {
  json: JsonValue;
  entity: EntityRecord;
  logFields: Record<string, LogEntry["fields"][string]>;
};

export type Redactable = RedactableKinds[keyof RedactableKinds];

export const maxRedactDepth = 12;

export function redact(
  value: Redactable,
  deny: readonly string[] = defaultSensitiveKeys,
  depth: number = 0,
): JsonValue {
  if (depth > maxRedactDepth) {
    return redactedMarker;
  }
  if (Array.isArray(value)) {
    let items: readonly JsonValue[] = [];
    for (const item of value) {
      items = appendItem(items, redact(item, deny, depth + 1));
    }
    return items;
  }
  const asObject = shallowBag.safeParse(value);
  if (asObject.success === false) {
    const asScalar = scalarShape.safeParse(value);
    if (asScalar.success === false) {
      return redactedMarker;
    }
    return asScalar.data;
  }
  const cleaned: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(asObject.data)) {
    if (isSensitiveKey(key, deny)) {
      cleaned[key] = redactedMarker;
      continue;
    }
    cleaned[key] = redact(nested, deny, depth + 1);
  }
  return cleaned;
}

export function redactText(raw: string, deny: readonly string[] = defaultSensitiveKeys): string {
  if (z.string().safeParse(raw).success === false) {
    throw AnalyzeError.create("redaction input must be text");
  }
  if (raw.length < 1) {
    return raw;
  }
  try {
    const parsed = jsonSchema.safeParse(JSON.parse(raw));
    if (parsed.success === false) {
      return raw;
    }
    return JSON.stringify(redact(parsed.data, deny));
  } catch {
    return raw;
  }
}
