import { describe, expect, it } from "vitest";
import { addFailureText, addHostView, reachText, setPasswordView } from "../../client/dialogs/add-host-rules";
import { removeFailureText, removeHostView } from "../../client/dialogs/remove-host-rules";
import type { AddHostForm } from "../../client/dialogs/add-host-rules";
import { gridLayout, hubOnly, PANEL_MIN_WIDTH } from "../../client/grid/layout";
import { SIZES } from "../../client/grid/palette";
import { INITIAL_STATE, mhmReducer } from "../../client/state/reducer";
import type { GridHost, MhmState, StagedItem } from "../../client/state/types";

const form = (connection: string, extra: Partial<AddHostForm> = {}): AddHostForm => ({ connection, label: "", password: "", unencryptedConfirmed: false, hubAskedConfirm: false, ...extra });

describe("add host dialog", () => {
  it("allows Add for an encrypted link without the confirmation", () => {
    expect(addHostView(form("relay://relay.example:443/srv?key=k&password=p"))).toMatchObject({ link: "relay", needsConfirm: false, canAdd: true, severity: "ok" });
    expect(addHostView(form("https://app.paseo.sh/#offer=abc"))).toMatchObject({ link: "relay", canAdd: true });
    expect(addHostView(form("127.0.0.1:6768"))).toMatchObject({ link: "loopback", canAdd: true });
  });

  it("asks for the not-encrypted confirmation for plain tcp and enables Add only once it is ticked", () => {
    expect(addHostView(form("tcp://10.0.0.5:6767?password=p"))).toMatchObject({ link: "tcp-plain", needsConfirm: true, canAdd: false, severity: "warn" });
    expect(addHostView(form("10.0.0.5:6767", { unencryptedConfirmed: true }))).toMatchObject({ needsConfirm: true, canAdd: true });
  });

  it("shows the confirmation when the hub asked for it, whatever the local hint says", () => {
    expect(addHostView(form("wss://paseo.example.com", { hubAskedConfirm: true }))).toMatchObject({ link: "tls", needsConfirm: true, canAdd: false });
  });

  it("refuses empty, invalid and pasted CLI commands with a reason that does not repeat the input", () => {
    expect(addHostView(form("  "))).toMatchObject({ canAdd: false, severity: "muted" });
    const command = addHostView(form("paseo host add relay://secret.example:443/srv?key=k"));
    expect(command).toMatchObject({ canAdd: false, severity: "bad" });
    expect(command.note).not.toContain("secret.example");
    const invalid = addHostView(form("http://secret.example/"));
    expect(invalid).toMatchObject({ link: null, canAdd: false, severity: "bad" });
    expect(invalid.note).not.toContain("secret.example");
  });

  it("refuses a label longer than the hub accepts", () => {
    expect(addHostView(form("127.0.0.1:6768", { label: "x".repeat(81) }))).toMatchObject({ canAdd: false, severity: "bad" });
  });

  it("points an insecure-link refusal at the checkbox and keeps the fixed texts otherwise", () => {
    expect(addFailureText({ code: "insecure_link", message: "m", detail: "unencrypted_link" })).toContain("Tick the confirmation");
    expect(addFailureText({ code: "host_error", message: "The host operation failed.", detail: "resource_limit" })).toContain("128");
    expect(addFailureText({ code: "invalid_connection", message: "fixed" })).toBe("fixed");
  });
});

function host(id: string, options: { isHub?: boolean; registrationId?: string | null; ok?: boolean } = {}): GridHost {
  return {
    id,
    registrationId: options.registrationId === undefined ? (options.isHub ? null : `reg-${id}`) : options.registrationId,
    label: id,
    link: "relay",
    isHub: options.isHub ?? false,
    result: options.ok === false ? { ok: false, error: { code: "host_offline", message: "offline" } } : { ok: true, snapshot: { serverId: id, version: "0.14.0", protocolVersion: 1, prerelease: false, features: [] }, value: { rows: {}, plugins: [], companion: { state: "missing" } } },
  };
}

