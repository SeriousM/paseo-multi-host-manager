import { describe, expect, it } from "vitest";
import { ROW_BY_ID, ROWS } from "../../shared/rows";
import { rowPatch } from "../../server/rows/patch";

describe("ROWS", () => {
  it("lists exactly the rows of ROWS.md, without idleRuntimeCleanup", () => {
    expect(ROWS.map((row) => row.id)).toEqual(["ver", "osn", "listen", "conn", "wt", "log", "relay", "mcp", "browser", "hooks", "autoarch", "sys", "prov", "pen", "pw", "rc"]);
    expect(JSON.stringify(ROWS)).not.toMatch(/idle/i);
  });

  it("is live only for what config.patch accepts; restart-only and info rows are read-only; secrets are never", () => {
    const live = ROWS.filter((row) => row.write === "live").map((row) => row.id);
    expect(live).toEqual(["relay", "mcp", "browser", "hooks", "autoarch", "sys", "prov", "pen"]);
    for (const id of ["ver", "osn", "listen", "conn", "wt", "log"]) expect(ROW_BY_ID[id]?.write).toBe("readonly");
    for (const id of ["pw", "rc"]) expect(ROW_BY_ID[id]).toMatchObject({ write: "never", source: "none", path: null });
  });

  it("marks host-specific rows", () => {
    expect(ROWS.filter((row) => row.hostSpecific).map((row) => row.id)).toEqual(["listen", "conn", "wt"]);
  });

  it("only lists live rows whose path is a config.patch key", () => {
    const patchable = ["relay.enabled", "mcp.injectIntoAgents", "browserTools.enabled", "enableTerminalAgentHooks", "autoArchiveAfterMerge", "appendSystemPrompt", "providers", "pluginsEnabled"];
    expect(ROWS.filter((row) => row.write === "live").map((row) => row.path)).toEqual(patchable);
  });
});

describe("rowPatch", () => {
  it.each([
    ["relay", true, { relay: { enabled: true } }],
    ["mcp", false, { mcp: { injectIntoAgents: false } }],
    ["browser", true, { browserTools: { enabled: true } }],
    ["hooks", true, { enableTerminalAgentHooks: true }],
    ["autoarch", false, { autoArchiveAfterMerge: false }],
    ["pen", true, { pluginsEnabled: true }],
    ["sys", "", { appendSystemPrompt: "" }],
    ["prov", { a: { enabled: true } }, { providers: { a: { enabled: true } } }],
  ])("builds the patch for %s", (rowId, value, patch) => {
    expect(rowPatch(rowId, value)).toEqual({ patch });
  });

  it("rejects non-object values for providers", () => {
    for (const value of [null, "x", [1], { a: "x" }]) expect(rowPatch("prov", value)).toEqual({ invalid: "wrong_value_type" });
  });
});
