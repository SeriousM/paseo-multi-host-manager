import { describe, expect, it } from "vitest";
import type { ApplyResult, GridHostData, GridPlugin } from "../../shared/contracts";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import { clipFromCell, planPaste } from "../../client/state/clipboard";
import { hostSummary, orderHosts, pluginCellView, pluginRows, rowCellView } from "../../client/state/grid-model";
import { tint } from "../../client/grid/palette";
import { withInsecureLink } from "../../client/state/policy";
import { INITIAL_STATE, mhmReducer } from "../../client/state/reducer";
import type { MhmAction } from "../../client/state/reducer";
import { applyInput, nextConfirmation, slotOf } from "../../client/state/staging";
import type { GridHost, MhmState } from "../../client/state/types";

const FEATURES = ["pluginManagement", "pluginSourceInstallation", "pluginSourceUpdates", "pluginSettings", "relayConfig"];
const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };

function source(kind: GridPlugin["source"]["kind"], installSource: string | null, ref: string | null = null, pinned = false): GridPlugin["source"] {
  return { kind, installSource, ref, pinned };
}

function plugin(id: string, overrides: Partial<GridPlugin> = {}): GridPlugin {
  return { id, name: id, version: "1.0.0", enabled: true, status: "running", source: source("npm", `npm:${id}`), ...overrides };
}

const ok = (value: GridHostData["rows"][string]["value"]) => ({ state: "ok" as const, value, maskedPaths: [] });

function data(overrides: Partial<GridHostData> = {}): GridHostData {
  return {
    rows: { relay: ok(true), pen: ok(true), mcp: ok(true), sys: ok("Be concise."), ver: ok("0.13.2") },
    plugins: [plugin(OWN_PLUGIN_ID, { version: "0.1.0" })],
    companion: { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: true }, settingsDocuments: [] },
    ...overrides,
  };
}

function host(id: string, options: { isHub?: boolean; link?: GridHost["link"]; registrationId?: string | null; data?: GridHostData; version?: string } = {}): GridHost {
  return {
    id,
    registrationId: options.registrationId === undefined ? (options.isHub ? null : `reg-${id}`) : options.registrationId,
    label: id,
    link: options.link ?? (options.isHub ? "loopback" : "relay"),
    isHub: options.isHub ?? false,
    result: { ok: true, snapshot: { serverId: id, version: options.version ?? "0.13.2", protocolVersion: 1, prerelease: (options.version ?? "").includes("-"), features: FEATURES }, value: options.data ?? data() },
  };
}

function offline(id: string): GridHost {
  return { id, registrationId: `reg-${id}`, label: id, link: "relay", isHub: false, result: { ok: false, error: { code: "host_offline", message: "Host is offline" } } };
}

function run(hosts: GridHost[], ...actions: MhmAction[]): MhmState {
  return actions.reduce(mhmReducer, mhmReducer(INITIAL_STATE, { type: "gridLoaded", hosts }));
}

const hub = host("hub", { isHub: true });

