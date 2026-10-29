import { describe, expect, it } from "vitest";
import type { GridHostData, GridPlugin } from "../../shared/contracts";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import {
  compareMasked,
  comparePlugin,
  comparePluginCell,
  compareRow,
  compareRowCell,
  copyFromBaseline,
  differenceCount,
  planBaselineSync,
  rowHasDifferences,
} from "../../client/state/compare";
import { pluginRows } from "../../client/state/grid-model";
import { INITIAL_STATE, mhmReducer } from "../../client/state/reducer";
import type { MhmAction } from "../../client/state/reducer";
import type { GridHost, MhmState } from "../../client/state/types";

const FEATURES = ["pluginManagement", "pluginSourceInstallation", "pluginSourceUpdates", "pluginSettings", "relayConfig"];
type Rows = GridHostData["rows"];

function plugin(id: string, overrides: Partial<GridPlugin> = {}): GridPlugin {
  return { id, name: id, version: "1.0.0", enabled: true, status: "running", source: { kind: "npm", installSource: `npm:${id}`, ref: null, pinned: false }, ...overrides };
}

const ok = (value: Rows[string]["value"], maskedPaths: string[] = []) => ({ state: "ok" as const, value, maskedPaths });

function host(id: string, rows: Rows, plugins: GridPlugin[] = [plugin(OWN_PLUGIN_ID)], isHub = false): GridHost {
  return {
    id,
    registrationId: isHub ? null : `reg-${id}`,
    label: id,
    link: isHub ? "loopback" : "relay",
    isHub,
    result: {
      ok: true,
      snapshot: { serverId: id, version: "0.14.0", protocolVersion: 1, prerelease: false, features: FEATURES },
      value: { rows, plugins, companion: { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: true }, settingsDocuments: [] } },
    },
  };
}

function blocked(id: string): GridHost {
  return { id, registrationId: `reg-${id}`, label: id, link: "relay", isHub: false, result: { ok: false, error: { code: "authentication_failed", message: "auth failed" } } };
}

const BASE_ROWS: Rows = { mcp: ok(true), sys: ok("Be concise."), listen: ok("127.0.0.1:6767"), ver: ok("0.14.0"), idle: ok(true) };
const HUB_PLUGINS = [plugin(OWN_PLUGIN_ID), plugin("keep", { version: "1.2.0" })];

function run(hosts: GridHost[], ...actions: MhmAction[]): MhmState {
  return actions.reduce(mhmReducer, mhmReducer(INITIAL_STATE, { type: "gridLoaded", hosts }));
}

const withBaseline = (hosts: GridHost[], ...actions: MhmAction[]) => run(hosts, { type: "setBaseline", hostId: "hub" }, ...actions);
const hub = host("hub", BASE_ROWS, HUB_PLUGINS, true);

