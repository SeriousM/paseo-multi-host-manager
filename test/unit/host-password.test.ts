import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { hostAddRpc, hostSetPasswordRpc } from "../../shared/contracts";
import { connectionWithPassword } from "../../server/broker/connection-password";
import { parseHostTarget } from "../../server/broker/daemon-client";
import type { DaemonClient, HostSummary } from "../../server/broker/daemon-client";
import { addHost } from "../../server/broker/host-add";
import { setHostPassword } from "../../server/broker/host-password";
import { OriginSession } from "../../server/broker/origin-session";
import { codedError, savedHost, SECRETS, serverInfo } from "./broker-fakes";

const PASSWORD = "p@ss w0rd&=#secret";
const RELAY = `relay://${SECRETS.relayEndpoint}:443/srv_w?key=${SECRETS.relayKey}&ssl=true`;
const offer = (useTls?: boolean) =>
  `https://app.paseo.sh/#offer=${Buffer.from(JSON.stringify({ v: 2, serverId: "srv_w", daemonPublicKeyB64: SECRETS.relayKey, relay: { endpoint: `${SECRETS.relayEndpoint}:443`, ...(useTls === undefined ? {} : { useTls }) } })).toString("base64url")}`;

describe("connectionWithPassword", () => {
  it.each([
    ["relay URI", RELAY],
    ["relay URI with an old password", `${RELAY}&password=old`],
    ["app link with #connect=", `https://app.paseo.sh/#connect=${encodeURIComponent(RELAY)}`],
    ["pairing link with #offer= (TLS by port)", offer()],
    ["pairing link with #offer= (TLS off)", offer(false)],
    ["tcp", "tcp://10.1.2.3:6767?ssl=true"],
    ["ws", "ws://10.1.2.3:6767"],
    ["wss", "wss://paseo.example.com"],
    ["ssh", "ssh://user@build.example.com"],
    ["host:port", "10.1.2.3:6767"],
    ["port", "6768"],
  ])("puts the password into a %s so Paseo reads back the same target", (_name, link) => {
    const built = connectionWithPassword(link, PASSWORD);
    expect(built).not.toBeNull();
    const before = parseHostTarget(link);
    const after = parseHostTarget(built ?? "");
    expect(after.password).toBe(PASSWORD);
    expect(after.description).toBe(before.description);
    if (before.kind === "socket" && after.kind === "socket") expect(after.url).toBe(before.url);
  });

  it("refuses a socket path, which cannot carry a password", () => {
    expect(connectionWithPassword("unix:///tmp/paseo.sock", PASSWORD)).toBeNull();
    expect(connectionWithPassword("pipe://paseo", PASSWORD)).toBeNull();
  });
});

function hubFake(hosts: HostSummary[]) {
  const fake = { added: [] as string[], updated: [] as { id: string; patch: { connection: string } }[], fail: null as Error | null, session: null as unknown as OriginSession };
  const client = {
    isConnected: true,
    close: async () => undefined,
    getLastServerInfoMessage: () => serverInfo("srv_hub", "0.14.0", ["connectedHosts", "hostMultiplexing"]),
    listHosts: async () => ({ self: { serverId: "srv_hub", label: "hub" }, hosts }),
    addHost: async (input: { connection: string; label?: string }) => {
      if (fake.fail) throw fake.fail;
      fake.added.push(input.connection);
      const host = savedHost("srv_new", parseHostTarget(input.connection).description, { registrationId: "hst_new", label: input.label ?? null });
      hosts.push(host);
      return host;
    },
    updateHost: async (id: string, patch: { connection: string }) => {
      if (fake.fail) throw fake.fail;
      fake.updated.push({ id, patch });
      const index = hosts.findIndex((host) => host.registrationId === id);
      hosts[index] = { ...hosts[index], status: "online", error: null };
      return hosts[index];
    },
  };
  fake.session = new OriginSession(async () => client as unknown as DaemonClient);
  return fake;
}

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const failing = () => savedHost("srv_w", `relay://${SECRETS.relayEndpoint}:443/srv_w`, { registrationId: "hst_w", label: "laptop", status: "error", error: { code: "authentication_failed", message: "bad password" } });