describe("grid model", () => {
  it("puts the hub first and keeps the directory order of the others", () => {
    expect(orderHosts([host("a"), hub, host("b")]).map((h) => h.id)).toEqual(["hub", "a", "b"]);
  });

  it("builds one plugin row per id across hosts, this plugin first, with a portable source from any host", () => {
    const a = host("a", { data: data({ plugins: [plugin("zeta", { source: source("directory", null) })] }) });
    const b = host("b", { data: data({ plugins: [plugin("zeta"), plugin("alpha"), plugin(OWN_PLUGIN_ID)] }) });
    const rows = pluginRows([a, b]);
    expect(rows.map((row) => row.id)).toEqual([OWN_PLUGIN_ID, "alpha", "zeta"]);
    expect(rows[2].source?.installSource).toBe("npm:zeta");
    expect(Object.keys(rows[2].hosts)).toEqual(["a", "b"]);
  });

  it("summarises hosts: tags, failures and access sensitivity", () => {
    expect(hostSummary(hub)).toMatchObject({ reachable: true, accessSensitive: true, versionTag: null, companion: "ok", platform: "linux" });
    expect(hostSummary(host("n", { version: "0.14.0" })).versionTag).toBe("untested");
    expect(hostSummary(host("p", { version: "0.14.0-beta.2" })).versionTag).toBe("prerelease");
    expect(hostSummary(host("s", { link: "ssh" })).accessSensitive).toBe(false);
    expect(hostSummary(offline("o"))).toMatchObject({ reachable: false, failure: { code: "host_offline" } });
  });

  it("shows values, masked, read-only and unavailable cells", () => {
    const masked = host("m", { data: data({ rows: { sys: { state: "ok", value: MASK_PLACEHOLDER, maskedPaths: [""] }, wt: { state: "needs_companion", value: null, maskedPaths: [] } } }) });
    const state = run([hub, masked, offline("o")]);
    expect(rowCellView(state, "mcp", "hub")).toMatchObject({ text: "on", readOnly: false, copyable: true, unavailable: null });
    expect(rowCellView(state, "ver", "hub")).toMatchObject({ text: "0.13.2", readOnly: true, copyable: false });
    expect(rowCellView(state, "sys", "m")).toMatchObject({ text: "masked", masked: true, copyable: false });
    expect(rowCellView(state, "wt", "m").unavailable?.code).toBe("needs_companion");
    expect(rowCellView(state, "mcp", "o").unavailable).toEqual({ code: "host_offline", message: "Host is offline" });
  });

  it("highlights the source and the cells that differ from it, and previews staged changes", () => {
    const other = host("a", { data: data({ rows: { mcp: ok(false) } }) });
    const same = host("b");
    let state = run([hub, other, same], { type: "copy", ref: { kind: "row", rowId: "mcp", hostId: "hub" } });
    expect(rowCellView(state, "mcp", "hub").tone).toBe("source");
    expect(rowCellView(state, "mcp", "a")).toMatchObject({ differsFromSource: true, tone: "differs" });
    expect(rowCellView(state, "mcp", "b").differsFromSource).toBe(false);
    state = mhmReducer(state, { type: "paste", hostId: "a" });
    expect(rowCellView(state, "mcp", "a")).toMatchObject({ text: "off -> on", tone: "staged" });
  });

  it("previews plugin cells and staged plugin operations", () => {
    const row = pluginRows([hub])[0];
    let state = run([hub, host("a", { data: data({ plugins: [] }) })]);
    expect(pluginCellView(state, row, "a").text).toBe("not installed");
    state = mhmReducer(state, { type: "copy", ref: { kind: "plugin", pluginId: OWN_PLUGIN_ID, hostId: "hub" } });
    expect(pluginCellView(state, row, "a").differsFromSource).toBe(true);
    state = mhmReducer(state, { type: "paste", hostId: "a" });
    expect(pluginCellView(state, row, "a")).toMatchObject({ text: "install", tone: "staged" });
  });
});

