import { afterEach, describe, expect, it, vi } from "vitest";
import { docReadRpc } from "../../shared/contracts";
import { connectRoutedClient } from "../../server/broker/daemon-client";
import type * as DaemonClientModule from "../../server/broker/daemon-client";
import { OriginSession } from "../../server/broker/origin-session";
import { readDoc } from "../../server/rpc/doc";
import { savedHost } from "./broker-fakes";
import { ALL_FEATURES, plugin, pluginFake } from "./rpc-fakes";

vi.mock("../../server/broker/daemon-client", async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonClientModule>()),
  connectRoutedClient: vi.fn(),
}));

const routed = vi.mocked(connectRoutedClient);
const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const input = { host: "srv_W", pluginId: "keep-awake", settingsId: "display" };
afterEach(() => routed.mockReset());

function setup(features = ALL_FEATURES) {
  const answer = { ok: true, revision: "r1", version: 1, values: { mode: "display", token: "<masked>" }, maskedPaths: ["token"], hasBackup: false };
  const W = pluginFake("srv_W", { features, plugins: [plugin("paseo-multi-host-manager")], rpc: { "mhm.settings.read": answer } });
  const hub = pluginFake("srv_hub", { hosts: [savedHost("srv_W", "relay://x/srv_W")] });
  routed.mockResolvedValue(W.routed);
  return { W, session: new OriginSession(async () => hub.client), answer };
}

describe("readDoc", () => {
  it("returns the masked document of the host's companion in the contract's shape", async () => {
    const { W, session, answer } = setup();
    const result = await readDoc(session, "no-home", policy, input);
    expect(result).toMatchObject({ ok: true, value: answer });
    expect(docReadRpc.output.parse(result)).toBeDefined();
    expect(W.rpc).toHaveBeenCalledWith("paseo-multi-host-manager", "mhm.settings.read", { pluginId: "keep-awake", settingsId: "display" });
  });

  it("fails for an unknown host and for a host without pluginSettings", async () => {
    const { session } = setup();
    expect(await readDoc(session, "no-home", policy, { ...input, host: "srv_nope" })).toMatchObject({ ok: false, error: { detail: "unknown_host" } });
    const old = setup(ALL_FEATURES.filter((flag) => flag !== "pluginSettings"));
    expect(await readDoc(old.session, "no-home", policy, input)).toMatchObject({ ok: false, error: { code: "unsupported_capability", detail: "pluginSettings" } });
    expect(old.W.rpc).not.toHaveBeenCalled();
  });
});