let logs: MockInstance[] = [];
beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
});
afterEach(() => {
  for (const spy of logs) spy.mockRestore();
});

function expectNoLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const needle of [PASSWORD, encodeURIComponent(PASSWORD), "w0rd", SECRETS.relayKey, SECRETS.relayEndpoint]) expect(serialized.includes(needle)).toBe(false);
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
}

describe("mhm.hosts.add with a password", () => {
  it("saves the link with the password in it and returns neither", async () => {
    const hub = hubFake([]);
    const result = await addHost(hub.session, "no-home", hostAddRpc.input.parse({ ...policy, connection: offer(), password: PASSWORD, label: "laptop" }), 0);
    expect(result).toMatchObject({ ok: true, host: { registrationId: "hst_new", link: "relay" } });
    expect(hub.added).toHaveLength(1);
    expect(parseHostTarget(hub.added[0]).password).toBe(PASSWORD);
    expectNoLeak(result);
  });

  it("refuses a password for a socket path and saves nothing", async () => {
    const hub = hubFake([]);
    const result = await addHost(hub.session, "no-home", hostAddRpc.input.parse({ ...policy, connection: "unix:///tmp/paseo.sock", password: PASSWORD }));
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_connection", detail: "password_unsupported" } });
    expect(hub.added).toEqual([]);
    expectNoLeak(result);
  });
});

describe("mhm.hosts.password", () => {
  const input = (registrationId: string, connection = RELAY, extra: Record<string, unknown> = {}) =>
    hostSetPasswordRpc.input.parse({ ...policy, registrationId, connection, password: PASSWORD, ...extra });

  it("replaces only the connection, with the password in it, and reports the reconnect", async () => {
    const hub = hubFake([failing()]);
    const result = await setHostPassword(hub.session, "no-home", input("hst_w"), 1_000);
    expect(result).toEqual({ ok: true, host: { id: "srv_w", registrationId: "hst_w", serverId: "srv_w", label: "laptop", link: "relay", status: "online", failure: null } });
    expect(hub.updated).toHaveLength(1);
    expect(hub.updated[0].id).toBe("hst_w");
    expect(Object.keys(hub.updated[0].patch)).toEqual(["connection"]);
    expect(parseHostTarget(hub.updated[0].patch.connection).password).toBe(PASSWORD);
    expectNoLeak(result);
  });

  it("finds the host by server id as well", async () => {
    const hub = hubFake([failing()]);
    expect(await setHostPassword(hub.session, "no-home", input("srv_w"), 1_000)).toMatchObject({ ok: true });
    expect(hub.updated[0].id).toBe("hst_w");
  });

  it("refuses the hub, unknown ids, invalid text and an unconfirmed plain link without changing anything", async () => {
    const hub = hubFake([failing()]);
    expect(await setHostPassword(hub.session, "no-home", input("srv_hub"))).toMatchObject({ ok: false, error: { code: "invalid_item", detail: "self_target" } });
    expect(await setHostPassword(hub.session, "no-home", input("hst_other"))).toMatchObject({ ok: false, error: { code: "invalid_item", detail: "unknown_host" } });
    expect(await setHostPassword(hub.session, "no-home", input("hst_w", "not a link"))).toMatchObject({ ok: false, error: { code: "invalid_connection" } });
    expect(await setHostPassword(hub.session, "no-home", input("hst_w", `tcp://${SECRETS.tcpHost}:6767`))).toMatchObject({ ok: false, error: { code: "insecure_link" } });
    expect(hub.updated).toEqual([]);
  });

  it("maps the daemon's identity check to its code, never its message", async () => {
    const hub = hubFake([failing()]);
    hub.fail = codedError(`Daemon identity changed for ${RELAY}&password=${PASSWORD}`, "server_id_mismatch");
    const result = await setHostPassword(hub.session, "no-home", input("hst_w"));
    expect(result).toEqual({ ok: false, error: { code: "host_error", message: "The host operation failed.", detail: "server_id_mismatch" } });
    expectNoLeak(result);
  });
});