describe("hostAdded", () => {
  it("closes the dialog and selects the new column on the first load that has it, also after its id flipped", () => {
    const hub = host("srv_hub", { isHub: true });
    let state = mhmReducer({ ...INITIAL_STATE, dialog: { kind: "addHost" } }, { type: "gridLoaded", hosts: [hub] });
    state = mhmReducer(state, { type: "hostAdded", registrationId: "hst_new" });
    expect(state.dialog).toBeNull();
    // A load from before the add does not know the host yet: the focus waits.
    state = mhmReducer(state, { type: "gridLoaded", hosts: [hub] });
    expect(state.selection).toBeNull();
    expect(state.focusHost).toBe("hst_new");
    state = mhmReducer(state, { type: "gridLoaded", hosts: [hub, host("srv_new", { registrationId: "hst_new" })] });
    expect(state.selection).toEqual({ kind: "host", hostId: "srv_new" });
    expect(state.focusHost).toBeNull();
    expect(state.compare).toEqual({ into: "srv_hub", from: "srv_new" });
  });
});

describe("grid layout", () => {
  const room = (width: number) => width - SIZES.labelWidth - 1;

  it("lets two hosts share a wide screen up to the maximum column width", () => {
    expect(gridLayout(1600, 2, false)).toEqual({ columnWidth: SIZES.maxColumnWidth, panelWidth: 0, contentWidth: 2 * SIZES.maxColumnWidth });
    expect(gridLayout(1100, 2, false).columnWidth).toBe(Math.floor(room(1100) / 2));
  });

  it("keeps the minimum width and scrolls when the hosts do not fit", () => {
    const layout = gridLayout(900, 6, false);
    expect(layout.columnWidth).toBe(SIZES.minColumnWidth);
    expect(layout.contentWidth).toBe(6 * SIZES.minColumnWidth);
  });

  it("uses the minimum before the width was measured", () => {
    expect(gridLayout(0, 3, false).columnWidth).toBe(SIZES.minColumnWidth);
  });

  it("puts the explanation panel next to a lone hub and fills the rest of the row with it", () => {
    const layout = gridLayout(1400, 1, true);
    expect(layout.panelWidth).toBe(room(1400) - layout.columnWidth);
    expect(layout.contentWidth).toBe(room(1400));
    expect(gridLayout(500, 1, true).panelWidth).toBe(PANEL_MIN_WIDTH);
  });

  it("calls only a reachable lone hub hub-only", () => {
    expect(hubOnly([host("h", { isHub: true })])).toBe(true);
    expect(hubOnly([host("h", { isHub: true, ok: false })])).toBe(false);
    expect(hubOnly([host("h", { isHub: true }), host("w")])).toBe(false);
  });
});

describe("remove saved host", () => {
  const hub = host("srv_hub", { isHub: true });
  const w = host("srv_w", { registrationId: "reg_w", ok: false });
  const l = host("srv_l", { registrationId: "reg_l" });
  const staged = (id: string, hostRef: string): StagedItem => ({
    item: { id, host: hostRef, op: "setRow", rowId: "mcp", value: true },
    status: "pending",
    outcome: null,
    requires: [],
    confirmed: [],
  });
  const loaded = (): MhmState => ({
    ...mhmReducer(INITIAL_STATE, { type: "gridLoaded", hosts: [hub, w, l] }),
    staged: [staged("reg_w/row:mcp", "reg_w"), staged("reg_l/row:mcp", "reg_l")],
    writtenDocs: [{ host: "reg_w", pluginId: "p", settingsId: "s", op: "writeSettingsDoc", keptMaskedPaths: [], backedUp: false }],
    updateChecks: [{ host: "reg_w", pluginId: "p", version: "2" }],
    selection: { kind: "host", hostId: "srv_w" },
    clipboard: { kind: "row", rowId: "mcp", sourceHost: "srv_w", value: true },
    pasteTargets: ["srv_w", "srv_l"],
    compare: { into: "srv_hub", from: "srv_w" },
    baseline: "reg_w",
    onlyDifferences: true,
    dialog: { kind: "removeHost", hostId: "srv_w" },
  });

  it("drops the host's column, staged items and every reference to it, and keeps the rest", () => {
    const state = mhmReducer(loaded(), { type: "hostRemoved", hostId: "srv_w" });
    expect(state.hosts.map((candidate) => candidate.id)).toEqual(["srv_hub", "srv_l"]);
    expect(state.staged.map((entry) => entry.item.id)).toEqual(["reg_l/row:mcp"]);
    expect(state).toMatchObject({ writtenDocs: [], updateChecks: [], selection: null, clipboard: null, pasteTargets: ["srv_l"], baseline: null, onlyDifferences: false, dialog: null });
    expect(state.compare).toEqual({ into: "srv_hub", from: null });
  });

  it("does nothing to the queue while an apply runs, and never removes the hub", () => {
    const applying = { ...loaded(), applying: true };
    expect(mhmReducer(applying, { type: "hostRemoved", hostId: "srv_w" }).staged).toHaveLength(2);
    expect(mhmReducer(loaded(), { type: "hostRemoved", hostId: "srv_hub" }).hosts).toHaveLength(3);
  });

  it("offers removal for a failing host, counts its staged items, and blocks the hub and a running apply", () => {
    expect(removeHostView(loaded(), "srv_w")).toEqual({ label: "srv_w", registrationId: "reg_w", staged: 1, blocked: null });
    expect(removeHostView(loaded(), "srv_hub")?.blocked).toContain("cannot remove itself");
    expect(removeHostView({ ...loaded(), applying: true }, "srv_w")?.blocked).toContain("apply is running");
    expect(removeHostView(loaded(), "gone")).toBeNull();
  });

  it("explains the hub refusal and keeps the fixed failure texts", () => {
    expect(removeFailureText({ code: "invalid_item", message: "m", detail: "self_target" })).toBe("The hub cannot remove itself.");
    expect(removeFailureText({ code: "invalid_item", message: "m", detail: "unknown_host" })).toContain("Refresh the grid");
  });
});

