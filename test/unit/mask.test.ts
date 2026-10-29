import { describe, expect, it } from "vitest";
import { MASK_PLACEHOLDER, maskJson, restoreMasked, type Json } from "../../shared/mask";

describe("maskJson", () => {
  it("masks by key name, including nested objects and arrays below a secret key", () => {
    const { value, maskedPaths } = maskJson({
      apiKey: "plain",
      nested: { password: "hunter2", Authorization: "x", name: "visible" },
      tokens: { list: ["a", "b"] },
      count: 3,
    });
    expect(value).toEqual({
      apiKey: MASK_PLACEHOLDER,
      nested: { password: MASK_PLACEHOLDER, Authorization: MASK_PLACEHOLDER, name: "visible" },
      tokens: { list: [MASK_PLACEHOLDER, MASK_PLACEHOLDER] },
      count: 3,
    });
    expect(maskedPaths).toEqual(["apiKey", "nested.password", "nested.Authorization", "tokens.list[0]", "tokens.list[1]"]);
  });

  it.each(["sk-abc123", "ghp_abc", "gho_abc", "github_pat_abc", "xoxb-1-2", "xoxa-1", "xoxp-1", "AKIAIOSFODNN7EXAMPLE", "Bearer abc.def", "bearer abc", "$2b$10$abcdefghij"])(
    "masks the value %s under an innocent key",
    (secret) => {
      expect(maskJson({ note: secret }).value).toEqual({ note: MASK_PLACEHOLDER });
    },
  );

  it("keeps ordinary strings, empty strings and non-strings", () => {
    const input: Json = { note: "hello", token: "", flag: true, none: null, n: 1 };
    expect(maskJson(input)).toEqual({ value: input, maskedPaths: [] });
  });
});

describe("restoreMasked", () => {
  it("round-trips: placeholders take the existing value, other edits survive", () => {
    const existing: Json = { apiKey: "real", list: ["sk-real"], other: "old" };
    const masked = maskJson(existing).value as { other: string };
    masked.other = "new";
    const restored = restoreMasked(masked, existing);
    expect(restored.value).toEqual({ apiKey: "real", list: ["sk-real"], other: "new" });
    expect(restored.keptPaths).toEqual(["apiKey", "list[0]"]);
    expect(restored.unresolvedPaths).toEqual([]);
  });

  it("reports placeholders that have nothing to restore", () => {
    const restored = restoreMasked({ apiKey: MASK_PLACEHOLDER }, {});
    expect(restored.unresolvedPaths).toEqual(["apiKey"]);
  });
});
