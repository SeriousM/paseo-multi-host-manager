import { describe, expect, it } from "vitest";
import { ROW_BY_ID, ROWS } from "../../shared/rows";
import { existingProvidersOnly, rowPatch } from "../../server/rows/patch";
import { pluginSource } from "../../server/rows/plugins";
import { OWN_INSTALL_SOURCE } from "../../shared/companion-contracts";
import { plugin } from "./rpc-fakes";

describe("ROWS", () => {
  it("lists exactly the rows of ROWS.md", () => {
    expect(ROWS.map((row) => row.id)).toEqual(["ver", "osn", "listen", "conn", "wt", "log", "relay", "mcp", "browser", "hooks", "autoarch", "idle", "sys", "prov", "pen", "pw", "rc"]);
    expect(ROW_BY_ID.idle).toMatchObject({ path: "idleRuntimeCleanup", write: "live", type: "bool", feature: "idleRuntimeCleanupSetting" });
  });

  it("is live only for what config.patch accepts; restart-only and info rows are read-only; secrets are never", () => {
    const live = ROWS.filter((row) => row.write === "live").map((row) => row.id);
    expect(live).toEqual(["relay", "mcp", "browser", "hooks", "autoarch", "idle", "sys", "prov", "pen"]);
    for (const id of ["ver", "osn", "listen", "conn", "wt", "log"]) expect(ROW_BY_ID[id]?.write).toBe("readonly");
    for (const id of ["pw", "rc"]) expect(ROW_BY_ID[id]).toMatchObject({ write: "never", source: "none", path: null });
  });

  it("marks host-specific rows", () => {
    expect(ROWS.filter((row) => row.hostSpecific).map((row) => row.id)).toEqual(["listen", "conn", "wt"]);
  });

  it("only lists live rows whose path is a config.patch key", () => {
    const patchable = ["relay.enabled", "mcp.injectIntoAgents", "browserTools.enabled", "enableTerminalAgentHooks", "autoArchiveAfterMerge", "idleRuntimeCleanup", "appendSystemPrompt", "providers", "pluginsEnabled"];
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
    ["idle", false, { idleRuntimeCleanup: false }],
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

describe("rowPatch for providers with placeholders", () => {
  it("drops masked keys per entry, and objects left empty, so the target keeps those values", () => {
    const value = { a: { enabled: true, options: { apiKey: "<masked>", model: "m" }, auth: { token: "<masked>" } }, b: { secret: "<masked>" } };
    expect(rowPatch("prov", value)).toEqual({ patch: { providers: { a: { enabled: true, options: { model: "m" } } } } });
  });

  it("rejects placeholders that cannot be dropped, or that leave nothing to write", () => {
    expect(rowPatch("prov", { a: { args: ["<masked>"] } })).toEqual({ invalid: "masked_value" });
    expect(rowPatch("prov", { a: { apiKey: "<masked>" } })).toEqual({ invalid: "masked_value" });
  });
});

describe("existingProvidersOnly", () => {
  it("keeps the ids the target has and names the rest", () => {
    expect(existingProvidersOnly({ a: { enabled: true }, b: { enabled: false } }, { a: { enabled: false }, c: {} })).toEqual({ providers: { a: { enabled: true } }, missing: ["b"] });
    expect(existingProvidersOnly({ a: { enabled: true } }, undefined)).toEqual({ providers: {}, missing: ["a"] });
  });
});

describe("pluginSource", () => {
  const git = (remote: string, currentRevision?: string) =>
    plugin("g", { source: "git", installation: { identity: { kind: "git", remote, pluginPath: "." }, currentRevision } });

  it("pins npm sources to the installed version", () => {
    const npm = plugin("n", { npm: { packageName: "pkg", requestedSpec: "pkg", version: "1.2.3", integrity: "i" }, installation: { identity: { kind: "npm", packageName: "pkg", pluginPath: "." }, currentRevision: "1.2.3" } });
    expect(pluginSource(npm)).toEqual({ kind: "npm", installSource: "npm:pkg@1.2.3", ref: null, pinned: true });
    const legacy = plugin("n", { npm: { packageName: "@s/pkg", requestedSpec: "x", version: "0.1.0", integrity: "i" } });
    expect(pluginSource(legacy)).toEqual({ kind: "npm", installSource: "npm:@s/pkg@0.1.0", ref: null, pinned: true });
    const unknown = plugin("n", { installation: { identity: { kind: "npm", packageName: "pkg", pluginPath: "p" } } });
    expect(pluginSource(unknown)).toEqual({ kind: "npm", installSource: "npm:pkg:p", ref: null, pinned: false });
  });

  it("pins git sources to the installed commit through ref, and installs latest without one", () => {
    expect(pluginSource(git("https://github.com/a/b.git", "c0ffee"))).toEqual({ kind: "git", installSource: "git:https://github.com/a/b.git", ref: "c0ffee", pinned: true });
    expect(pluginSource(git("https://github.com/a/b.git"))).toEqual({ kind: "git", installSource: "git:https://github.com/a/b.git", ref: null, pinned: false });
  });

  it("keeps ssh login names but drops remotes with a password or token", () => {
    expect(pluginSource(git("ssh://git@github.com/a/b.git", "c1")).installSource).toBe("git:ssh://git@github.com/a/b.git");
    expect(pluginSource(git("git+ssh://git@github.com/a/b.git", "c1")).installSource).toBe("git:git+ssh://git@github.com/a/b.git");
    for (const remote of ["ssh://git:pw@github.com/a/b.git", "https://user:pw@github.com/a/b.git", "https://ghtoken@github.com/a/b.git"]) {
      expect(pluginSource(git(remote, "c1"))).toEqual({ kind: "git", installSource: null, ref: null, pinned: false });
    }
  });

  it("cannot pin registry installs", () => {
    const registry = plugin("r", { installation: { identity: { kind: "npm", packageName: "x", pluginPath: ".", registry: { url: "https://plugins.paseo.sh", id: "a/b" } }, currentRevision: "1.0.0" } });
    expect(pluginSource(registry)).toEqual({ kind: "registry", installSource: "a/b", ref: null, pinned: false });
  });

  it("names our own registry source by the confirmed registry id", () => {
    expect(OWN_INSTALL_SOURCE).toBe("seriousm/paseo-multi-host-manager");
  });
});
