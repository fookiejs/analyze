import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSensitiveKeys,
  isSensitiveKey,
  maxRedactDepth,
  redact,
  redactText,
} from "../src/redact.ts";

describe("redaction", () => {
  it("hides a sensitive key at the top level", () => {
    const cleaned = redact({ email: "a@b.com", password: "hunter2" }) as Record<string, unknown>;
    assert.equal(cleaned.email, "a@b.com");
    assert.equal(cleaned.password, "[redacted]");
  });

  it("hides a sensitive key nested three levels deep", () => {
    const cleaned = redact({
      order: { customer: { profile: { password: "hunter2", city: "Izmir" } } },
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    assert.equal(cleaned.order?.customer?.profile?.password, "[redacted]");
    assert.equal(cleaned.order?.customer?.profile?.city, "Izmir", "depth does not over-redact");
  });

  it("redacts a whole subtree when the branch itself is sensitive", () => {
    const cleaned = redact({
      order: { payment: { card: { number: "4111111111111111", brand: "visa" } } },
    }) as Record<string, Record<string, unknown>>;
    const payment = cleaned.order?.payment as Record<string, unknown>;
    assert.equal(payment?.card, "[redacted]", "the whole card object goes, not just its number");
  });

  it("reaches inside arrays", () => {
    const cleaned = redact({
      users: [
        { name: "a", token: "t1" },
        { name: "b", token: "t2" },
      ],
    }) as {
      users: readonly Record<string, unknown>[];
    };
    for (const user of cleaned.users) {
      assert.equal(user.token, "[redacted]");
      assert.notEqual(user.name, "[redacted]");
    }
  });

  it("matches regardless of case or underscores", () => {
    assert.equal(isSensitiveKey("API_KEY", defaultSensitiveKeys), true);
    assert.equal(isSensitiveKey("apiKey", defaultSensitiveKeys), true);
    assert.equal(isSensitiveKey("Authorization", defaultSensitiveKeys), true);
    assert.equal(isSensitiveKey("userPassword", defaultSensitiveKeys), true);
    assert.equal(isSensitiveKey("email", defaultSensitiveKeys), false);
  });

  it("survives a cyclic object instead of overflowing the stack", () => {
    const looped: Record<string, unknown> = { name: "root", password: "hunter2" };
    looped.self = looped;
    const cleaned = JSON.stringify(redact(looped as never));
    assert.match(cleaned, /\[redacted\]/, "the depth guard, not the stack, ends the walk");
  });

  it("stops descending past the depth limit", () => {
    let deep: Record<string, unknown> = { password: "leaf" };
    for (let i = 0; i < maxRedactDepth + 6; i += 1) {
      deep = { nested: deep };
    }
    const cleaned = JSON.stringify(redact(deep as never));
    assert.match(cleaned, /\[redacted\]/, "the guard fires instead of recursing forever");
  });

  it("redacts a json string in place and leaves plain text alone", () => {
    const cleaned = redactText(JSON.stringify({ token: "abc", note: "keep" }));
    assert.match(cleaned, /\[redacted\]/);
    assert.match(cleaned, /keep/);
    assert.equal(redactText("not json at all"), "not json at all");
  });

  it("accepts a caller supplied deny list", () => {
    const cleaned = redact({ nickname: "x" }, ["nickname"]) as Record<string, unknown>;
    assert.equal(cleaned.nickname, "[redacted]");
  });
});
