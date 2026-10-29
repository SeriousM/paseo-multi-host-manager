import { describe, expect, it } from "vitest";
import type { GridHostData, GridPlugin, HostFailure } from "../../shared/contracts";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { allOthersSelection, pasteChips } from "../../client/clipboard/paste-chips";
import { capabilityReport } from "../../client/dialogs/capability-report";
import { lockoutLines, removalLines, trustLines } from "../../client/dialogs/confirm-text";
import { installBlocker, parseInstallSource, pluginMenuRules, removeBlocker } from "../../client/dialogs/plugin-rules";
import { describeItem, groupStaged, installPin, statusView, summarize } from "../../client/drawer/staging-view";
import { failureText } from "../../client/state/failure-text";
import { INITIAL_STATE, mhmReducer } from "../../client/state/reducer";
import type { MhmAction } from "../../client/state/reducer";
import type { GridHost, MhmState } from "../../client/state/types";

const FEATURES = ["pluginManagement", "pluginSourceInstallation", "pluginSourceUpdates", "pluginSettings", "relayConfig", "hostMultiplexing"];

function plugin(id: string, overrides: Partial<GridPlugin> = {}): GridPlugin {
  return { id, name: id, version: "1.0.0", enabled: true, status: "running", source: { kind: "npm", installSource: `npm:${id}@1.0.0`, ref: null, pinned: true }, ...overrides };
}

const ok = (value: GridHostData["rows"][string]["value"]) => ({ state: "ok" as const, value, maskedPaths: [] });

function data(overrides: Partial<GridHostData> = {}): GridHostData {
  return {
    rows: { relay: ok(true), pen: ok(true), mcp: ok(true) },
    plugins: [plugin(OWN_PLUGIN_ID)],
    companion: { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: true }, settingsDocuments: [] },
    ...overrides,
  };
}

function host(id: string, options: { isHub?: boolean; link?: GridHost["link"]; version?: string; features?: string[]; data?: GridHostData } = {}): GridHost {
  const version = options.version ?? "0.13.2";
  return {
    id,
    registrationId: options.isHub ? null : `reg-${id}`,
    label: id,
    link: options.link ?? (options.isHub ? "loopback" : "relay"),
    isHub: options.isHub ?? false,
    result: { ok: true, snapshot: { serverId: id, version, protocolVersion: 1, prerelease: version.includes("-"), features: options.features ?? FEATURES }, value: options.data ?? data() },
  };
}

function offline(id: string): GridHost {
  return { id, registrationId: `reg-${id}`, label: id, link: "relay", isHub: false, result: { ok: false, error: { code: "host_offline", message: "Host is offline" } } };
}

function run(hosts: GridHost[], ...actions: MhmAction[]): MhmState {
  return actions.reduce(mhmReducer, mhmReducer(INITIAL_STATE, { type: "gridLoaded", hosts }));
}

const hub = host("hub", { isHub: true });

describe("install source input", () => {
  it("accepts registry ids, npm: and git: sources", () => {
    expect(parseInstallSource(" owner/name ")).toEqual({ ok: true, source: "owner/name", kind: "registry" });
    expect(parseInstallSource("plugins.example.org/owner/name")).toMatchObject({ ok: true, kind: "registry" });
    expect(parseInstallSource("npm:@scope/pkg@1.2.3")).toMatchObject({ ok: true, kind: "npm" });
    expect(parseInstallSource("git:https://github.com/owner/repo")).toMatchObject({ ok: true, kind: "git" });
    expect(parseInstallSource("git:ssh://git@github.com/owner/repo")).toMatchObject({ ok: true, kind: "git" });
  });

  it("rejects credentials in the URL with the server's rule, local directories and malformed text", () => {
    expect(parseInstallSource("git:https://user:secret@github.com/o/r")).toMatchObject({ ok: false, empty: false });
    expect(parseInstallSource("git:https://token@github.com/o/r")).toMatchObject({ ok: false });
    expect(parseInstallSource("/home/me/plugin")).toMatchObject({ ok: false });
    expect(parseInstallSource("C:\\plugins\\x")).toMatchObject({ ok: false });
    expect(parseInstallSource("./x")).toMatchObject({ ok: false });
    expect(parseInstallSource("npm:")).toMatchObject({ ok: false });
    expect(parseInstallSource("two words")).toMatchObject({ ok: false });
    expect(parseInstallSource("https://github.com/o/r")).toMatchObject({ ok: false });
    expect(parseInstallSource("   ")).toMatchObject({ ok: false, empty: true });
  });

  it("knows which sources pin a version", () => {
    expect(installPin("npm:pkg@1.2.3", undefined)).toBe("pinned");
    expect(installPin("npm:@scope/pkg@1.2.3:plugins/x", undefined)).toBe("pinned");
    expect(installPin("npm:pkg", undefined)).toBe("latest");
    expect(installPin("npm:pkg@latest", undefined)).toBe("latest");
    expect(installPin("git:https://h/o/r", "abc1234")).toBe("pinned");
    expect(installPin("git:https://h/o/r", undefined)).toBe("latest");
    expect(installPin("owner/name", undefined)).toBe("latest");
  });
});