describe("settings rows against the baseline", () => {
  it("tells same, differs, missing and not set on the baseline apart, and marks the baseline column", () => {
    const a = host("a", { ...BASE_ROWS, mcp: ok(false), sys: ok("Be concise.") });
    const b = host("b", { mcp: ok(true), listen: ok("0.0.0.0:6767"), ver: ok("0.14.0"), idle: ok(true), autoarch: ok(true) });
    const state = withBaseline([hub, a, b]);
    expect(compareRow(state, "mcp", "hub")?.state).toBe("baseline");
    expect(compareRow(state, "mcp", "a")).toMatchObject({ state: "differs", note: "differs from baseline" });
    expect(compareRow(state, "sys", "a")).toMatchObject({ state: "same", note: null });
    expect(compareRow(state, "sys", "b")).toMatchObject({ state: "missing" });
    expect(compareRow(state, "autoarch", "b")).toMatchObject({ state: "differs", note: "not set on baseline" });
  });

  it("compares host-specific rows but only as information: not counted, not kept by Only differences", () => {
    const a = host("a", { ...BASE_ROWS, listen: ok("0.0.0.0:6768") }, HUB_PLUGINS);
    const state = withBaseline([hub, a]);
    expect(compareRow(state, "listen", "a")).toMatchObject({ state: "differs", informational: true });
    expect(differenceCount(state, "a")).toBe(0);
    expect(rowHasDifferences(state, (hostId) => compareRow(state, "listen", hostId))).toBe(false);
    expect(compareRowCell(state, "listen", "a")).toMatchObject({ tone: "plain", detail: "differs from baseline (for information)" });
    const older = withBaseline([hub, host("o", { ...BASE_ROWS, ver: ok("0.13.2") }, HUB_PLUGINS)]);
    expect(compareRow(older, "ver", "o")).toMatchObject({ state: "differs", informational: true });
    expect(differenceCount(older, "o")).toBe(0);
  });

  it("never compares secrets: masked leaves are skipped and said so", () => {
    const provHub = { claude: { enabled: true, options: { apiKey: MASK_PLACEHOLDER } } };
    const sameButSecret = host("a", { ...BASE_ROWS, prov: ok({ claude: { enabled: true, options: { apiKey: MASK_PLACEHOLDER } } }, ["claude.options.apiKey"]) });
    const otherPart = host("b", { ...BASE_ROWS, prov: ok({ claude: { enabled: false, options: { apiKey: MASK_PLACEHOLDER } } }, ["claude.options.apiKey"]) });
    const state = withBaseline([host("hub", { ...BASE_ROWS, prov: ok(provHub, ["claude.options.apiKey"]) }, undefined, true), sameButSecret, otherPart]);
    expect(compareRow(state, "prov", "a")).toMatchObject({ state: "same", note: "same as baseline; secrets not compared" });
    expect(compareRow(state, "prov", "b")).toMatchObject({ state: "differs", note: "differs from baseline" });
    expect(compareMasked({ a: [1, MASK_PLACEHOLDER] }, { a: [1, "real"] })).toEqual({ equal: true, secretsSkipped: true });
    expect(compareMasked({ a: 1 }, { a: 1, b: MASK_PLACEHOLDER })).toEqual({ equal: false, secretsSkipped: false });
  });

  it("does not compare blocked hosts, a blocked baseline, or rows a side cannot read (needs a newer Paseo)", () => {
    const old = host("old", { ...BASE_ROWS, idle: { state: "needs_newer_paseo", value: null, maskedPaths: [] } }, HUB_PLUGINS);
    let state = withBaseline([hub, old, blocked("x")]);
    expect(compareRow(state, "idle", "old")).toMatchObject({ state: "not_comparable", note: "not compared: needs a newer Paseo" });
    expect(compareRow(state, "mcp", "x")).toMatchObject({ state: "not_comparable", note: "host is blocked" });
    expect(differenceCount(state, "old")).toBe(0);
    state = run([hub, old, blocked("x")], { type: "setBaseline", hostId: "x" });
    expect(state.baseline).toBeNull();
    const hubIsBlocked: GridHost = { ...hub, result: { ok: false, error: { code: "host_offline", message: "offline" } } };
    state = run([hub, old], { type: "setBaseline", hostId: "hub" }, { type: "gridLoaded", hosts: [hubIsBlocked, old] });
    expect(compareRow(state, "mcp", "old")).toMatchObject({ state: "not_comparable", note: "baseline host is blocked" });
  });

  it("compares what a staged change will make of the cell", () => {
    const a = host("a", { ...BASE_ROWS, mcp: ok(false) });
    const state = withBaseline([hub, a], { type: "stage", inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: true }] });
    expect(compareRow(state, "mcp", "a")?.state).toBe("same");
    expect(compareRowCell(state, "mcp", "a")).toMatchObject({ tone: "staged", detail: "staged - same as baseline" });
  });
});

