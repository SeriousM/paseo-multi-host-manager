import { describe, expect, it } from "vitest";
import * as companionContracts from "../../shared/companion-contracts";
import * as contracts from "../../shared/contracts";

describe("RPC names", () => {
  it("all live in the plugin's mhm. namespace", () => {
    const names = [...Object.values(contracts), ...Object.values(companionContracts)].flatMap((value) =>
      typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" ? [value.name] : [],
    );
    expect(names).toContain("mhm.hosts.overview");
    for (const name of names) expect(name).toMatch(/^mhm\./);
  });
});