describe("clipboard and paste planning", () => {
  it("copies only writable rows and installed plugins", () => {
    const state = run([hub]);
    expect(clipFromCell(state, { kind: "row", rowId: "ver", hostId: "hub" })).toBeNull();
    expect(clipFromCell(state, { kind: "row", rowId: "mcp", hostId: "hub" })).toEqual({ kind: "row", rowId: "mcp", sourceHost: "hub", value: true });
    expect(clipFromCell(state, { kind: "plugin", pluginId: "missing", hostId: "hub" })).toBeNull();
  });

  it("refuses identical values, the source, unreachable hosts, masked values and missing features", () => {
    const masked = host("m", { data: data({ rows: { sys: { state: "ok", value: MASK_PLACEHOLDER, maskedPaths: [""] } } }) });
    const noRelay: GridHost = { ...host("x"), result: { ...host("x").result, ok: true, snapshot: { serverId: "x", version: "0.13.2", protocolVersion: 1, prerelease: false, features: [] }, value: data({ rows: { relay: ok(false) } }) } };
    const state = run([hub, host("a"), offline("o"), masked, noRelay]);
    expect(planPaste(state, { kind: "row", rowId: "mcp", sourceHost: "hub", value: true }, "a")).toEqual({ ok: false, same: true, reason: "identical" });
    expect(planPaste(state, { kind: "row", rowId: "mcp", sourceHost: "hub", value: true }, "hub")).toMatchObject({ ok: false, same: true });
    expect(planPaste(state, { kind: "row", rowId: "mcp", sourceHost: "hub", value: false }, "o")).toMatchObject({ ok: false, reason: "Host is offline" });
    expect(planPaste(state, { kind: "row", rowId: "sys", sourceHost: "m", value: MASK_PLACEHOLDER }, "a")).toMatchObject({ ok: false, reason: "contains masked secrets" });
    expect(planPaste(state, { kind: "row", rowId: "relay", sourceHost: "hub", value: true }, "x")).toMatchObject({ ok: false, reason: "host lacks relayConfig" });
    expect(planPaste(state, { kind: "row", rowId: "ver", sourceHost: "hub", value: "0.13.2" }, "a")).toMatchObject({ ok: false, reason: "read-only" });
  });

  it("stages a row paste against the saved host's registration id", () => {
    const plan = planPaste(run([hub, host("a")]), { kind: "row", rowId: "mcp", sourceHost: "hub", value: false }, "a");
    expect(plan).toEqual({ ok: true, inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: false }], note: "applied live" });
  });

  it("pastes a plugin as install, update and enable as needed", () => {
    const source = plugin("keep", { version: "2.0.0", enabled: true });
    const older = host("a", { data: data({ plugins: [plugin("keep", { version: "1.0.0", enabled: false })] }) });
    const without = host("b", { data: data({ plugins: [] }) });
    const off = host("c", { data: data({ plugins: [], rows: { pen: ok(false) } }) });
    const state = run([host("hub", { isHub: true, data: data({ plugins: [source] }) }), older, without, off]);
    const clip = { kind: "plugin" as const, pluginId: "keep", sourceHost: "hub", plugin: source };
    expect(planPaste(state, clip, "a")).toMatchObject({ ok: true, inputs: [{ op: "updatePlugin", pluginId: "keep" }, { op: "setPluginEnabled", enabled: true }] });
    expect(planPaste(state, clip, "b")).toMatchObject({ ok: true, inputs: [{ op: "installPlugin", source: "npm:keep", pluginId: "keep", host: "reg-b" }] });
    expect(planPaste(state, clip, "c")).toMatchObject({ ok: false, reason: expect.stringContaining("switched off") });
    const staged = mhmReducer(state, { type: "stage", inputs: [{ op: "setRow", host: "reg-c", rowId: "pen", value: true }] });
    expect(planPaste(staged, clip, "c").ok).toBe(true);
  });

  it("installs from the copied host's own source with its pin and git ref, else from another host's", () => {
    const git = plugin("mon", { version: "abc1234", source: source("git", "git:https://example.test/mon.git", "abc1234def", true) });
    const state = run([host("hub", { isHub: true, data: data({ plugins: [git] }) }), host("a", { data: data({ plugins: [] }) })]);
    expect(planPaste(state, { kind: "plugin", pluginId: "mon", sourceHost: "hub", plugin: git }, "a")).toEqual({
      ok: true,
      inputs: [{ op: "installPlugin", host: "reg-a", source: "git:https://example.test/mon.git", ref: "abc1234def", pluginId: "mon" }],
      note: "install from git:https://example.test/mon.git; pinned at abc1234",
    });
    const dir = plugin("keep", { source: source("directory", null) });
    const elsewhere = run([host("hub", { isHub: true, data: data({ plugins: [dir] }) }), host("a", { data: data({ plugins: [] }) }), host("b", { data: data({ plugins: [plugin("keep")] }) })]);
    expect(planPaste(elsewhere, { kind: "plugin", pluginId: "keep", sourceHost: "hub", plugin: dir }, "a")).toMatchObject({ ok: true, inputs: [{ source: "npm:keep" }], note: "install from npm:keep; installs the latest release" });
  });

  it("never stages a settings document through the grid paste: the editor does that", () => {
    const doc = { kind: "doc" as const, pluginId: OWN_PLUGIN_ID, settingsId: "s", sourceHost: "hub", version: 1, values: {}, maskedPaths: [] };
    const state = run([hub, host("a")], { type: "copyDoc", entry: doc }, { type: "togglePasteTarget", hostId: "a" });
    expect(mhmReducer(state, { type: "paste", hostId: "a" }).staged).toEqual([]);
    const pasted = mhmReducer(state, { type: "pasteTargets" });
    expect(pasted.staged).toEqual([]);
    expect(pasted.pasteTargets).toEqual([]);
  });

  it("refuses a directory plugin that no host can hand on", () => {
    const dir = plugin("local", { source: source("directory", null) });
    const state = run([host("hub", { isHub: true, data: data({ plugins: [dir] }) }), host("a", { data: data({ plugins: [] }) })]);
    expect(planPaste(state, { kind: "plugin", pluginId: "local", sourceHost: "hub", plugin: dir }, "a")).toMatchObject({ ok: false, reason: expect.stringContaining("directory") });
  });

  it("pastes a settings document only where the companion runs and writes are allowed", () => {
    const doc = { kind: "doc" as const, pluginId: "keep", settingsId: "display", sourceHost: "hub", version: 1, values: { mode: "x" }, maskedPaths: [] };
    const withDoc = data({ plugins: [plugin("keep")], companion: { state: "ok", platform: "win32", arch: "x64", consent: { allowPluginSettingsWrites: true }, settingsDocuments: [{ pluginId: "keep", settingsId: "display", revision: "r7", hasBackup: false }] } });
    const noConsent = data({ plugins: [plugin("keep")], companion: { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: false }, settingsDocuments: [] } });
    const fresh = data({ plugins: [plugin("keep")] });
    const state = run([hub, host("a", { data: withDoc }), host("b", { data: noConsent }), host("c", { data: fresh }), host("d", { data: data({ plugins: [plugin("keep")], companion: { state: "missing" } }) })]);
    expect(planPaste(state, doc, "a")).toMatchObject({ ok: true, inputs: [{ op: "writeSettingsDoc", expectedRevision: "r7", values: { mode: "x" } }] });
    expect(planPaste(state, doc, "c")).toMatchObject({ ok: true, inputs: [{ expectedRevision: "missing" }] });
    expect(planPaste(state, doc, "b")).toMatchObject({ ok: false, reason: expect.stringContaining("opt-in") });
    expect(planPaste(state, doc, "d")).toMatchObject({ ok: false, reason: expect.stringContaining("multi-host-manager") });
    expect(planPaste(state, { ...doc, pluginId: OWN_PLUGIN_ID, sourceHost: "a" }, "hub")).toMatchObject({ ok: false, reason: expect.stringContaining("own settings") });
  });

  it("pastes to several selected hosts in one go", () => {
    const off = (id: string) => host(id, { data: data({ rows: { mcp: ok(false) } }) });
    const state = run(
      [hub, off("a"), off("b"), host("c")],
      { type: "copy", ref: { kind: "row", rowId: "mcp", hostId: "hub" } },
      { type: "togglePasteTarget", hostId: "a" },
      { type: "togglePasteTarget", hostId: "b" },
      { type: "togglePasteTarget", hostId: "c" },
      { type: "pasteTargets" },
    );
    expect(state.staged.map((entry) => entry.item.host)).toEqual(["reg-a", "reg-b"]);
    expect(state.pasteTargets).toEqual([]);
  });
});