describe("plugins against the baseline", () => {
  const rowOf = (state: MhmState, id: string) => {
    const row = pluginRows(state.hosts).find((candidate) => candidate.id === id);
    if (!row) throw new Error(`no row ${id}`);
    return row;
  };

  it("tells missing, not on baseline, older, newer, other revision and enabled state", () => {
    const a = host("a", BASE_ROWS, [plugin(OWN_PLUGIN_ID), plugin("extra")]);
    const older = host("o", BASE_ROWS, [plugin(OWN_PLUGIN_ID), plugin("keep", { version: "1.1.9", enabled: false })]);
    const newer = host("n", BASE_ROWS, [plugin(OWN_PLUGIN_ID), plugin("keep", { version: "1.10.0" })]);
    const git = host("g", BASE_ROWS, [plugin(OWN_PLUGIN_ID, { version: "abc1234" }), plugin("keep", { version: "1.2.0" })]);
    const state = withBaseline([hub, a, older, newer, git]);
    expect(comparePlugin(state, rowOf(state, "keep"), "a")).toMatchObject({ state: "missing" });
    expect(comparePlugin(state, rowOf(state, "extra"), "a")).toMatchObject({ state: "differs", note: "not on baseline" });
    expect(comparePlugin(state, rowOf(state, "keep"), "o")).toMatchObject({ state: "differs", note: "older than baseline (1.2.0); disabled, enabled on baseline" });
    expect(comparePlugin(state, rowOf(state, "keep"), "n")).toMatchObject({ state: "differs", note: "newer than baseline (1.2.0)" });
    expect(comparePlugin(state, rowOf(state, OWN_PLUGIN_ID), "g")).toMatchObject({ state: "differs", note: "other revision than baseline" });
    expect(comparePlugin(state, rowOf(state, "keep"), "g")).toMatchObject({ state: "same" });
    expect(differenceCount(state, "a")).toBe(2);
  });

  it("counts a staged install as present and a staged removal as missing", () => {
    const a = host("a", BASE_ROWS, [plugin(OWN_PLUGIN_ID)]);
    let state = withBaseline([hub, a], { type: "stage", inputs: [{ op: "installPlugin", host: "reg-a", source: "npm:keep", pluginId: "keep" }] });
    expect(comparePlugin(state, rowOf(state, "keep"), "a")?.state).toBe("same");
    state = withBaseline([hub, host("b", BASE_ROWS, [plugin(OWN_PLUGIN_ID), plugin("keep", { version: "1.2.0" })])], { type: "stage", inputs: [{ op: "removePlugin", host: "reg-b", pluginId: "keep" }] });
    expect(comparePlugin(state, rowOf(state, "keep"), "b")?.state).toBe("missing");
  });
});