describe("daemon password", () => {
  const hub = host("srv_hub", { isHub: true });
  const w = host("srv_w", { registrationId: "reg_w", ok: false });
  const state = mhmReducer(INITIAL_STATE, { type: "gridLoaded", hosts: [hub, w] });
  const secret = (connection: string, extra: Partial<AddHostForm> = {}) => ({ connection, password: "pw", unencryptedConfirmed: false, hubAskedConfirm: false, ...extra });

  it("lets Add take a password for any link but a socket path", () => {
    expect(addHostView(form("relay://relay.example:443/srv?key=k", { password: "pw" }))).toMatchObject({ canAdd: true });
    expect(addHostView(form("unix:///tmp/paseo.sock", { password: "pw" }))).toMatchObject({ canAdd: false, severity: "bad" });
    expect(addHostView(form("unix:///tmp/paseo.sock"))).toMatchObject({ canAdd: true });
  });

  it("needs the link again and a password, and keeps the unencrypted confirmation", () => {
    expect(setPasswordView(state, "srv_w", secret("relay://relay.example:443/srv_w?key=k"))).toMatchObject({ label: "srv_w", registrationId: "reg_w", canAdd: true, blocked: null });
    expect(setPasswordView(state, "srv_w", secret("relay://relay.example:443/srv_w?key=k", { password: "" }))?.canAdd).toBe(false);
    expect(setPasswordView(state, "srv_w", secret(""))?.canAdd).toBe(false);
    expect(setPasswordView(state, "srv_w", secret("10.0.0.5:6767"))).toMatchObject({ needsConfirm: true, canAdd: false });
    expect(setPasswordView(state, "srv_w", secret("10.0.0.5:6767", { unencryptedConfirmed: true }))?.canAdd).toBe(true);
  });

  it("is not offered on the hub or while an apply runs", () => {
    expect(setPasswordView(state, "srv_hub", secret("6767"))).toMatchObject({ canAdd: false, blocked: expect.stringContaining("without a password") });
    expect(setPasswordView({ ...state, applying: true }, "srv_w", secret("relay://relay.example:443/srv_w?key=k"))).toMatchObject({ canAdd: false, blocked: expect.stringContaining("apply is running") });
  });

  it("says whether the hub reaches the host after the save", () => {
    const saved = { id: "srv_w", registrationId: "reg_w", serverId: "srv_w", label: "laptop", link: "relay" as const };
    expect(reachText({ ...saved, status: "online", failure: null })).toEqual({ ok: true, text: "Saved. The hub reaches laptop now." });
    const wrong = reachText({ ...saved, status: "error", failure: { code: "authentication_failed", message: "The hub could not authenticate to this host. Check the saved host's password." } });
    expect(wrong.ok).toBe(false);
    expect(wrong.text).toContain("could not authenticate");
    expect(reachText({ ...saved, status: "error", failure: { code: "host_error", message: "m", detail: "duplicate_host" } }).text).toContain("Another saved host");
  });
});
