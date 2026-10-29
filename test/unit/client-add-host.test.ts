import { describe, expect, it } from "vitest";
import { addFailureText, addHostView } from "../../client/dialogs/add-host-rules";
import type { AddHostForm } from "../../client/dialogs/add-host-rules";
import { gridLayout, hubOnly, PANEL_MIN_WIDTH } from "../../client/grid/layout";
import { SIZES } from "../../client/grid/palette";
import { INITIAL_STATE, mhmReducer } from "../../client/state/reducer";
import type { GridHost } from "../../client/state/types";

const form = (connection: string, extra: Partial<AddHostForm> = {}): AddHostForm => ({ connection, label: "", unencryptedConfirmed: false, hubAskedConfirm: false, ...extra });

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