describe("failure texts", () => {
  const failure = (code: HostFailure["code"], detail?: string): HostFailure => ({ code, message: `message for ${code}`, ...(detail ? { detail } : null) });

  it("explains each code in plain words", () => {
    expect(failureText(failure("invalid_item", "self_target"))).toContain("runs this view on the hub");
    expect(failureText(failure("invalid_item", "credentials_in_source"))).toContain("credentials");
    expect(failureText(failure("unsupported_capability", "pluginSettings"))).toContain("pluginSettings");
    expect(failureText(failure("lockout_confirmation_required"))).toContain("confirmation");
    expect(failureText(failure("confirmation_required"))).toContain("confirmation");
    expect(failureText(failure("host_offline"))).toBe("message for host_offline");
    expect(failureText(failure("invalid_item", "odd_thing"))).toBe("message for invalid_item (odd_thing)");
  });

  it("renders a settings conflict with the current revision", () => {
    expect(failureText(failure("host_error", "conflict"), "rev-9")).toBe("Changed on the host since it was read. Reload and retry. Current revision: rev-9.");
  });
});

describe("staging drawer view", () => {
  const stageAll = () =>
    run(
      [hub, host("a"), host("b")],
      {
        type: "stage",
        inputs: [
          { op: "setRow", host: "reg-a", rowId: "relay", value: false },
          { op: "setRow", host: "reg-a", rowId: "mcp", value: false },
          { op: "setRow", host: "reg-a", rowId: "pen", value: true },
          { op: "installPlugin", host: "reg-b", source: "owner/name", pluginId: "name" },
          { op: "setRow", host: "hub", rowId: "mcp", value: false },
        ],
      },
    );

  it("groups per host, hub last, in the server's apply order with 1-based positions", () => {
    const state = stageAll();
    const groups = groupStaged(state.staged, state.hosts);
    expect(groups.map((group) => group.label)).toEqual(["a", "b", "hub"]);
    expect(groups[0].items.map((item) => [item.position, item.view.title])).toEqual([
      [1, "Plugins enabled (global switch)"],
      [2, "Inject Paseo MCP into agents"],
      [3, "Relay enabled"],
    ]);
  });

  it("previews old and new values and marks unpinned installs", () => {
    const state = stageAll();
    expect(describeItem(state.staged[1].item, state.hosts[1])).toMatchObject({ kind: "set", note: "on -> off" });
    expect(describeItem(state.staged[3].item, state.hosts[2])).toMatchObject({ kind: "install", title: "name", note: "from owner/name; installs the latest release" });
  });

  it("tells what is waiting, what succeeded, what failed and what was skipped", () => {
    let state = stageAll();
    const [relay, mcp, pen, install] = state.staged.map((entry) => entry.item.id);
    expect(statusView(state.staged[0], state.staged, state.hosts)).toMatchObject({ label: "staged", detail: "Apply asks for lockout confirmation first" });
    state = mhmReducer(mhmReducer(state, { type: "applyStarted" }), {
      type: "applyFinished",
      results: [
        { id: relay, host: "reg-a", op: "setRow", outcome: { status: "ok", unverified: true } },
        { id: mcp, host: "reg-a", op: "setRow", outcome: { status: "ignored", paths: ["providers.x"] } },
        { id: pen, host: "reg-a", op: "setRow", outcome: { status: "failed", error: { code: "invalid_item", message: "bad", detail: "self_target" } } },
        { id: install, host: "reg-b", op: "installPlugin", outcome: { status: "skipped", dependsOn: pen } },
      ],
    });
    const view = (index: number) => statusView(state.staged[index], state.staged, state.hosts);
    expect(view(0)).toMatchObject({ label: "applied, not verified", severity: "warn" });
    expect(view(1)).toMatchObject({ label: "ignored", detail: "The host did not apply: providers.x" });
    expect(view(2)).toMatchObject({ label: "failed", severity: "bad" });
    expect(view(3)).toMatchObject({ label: "skipped", detail: "Not run: set Plugins enabled (global switch) did not succeed first." });
  });

  it("reports update checks and lost results", () => {
    const state = run([hub, host("a")], { type: "stage", inputs: [{ op: "updatePlugin", host: "reg-a", pluginId: "x", checkOnly: true }] });
    const id = state.staged[0].item.id;
    const done = mhmReducer(mhmReducer(state, { type: "applyStarted" }), { type: "applyFinished", results: [{ id, host: "reg-a", op: "updatePlugin", outcome: { status: "ok", pluginId: "x", updateOutcome: "update" } }] });
    expect(statusView(done.staged[0], done.staged, done.hosts)).toMatchObject({ label: "ok", detail: "an update is available (nothing was changed)" });
  });

  it("summarises counts and picks the Apply label", () => {
    const state = stageAll();
    expect(summarize(state.staged, false)).toMatchObject({ total: 5, pending: 5, outstanding: 5, applyLabel: "Apply (5)" });
    expect(summarize(state.staged, true).applyLabel).toBe("Applying...");
    const failed = mhmReducer(mhmReducer(state, { type: "applyStarted" }), {
      type: "applyFinished",
      results: state.staged.map((entry) => ({ id: entry.item.id, host: entry.item.host, op: entry.item.op, outcome: { status: "failed" as const, error: { code: "host_error" as const, message: "x" } } })),
    });
    expect(summarize(failed.staged, false)).toMatchObject({ failed: 5, pending: 0, applyLabel: "Retry failed" });
  });
});