describe("staging queue", () => {
  const relayOff = { op: "setRow" as const, host: "reg-a", rowId: "relay", value: false };

  it("keeps one item per host and slot, replacing in place", () => {
    const state = run(
      [hub, host("a")],
      { type: "stage", inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: false }, { op: "installPlugin", host: "reg-a", source: "npm:x", pluginId: "x" }] },
      { type: "stage", inputs: [{ op: "removePlugin", host: "reg-a", pluginId: "x" }, { op: "setRow", host: "reg-a", rowId: "mcp", value: true }] },
    );
    expect(state.staged.map((entry) => [entry.item.id, entry.item.op])).toEqual([
      ["reg-a/row:mcp", "setRow"],
      ["reg-a/plugin:x:presence", "removePlugin"],
    ]);
    expect(slotOf({ op: "restoreSettingsDoc", host: "h", pluginId: "p", settingsId: "s", expectedRevision: "r" })).toBe(slotOf({ op: "writeSettingsDoc", host: "h", pluginId: "p", settingsId: "s", expectedRevision: "r", version: 1, values: {} }));
  });

  it("flags relay off over the relay and on the hub, plugins off anywhere, and this plugin off on a remote as lockout", () => {
    const state = run(
      [hub, host("a"), host("s", { link: "ssh" })],
      {
        type: "stage",
        inputs: [
          relayOff,
          { op: "setRow", host: "reg-s", rowId: "relay", value: false },
          { op: "setRow", host: "hub", rowId: "relay", value: false },
          { op: "setRow", host: "reg-s", rowId: "pen", value: false },
          { op: "setRow", host: "reg-s", rowId: "pen", value: true },
          { op: "setPluginEnabled", host: "reg-a", pluginId: OWN_PLUGIN_ID, enabled: false },
          { op: "removePlugin", host: "reg-s", pluginId: OWN_PLUGIN_ID },
        ],
      },
    );
    expect(state.staged.map((entry) => [entry.item.id, entry.requires])).toEqual([
      ["reg-a/row:relay", ["lockout"]],
      ["reg-s/row:relay", []],
      ["hub/row:relay", ["lockout"]],
      ["reg-s/row:pen", []],
      [`reg-a/plugin:${OWN_PLUGIN_ID}:enabled`, ["lockout"]],
      [`reg-s/plugin:${OWN_PLUGIN_ID}:presence`, ["destructive", "lockout"]],
    ]);
  });

  it("refuses to disable or remove this plugin on the hub", () => {
    const state = run([hub], { type: "stage", inputs: [{ op: "setPluginEnabled", host: "hub", pluginId: OWN_PLUGIN_ID, enabled: false }, { op: "removePlugin", host: "hub", pluginId: OWN_PLUGIN_ID }] });
    expect(state.staged).toEqual([]);
  });

  it("asks for lockout, then destructive, then trust before Apply, and sends confirmed only when all are given", () => {
    let state = run(
      [hub, host("a")],
      { type: "stage", inputs: [{ op: "installPlugin", host: "reg-a", source: "npm:x", pluginId: "x" }, { op: "removePlugin", host: "reg-a", pluginId: OWN_PLUGIN_ID }, relayOff] },
    );
    const own = `reg-a/plugin:${OWN_PLUGIN_ID}:presence`;
    expect(nextConfirmation(state.staged)).toEqual({ kind: "lockout", itemIds: [own, "reg-a/row:relay"] });
    state = mhmReducer(state, { type: "confirm", ids: [own, "reg-a/row:relay"], kind: "lockout" });
    expect(nextConfirmation(state.staged)).toEqual({ kind: "destructive", itemIds: [own] });
    expect(applyInput(state.staged, policy).items.find((item) => item.id === own)).not.toHaveProperty("confirmed");
    state = mhmReducer(state, { type: "confirm", ids: [own], kind: "destructive" });
    state = mhmReducer(state, { type: "confirm", ids: ["reg-a/plugin:x:presence"], kind: "trust" });
    expect(nextConfirmation(state.staged)).toBeNull();
    const input = applyInput(state.staged, policy);
    expect(input.allowPrerelease).toBe(false);
    expect(input.items.map((item) => [item.id, "confirmed" in item ? item.confirmed : undefined])).toEqual([
      ["reg-a/plugin:x:presence", true],
      [own, true],
      ["reg-a/row:relay", true],
    ]);
  });

  it("drops confirmations when an item is restaged", () => {
    let state = run([hub, host("a")], { type: "stage", inputs: [relayOff] }, { type: "confirm", ids: ["reg-a/row:relay"], kind: "lockout" });
    state = mhmReducer(state, { type: "stage", inputs: [relayOff] });
    expect(state.staged[0].confirmed).toEqual([]);
  });

  it("records per-item results, keeps failures for Retry and resends only what did not apply", () => {
    let state = run(
      [hub, host("a")],
      { type: "stage", inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: false }, { op: "setRow", host: "reg-a", rowId: "sys", value: "x" }, { op: "updatePlugin", host: "reg-a", pluginId: "k" }] },
      { type: "applyStarted" },
    );
    expect(state.applying).toBe(true);
    expect(state.staged.every((entry) => entry.status === "applying")).toBe(true);
    const results: ApplyResult[] = [
      { id: "reg-a/row:mcp", host: "reg-a", op: "setRow", outcome: { status: "ok" } },
      { id: "reg-a/row:sys", host: "reg-a", op: "setRow", outcome: { status: "failed", error: { code: "host_error", message: "boom" } } },
      { id: "reg-a/plugin:k:version", host: "reg-a", op: "updatePlugin", outcome: { status: "skipped", dependsOn: "reg-a/row:sys" } },
    ];
    state = mhmReducer(state, { type: "applyFinished", results });
    expect(state.staged.map((entry) => entry.status)).toEqual(["ok", "failed", "skipped"]);
    expect(rowCellView(state, "sys", "a").detail).toBe("boom");
    expect(applyInput(state.staged, policy).items.map((item) => item.id)).toEqual(["reg-a/row:sys", "reg-a/plugin:k:version"]);
    state = mhmReducer(state, { type: "clearApplied" });
    expect(state.staged.map((entry) => entry.item.id)).toEqual(["reg-a/row:sys", "reg-a/plugin:k:version"]);
  });

  it("resends only pending, failed and skipped items; ignored and unknown ones wait", () => {
    const inputs = ["mcp", "sys", "hooks"].map((rowId) => ({ op: "setRow" as const, host: "reg-a", rowId, value: false }));
    let state = run([hub, host("a")], { type: "stage", inputs }, { type: "applyStarted" });
    state = mhmReducer(state, {
      type: "applyFinished",
      results: [
        { id: "reg-a/row:mcp", host: "reg-a", op: "setRow", outcome: { status: "ignored", paths: ["mcp.injectIntoAgents"] } },
        { id: "reg-a/row:sys", host: "reg-a", op: "setRow", outcome: { status: "failed", error: { code: "host_error", message: "boom" } } },
        { id: "reg-a/row:hooks", host: "reg-a", op: "setRow", outcome: { status: "ok" } },
      ],
    });
    expect(applyInput(state.staged, policy).items.map((item) => item.id)).toEqual(["reg-a/row:sys"]);
    state = mhmReducer(state, { type: "applyStarted" });
    expect(state.staged.map((entry) => entry.status)).toEqual(["ignored", "applying", "ok"]);
  });

  it("keeps a written document's validity-unknown marker past clearApplied until the plugin reloads or it is dismissed", () => {
    const write = { op: "writeSettingsDoc" as const, host: "reg-a", pluginId: "keep", settingsId: "display", expectedRevision: "r1", version: 1, values: {} };
    const docOk = { status: "ok" as const, revision: "r2", validity: "unknown" as const, reloadSuggested: true, keptMaskedPaths: ["token"], backedUp: true };
    const withKeep = host("a", { data: data({ plugins: [plugin("keep")] }) });
    let state = run([hub, withKeep], { type: "stage", inputs: [write] }, { type: "applyStarted" });
    state = mhmReducer(state, { type: "applyFinished", results: [{ id: "reg-a/doc:keep/display", host: "reg-a", op: "writeSettingsDoc", outcome: docOk }] });
    state = mhmReducer(state, { type: "clearApplied" });
    expect(state.staged).toEqual([]);
    expect(state.writtenDocs).toEqual([{ host: "reg-a", pluginId: "keep", settingsId: "display", op: "writeSettingsDoc", keptMaskedPaths: ["token"], backedUp: true }]);
    const row = pluginRows(state.hosts).find((candidate) => candidate.id === "keep");
    if (!row) throw new Error("no keep row");
    expect(pluginCellView(state, row, "a")).toMatchObject({ tone: "attention", detail: expect.stringContaining("validity unknown") });
    expect(mhmReducer(state, { type: "dismissWritten", host: "reg-a", pluginId: "keep", settingsId: "display" }).writtenDocs).toEqual([]);
    state = mhmReducer(state, { type: "stage", inputs: [{ op: "reloadPlugin", host: "reg-a", pluginId: "keep" }] });
    state = mhmReducer(state, { type: "applyStarted" });
    const failedReload = mhmReducer(state, { type: "applyFinished", results: [{ id: "reg-a/plugin:keep:reload", host: "reg-a", op: "reloadPlugin", outcome: { status: "failed", error: { code: "host_error", message: "x" } } }] });
    expect(failedReload.writtenDocs).toHaveLength(1);
    state = mhmReducer(state, { type: "applyFinished", results: [{ id: "reg-a/plugin:keep:reload", host: "reg-a", op: "reloadPlugin", outcome: { status: "ok", pluginId: "keep" } }] });
    expect(state.writtenDocs).toEqual([]);
  });

  it("shows a providers paste that updated some providers as applied, with the ignored ones", () => {
    let state = run([hub, host("a")], { type: "stage", inputs: [{ op: "setRow", host: "reg-a", rowId: "prov", value: { x: { enabled: true } } }] }, { type: "applyStarted" });
    state = mhmReducer(state, { type: "applyFinished", results: [{ id: "reg-a/row:prov", host: "reg-a", op: "setRow", outcome: { status: "ok", ignoredPaths: ["providers.y"] } }] });
    expect(rowCellView(state, "prov", "a")).toMatchObject({ tone: "applied", detail: "applied; ignored: providers.y" });
  });

  it("treats a lost response after switching the hub's plugins off as unknown, other transport errors as failures", () => {
    const hubOff = run([hub, host("a")], { type: "stage", inputs: [{ op: "setRow", host: "hub", rowId: "pen", value: false }, { op: "setRow", host: "reg-a", rowId: "mcp", value: false }] }, { type: "applyStarted" }, { type: "applyFailed", message: "connection closed" });
    expect(hubOff.staged.map((entry) => entry.status)).toEqual(["unknown", "unknown"]);
    const plain = run([hub, host("a")], { type: "stage", inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: false }] }, { type: "applyStarted" }, { type: "applyFailed", message: "timeout" });
    expect(plain.staged[0]).toMatchObject({ status: "failed", outcome: { status: "failed", error: { message: "timeout" } } });
  });

  it("does not change the queue while applying", () => {
    const state = run([hub, host("a")], { type: "stage", inputs: [relayOff] }, { type: "applyStarted" }, { type: "unstage", id: "reg-a/row:relay" }, { type: "discardAll" });
    expect(state.staged).toHaveLength(1);
  });
});

