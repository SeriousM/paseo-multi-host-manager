import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { hostRemoveRpc } from "../../shared/contracts";
import type { DaemonClient, HostSummary } from "../../server/broker/daemon-client";
import { removeHost } from "../../server/broker/host-remove";
import { OriginSession } from "../../server/broker/origin-session";
import { codedError, savedHost, SECRETS, serverInfo } from "./broker-fakes";

function hubFake(hosts: HostSummary[], features = ["connectedHosts", "hostMultiplexing"]) {
  const fake = { removed: [] as string[], fail: null as Error | null, session: null as unknown as OriginSession };
  const client = {
    isConnected: true,
    close: async () => undefined,
    getLastServerInfoMessage: () => serverInfo("srv_hub", "0.14.0", features),
    listHosts: async () => ({ self: { serverId: "srv_hub", label: "hub" }, hosts }),
    removeHost: async (registrationId: string) => {
      if (fake.fail) throw fake.fail;
      fake.removed.push(registrationId);
    },
  };
  fake.session = new OriginSession(async () => client as unknown as DaemonClient);
  return fake;
}

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const input = (registrationId: string) => hostRemoveRpc.input.parse({ ...policy, registrationId });
const RELAY = `relay://${SECRETS.relayEndpoint}/srv_w`;
// A host the hub cannot authenticate to: the main reason to remove one.
const failing = savedHost("srv_w", RELAY, { registrationId: "hst_w", status: "error", error: { code: "authentication_failed", message: `bad password for ${SECRETS.relayEndpoint}` } });
const neverReached = savedHost(null, `tcp://${SECRETS.tcpHost}:6767`, { registrationId: "hst_new", status: "offline" });

let logs: MockInstance[] = [];
beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
});
afterEach(() => {
  for (const spy of logs) spy.mockRestore();
});

function expectNoLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const needle of [SECRETS.relayEndpoint, SECRETS.tcpHost, SECRETS.password]) expect(serialized.includes(needle)).toBe(false);
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
}

describe("mhm.hosts.remove", () => {
  it("removes a host the hub cannot reach, by registration id or by server id", async () => {
    const hub = hubFake([failing, neverReached]);
    expect(await removeHost(hub.session, "no-home", input("hst_w"))).toEqual({ ok: true });
    expect(await removeHost(hub.session, "no-home", input("hst_new"))).toEqual({ ok: true });
    expect(await removeHost(hub.session, "no-home", input("srv_w"))).toEqual({ ok: true });
    expect(hub.removed).toEqual(["hst_w", "hst_new", "hst_w"]);
  });

  it("refuses the hub itself and ids that are not saved hosts, and removes nothing", async () => {
    const hub = hubFake([failing]);
    expect(await removeHost(hub.session, "no-home", input("srv_hub"))).toMatchObject({ ok: false, error: { code: "invalid_item", detail: "self_target" } });
    expect(await removeHost(hub.session, "no-home", input("hst_other"))).toMatchObject({ ok: false, error: { code: "invalid_item", detail: "unknown_host" } });
    expect(hub.removed).toEqual([]);
  });

  it("maps a daemon failure to its code with a fixed text", async () => {
    const hub = hubFake([failing]);
    hub.fail = codedError(`Only the source can remove ${RELAY}`, "permission_denied");
    const result = await removeHost(hub.session, "no-home", input("hst_w"));
    expect(result).toEqual({ ok: false, error: { code: "host_error", message: "The host operation failed.", detail: "permission_denied" } });
    expect(hostRemoveRpc.output.parse(result)).toBeDefined();
    expectNoLeak(result);
  });

  it("refuses when the hub lacks connected hosts", async () => {
    const hub = hubFake([failing], ["hostMultiplexing"]);
    expect(await removeHost(hub.session, "no-home", input("hst_w"))).toMatchObject({ ok: false, error: { code: "unsupported_capability" } });
    expect(hub.removed).toEqual([]);
  });
});