describe("clipboard chips", () => {
  it("lists every other host with the paste plan or the reason, and selects only valid ones", () => {
    const differs = host("a", { data: data({ rows: { mcp: ok(false) } }) });
    const same = host("b");
    const state = run([hub, differs, same, offline("o")], { type: "copy", ref: { kind: "row", rowId: "mcp", hostId: "hub" } }, { type: "togglePasteTarget", hostId: "a" }, { type: "togglePasteTarget", hostId: "o" });
    const chips = pasteChips(state);
    expect(chips.map((chip) => chip.hostId)).toEqual(["a", "b", "o"]);
    expect(chips[0]).toMatchObject({ selectable: true, selected: true, note: "applied live" });
    expect(chips[1]).toMatchObject({ selectable: false, same: true, note: "identical" });
    expect(chips[2]).toMatchObject({ selectable: false, selected: false, same: false, note: "Host is offline" });
  });

  it("toggles 'all other hosts' between every valid host and none", () => {
    const state = run([hub, host("a", { data: data({ rows: { mcp: ok(false) } }) }), host("b", { data: data({ rows: { mcp: ok(false) } }) })], { type: "copy", ref: { kind: "row", rowId: "mcp", hostId: "hub" } });
    expect(allOthersSelection(pasteChips(state))).toEqual(["a", "b"]);
    const all = mhmReducer(state, { type: "setPasteTargets", hostIds: ["a", "b"] });
    expect(allOthersSelection(pasteChips(all))).toEqual([]);
  });

  it("tags plugin installs", () => {
    const state = run([hub, host("a", { data: data({ plugins: [] }) })], { type: "copy", ref: { kind: "plugin", pluginId: OWN_PLUGIN_ID, hostId: "hub" } });
    expect(pasteChips(state)[0]).toMatchObject({ selectable: true, tag: "install" });
  });
});