describe("baseline in the grid", () => {
  it("wins over the clipboard highlight and tones baseline and differing cells", () => {
    const a = host("a", { ...BASE_ROWS, mcp: ok(false) });
    const state = withBaseline([hub, a], { type: "copy", ref: { kind: "row", rowId: "mcp", hostId: "a" } });
    expect(compareRowCell(state, "mcp", "a")).toMatchObject({ tone: "differs", isSource: false });
    expect(compareRowCell(state, "mcp", "hub")).toMatchObject({ tone: "baseline", differsFromSource: false });
    const differing = withBaseline([hub, a]);
    expect(compareRowCell(differing, "mcp", "a")).toMatchObject({ tone: "differs", detail: "differs from baseline" });
    expect(comparePluginCell(differing, pluginRows(differing.hosts)[1], "a")).toMatchObject({ tone: "differs", detail: "missing; installed on baseline" });
  });

  it("filters Only differences only with a baseline", () => {
    const a = host("a", { ...BASE_ROWS, mcp: ok(false) });
    const state = withBaseline([hub, a]);
    expect(rowHasDifferences(state, (hostId) => compareRow(state, "mcp", hostId))).toBe(true);
    expect(rowHasDifferences(state, (hostId) => compareRow(state, "sys", hostId))).toBe(false);
    expect(rowHasDifferences(state, (hostId) => compareRow(state, "sys", hostId), (hostId) => hostId === "a")).toBe(true);
    const none = run([hub, a], { type: "setOnlyDifferences", on: true });
    expect(none.onlyDifferences).toBe(false);
    expect(rowHasDifferences(none, (hostId) => compareRow(none, "sys", hostId))).toBe(true);
    expect(mhmReducer(mhmReducer(state, { type: "setOnlyDifferences", on: true }), { type: "setBaseline", hostId: null }).onlyDifferences).toBe(false);
  });

  it("plans 'stage all differences' through the paste rules and lists what it cannot stage", () => {
    const a = host("a", { ...BASE_ROWS, mcp: ok(false), ver: ok("0.13.2") }, [plugin(OWN_PLUGIN_ID), plugin("keep", { version: "1.3.0" })]);
    const b = host("b", { ...BASE_ROWS, mcp: ok(false) }, [plugin(OWN_PLUGIN_ID)]);
    let state = withBaseline([hub, a, b]);
    expect(planBaselineSync(state, "a")).toEqual({
      inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: true }],
      refusals: [
        { label: "keep", reason: "target is newer" },
      ],
    });
    expect(planBaselineSync(state, "b").inputs).toEqual([
      { op: "setRow", host: "reg-b", rowId: "mcp", value: true },
      { op: "installPlugin", host: "reg-b", source: "npm:keep", pluginId: "keep" },
    ]);
    state = mhmReducer(state, { type: "stage", inputs: planBaselineSync(state, "b").inputs });
    expect(state.staged.map((entry) => [entry.item.op, entry.requires])).toEqual([
      ["setRow", []],
      ["installPlugin", ["trust"]],
    ]);
    expect(differenceCount(state, "b")).toBe(0);
  });

  it("stages a providers difference only where the target has some of the baseline's providers", () => {
    const provHub = host("hub", { ...BASE_ROWS, prov: ok({ claude: { enabled: true }, codex: { enabled: true } }) }, HUB_PLUGINS, true);
    const none = host("n", { ...BASE_ROWS, prov: ok({ other: { enabled: false } }) }, HUB_PLUGINS);
    const absent = host("x", BASE_ROWS, HUB_PLUGINS);
    const some = host("s", { ...BASE_ROWS, prov: ok({ claude: { enabled: false } }) }, HUB_PLUGINS);
    const state = withBaseline([provHub, none, absent, some]);
    const refusal = { label: "Custom providers", reason: "none of these providers exist on this host; providers are only updated, not created, from here" };
    expect(planBaselineSync(state, "n")).toEqual({ inputs: [], refusals: [refusal] });
    expect(planBaselineSync(state, "x")).toEqual({ inputs: [], refusals: [refusal] });
    expect(planBaselineSync(state, "s").inputs).toEqual([{ op: "setRow", host: "reg-s", rowId: "prov", value: { claude: { enabled: true }, codex: { enabled: true } } }]);
    expect(copyFromBaseline(state, { kind: "row", rowId: "prov", hostId: "s" })).toMatchObject({ ok: true, note: "updates the providers the host already has; not created here: codex" });
  });

  it("keeps the baseline across reloads (by registration id), drops it when the host goes, and pulls the compact view from it", () => {
    const a: GridHost = { ...host("reg-a", BASE_ROWS), registrationId: "reg-a" };
    let state = run([hub, a, host("b", BASE_ROWS)], { type: "setCompare", into: "reg-a" }, { type: "setBaseline", hostId: "reg-a" });
    expect(state.baseline).toBe("reg-a");
    expect(state.compare).toEqual({ into: "hub", from: "reg-a" });
    state = mhmReducer(state, { type: "gridLoaded", hosts: [hub, { ...host("srv-a", BASE_ROWS), registrationId: "reg-a" }] });
    expect(state.baseline).toBe("reg-a");
    expect(compareRow(state, "mcp", "srv-a")?.state).toBe("baseline");
    expect(mhmReducer(state, { type: "gridLoaded", hosts: [hub] }).baseline).toBeNull();
  });
});
