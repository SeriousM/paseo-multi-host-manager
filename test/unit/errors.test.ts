import { describe, expect, it } from "vitest";
import type { ErrorCode } from "../../shared/errors";

describe("ErrorCode", () => {
  it("accepts the documented codes", () => {
    const code: ErrorCode = "host_offline";
    expect(code).toBe("host_offline");
  });
});