describe("confirmation texts", () => {
  it("lists installs with their source and whether they pin a version", () => {
    const state = run([hub, host("a")], {
      type: "stage",
      inputs: [
        { op: "installPlugin", host: "reg-a", source: "owner/name", pluginId: "name" },
        { op: "installPlugin", host: "reg-a", source: "npm:pkg@2.0.0", pluginId: "pkg" },
        { op: "removePlugin", host: "reg-a", pluginId: "old" },
      ],
    });
    const lines = trustLines(state.staged, state.hosts);
    expect(lines.map((line) => [line.host, line.title, line.pin])).toEqual([["a", "name", "latest"], ["a", "pkg", "pinned"]]);
    expect(lines[1].detail).toBe("npm:pkg@2.0.0 (pinned)");
    expect(removalLines(state.staged, state.hosts).map((line) => line.title)).toEqual(["old"]);
  });

  it("explains which host is cut off and why", () => {
    const state = run([hub, host("a")], {
      type: "stage",
      inputs: [
        { op: "setRow", host: "reg-a", rowId: "relay", value: false },
        { op: "setRow", host: "hub", rowId: "pen", value: false },
        { op: "setPluginEnabled", host: "reg-a", pluginId: OWN_PLUGIN_ID, enabled: false },
        { op: "setRow", host: "reg-a", rowId: "mcp", value: false },
      ],
    });
    const lines = lockoutLines(state.staged, state.hosts);
    expect(lines.map((line) => [line.host, line.title])).toEqual([
      ["a", "Relay enabled -> off"],
      ["hub", "Plugins enabled (global switch) -> off"],
      ["a", "Disable paseo-multi-host-manager"],
    ]);
    expect(lines[0].detail).toContain("hub reaches this host over its relay");
    expect(lines[1].detail).toContain("This view stops working");
  });
});

describe("capability report", () => {
  it("classifies the version and lists missing features with what they block", () => {
    expect(capabilityReport(host("a")).tier).toBe("tested");
    expect(capabilityReport(host("a", { version: "0.14.0" })).tier).toBe("untested");
    expect(capabilityReport(host("a", { version: "0.14.0-beta.2" })).tier).toBe("prerelease");
    const report = capabilityReport(host("a", { features: ["pluginManagement"] }));
    expect(report.missing).toBeGreaterThan(0);
    expect(report.features.find((feature) => feature.flag === "pluginSourceUpdates")).toMatchObject({ present: false, since: "0.9.0" });
    expect(capabilityReport(offline("o"))).toMatchObject({ tier: "unknown", hasSnapshot: false, features: [] });
  });
});

describe("plugin dialog rules", () => {
  const empty = host("e", { data: data({ plugins: [] }) });
  const state = run([hub, empty, offline("o")]);

  it("blocks installs where they cannot work", () => {
    expect(installBlocker(state, empty, "x")).toBeNull();
    expect(installBlocker(state, hub, OWN_PLUGIN_ID)).toMatch(/already installed/);
    expect(installBlocker(state, offline("o"), "x")).toBe("Host is offline");
    expect(installBlocker(state, host("n", { features: ["pluginManagement"] }), "x")).toBe("host lacks pluginSourceInstallation");
    expect(installBlocker(state, host("p", { data: data({ rows: { pen: ok(false) } }) }), "x")).toMatch(/plugins are switched off/);
    expect(installBlocker(state, hub, "")).toBeNull();
  });

  it("never offers removing this plugin from the hub", () => {
    expect(removeBlocker(hub, OWN_PLUGIN_ID)).toBe("runs this view on the hub");
    expect(removeBlocker(host("a"), OWN_PLUGIN_ID)).toBeNull();
    expect(removeBlocker(empty, "x")).toBe("not installed");
    expect(pluginMenuRules(hub, OWN_PLUGIN_ID).selfOnHub).toBe(true);
    expect(pluginMenuRules(host("a"), OWN_PLUGIN_ID).selfOnHub).toBe(false);
  });

  it("gates update and the settings editor", () => {
    const dir = host("d", { data: data({ plugins: [plugin("loc", { source: { kind: "directory", installSource: null, ref: null, pinned: false } })] }) });
    expect(pluginMenuRules(dir, "loc").update).toBe("local plugins have no update source");
    expect(pluginMenuRules(host("a", { features: ["pluginManagement"] }), OWN_PLUGIN_ID).update).toBe("host lacks pluginSourceUpdates");
    expect(pluginMenuRules(host("a"), OWN_PLUGIN_ID)).toMatchObject({ update: null, manage: null, editor: "no settings document on this host" });
    const withDoc = host("w", { data: data({ companion: { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: true }, settingsDocuments: [{ pluginId: "x", settingsId: "main", revision: "r", hasBackup: false }] } }) });
    expect(pluginMenuRules(withDoc, "x")).toMatchObject({ documents: ["main"], editor: null });
  });
});