describe("grid reloads", () => {
  it("follows a host whose id flipped from registration id to server id, and drops hosts that are gone", () => {
    const before = host("reg-a", { registrationId: "reg-a" });
    let state = run(
      [hub, before, host("b")],
      { type: "select", ref: { kind: "row", rowId: "mcp", hostId: "reg-a" } },
      { type: "copy", ref: { kind: "row", rowId: "mcp", hostId: "reg-a" } },
      { type: "togglePasteTarget", hostId: "b" },
      { type: "setCompare", into: "reg-a", from: "b" },
    );
    state = mhmReducer(state, { type: "gridLoaded", hosts: [hub, host("srv-a", { registrationId: "reg-a" })] });
    expect(state.selection?.hostId).toBe("srv-a");
    expect(state.clipboard?.sourceHost).toBe("srv-a");
    expect(state.pasteTargets).toEqual([]);
    expect(state.compare).toEqual({ into: "srv-a", from: "hub" });
  });

  it("matches staged items to cells by registration id after the flip", () => {
    let state = run([hub, host("reg-a", { registrationId: "reg-a", data: data({ rows: { mcp: ok(true) } }) })], { type: "stage", inputs: [{ op: "setRow", host: "reg-a", rowId: "mcp", value: false }] });
    state = mhmReducer(state, { type: "gridLoaded", hosts: [hub, host("srv-a", { registrationId: "reg-a" })] });
    expect(rowCellView(state, "mcp", "srv-a").text).toBe("on -> off");
  });
});

describe("broker policy", () => {
  it("adds and removes insecure-link hosts without duplicates", () => {
    const once = withInsecureLink(policy, "r2", true);
    expect(withInsecureLink(withInsecureLink(once, "r1", true), "r2", true).insecureLinkRegistrationIds).toEqual(["r1", "r2"]);
    expect(withInsecureLink(once, "r2", false).insecureLinkRegistrationIds).toEqual([]);
  });
});

describe("palette", () => {
  it("adds alpha to hex and rgb theme colors and leaves other notations alone", () => {
    expect(tint("#5b8cff", 0.5)).toBe("#5b8cff80");
    expect(tint("#abc", 1)).toBe("#aabbccff");
    expect(tint("rgb(1, 2, 3)", 0.25)).toBe("rgba(1, 2, 3, 0.25)");
    expect(tint("hsl(1 2% 3%)", 0.25)).toBe("hsl(1 2% 3%)");
  });
});
