import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { hostAddRpc } from "../../shared/contracts";
import { connectionLink } from "../../shared/connection";
import { parseHostTarget } from "../../server/broker/daemon-client";
import type { DaemonClient, HostSummary } from "../../server/broker/daemon-client";
import { addHost } from "../../server/broker/host-add";
import { classifyLink } from "../../server/broker/hosts";
import { OriginSession } from "../../server/broker/origin-session";
import { codedError, savedHost, SECRETS, serverInfo } from "./broker-fakes";

const RELAY = `relay://${SECRETS.relayEndpoint}:443/srv_new?key=${SECRETS.relayKey}&password=${SECRETS.password}`;
const TCP_PLAIN = `tcp://${SECRETS.tcpHost}:6767?password=${SECRETS.password}`;
// Scheme names are not needles: the fixed invalid_connection text lists the accepted ones.
const NEEDLES = [SECRETS.relayEndpoint, SECRETS.relayKey, SECRETS.password, SECRETS.tcpHost, "password="];

interface HubFake {
  client: DaemonClient;
  added: { connection: string; label?: string }[];
  /** Status the saved host reaches after the given number of directory reads. */
  settle: { after: number; status: HostSummary["status"]; serverId: string | null; error?: HostSummary["error"] };
  fail: Error | null;
}

function hubFake(features = ["connectedHosts", "hostMultiplexing"]): HubFake {
  const hosts: HostSummary[] = [];
  let reads = 0;
  const fake: HubFake = {
    client: null as unknown as DaemonClient,
    added: [],
    settle: { after: 1, status: "online", serverId: "srv_new" },
    fail: null,
  };
  const client = {
    isConnected: true,
    close: async () => undefined,
    getLastServerInfoMessage: () => serverInfo("srv_hub", "0.14.0", features),
    addHost: async (input: { connection: string; label?: string }) => {
      if (fake.fail) throw fake.fail;
      fake.added.push(input);
      const target = parseHostTarget(input.connection).description;
      const host = savedHost(null, target, { registrationId: "hst_new", label: input.label ?? null, status: "connecting" });
      hosts.push(host);
      return host;
    },
    listHosts: async () => {
      reads++;
      const settled = reads > fake.settle.after;
      return {
        self: { serverId: "srv_hub", label: "hub" },
        hosts: hosts.map((host) => (settled ? { ...host, status: fake.settle.status, serverId: fake.settle.serverId, error: fake.settle.error ?? null } : host)),
      };
    },
  };
  fake.client = client as unknown as DaemonClient;
  return fake;
}

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const input = (connection: string, extra: { label?: string; allowUnencrypted?: boolean } = {}) => hostAddRpc.input.parse({ ...policy, connection, ...extra });

let logs: MockInstance[] = [];
beforeEach(() => {
  logs = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
});
afterEach(() => {
  for (const spy of logs) spy.mockRestore();
});

function expectNoLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const needle of NEEDLES) expect(serialized.includes(needle), `leaks ${needle.slice(0, 4)}...`).toBe(false);
  for (const spy of logs) expect(spy).not.toHaveBeenCalled();
}

describe("mhm.hosts.add", () => {
  it("saves a relay host with its label and reports the settled status, without the connection", async () => {
    const hub = hubFake();
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(RELAY, { label: "laptop" }), 2_000);
    expect(hub.added).toEqual([{ connection: RELAY, label: "laptop" }]);
    expect(result).toEqual({ ok: true, host: { id: "srv_new", registrationId: "hst_new", serverId: "srv_new", label: "laptop", link: "relay", status: "online", failure: null } });
    expect(hostAddRpc.output.parse(result)).toBeDefined();
    expectNoLeak(result);
  });

  it("refuses an unencrypted tcp link without the confirmation, and saves nothing", async () => {
    const hub = hubFake();
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(TCP_PLAIN));
    expect(result).toMatchObject({ ok: false, error: { code: "insecure_link", detail: "unencrypted_link" } });
    expect(hub.added).toEqual([]);
    expectNoLeak(result);
  });

  it("saves an unencrypted tcp link once the user confirmed it", async () => {
    const hub = hubFake();
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(TCP_PLAIN, { allowUnencrypted: true }), 2_000);
    expect(result).toMatchObject({ ok: true, host: { link: "tcp-plain", label: "srv_new" } });
    expect(hub.added).toHaveLength(1);
    expectNoLeak(result);
  });

  it("needs no confirmation for loopback", async () => {
    const hub = hubFake();
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(`tcp://127.0.0.1:6768?password=${SECRETS.password}`), 2_000);
    expect(result).toMatchObject({ ok: true, host: { link: "loopback" } });
  });

  it("rejects text Paseo would not accept with a fixed text, and saves nothing", async () => {
    const hub = hubFake();
    for (const text of [`paseo host add ${RELAY}`, `http://${SECRETS.tcpHost}/?password=${SECRETS.password}`, "not a host"]) {
      const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(text));
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_connection" } });
      expectNoLeak(result);
    }
    expect(hub.added).toEqual([]);
  });

  it("passes no daemon message through when the save fails", async () => {
    const hub = hubFake();
    hub.fail = codedError(`Remove a host before adding another, ${RELAY}`, "resource_limit");
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(RELAY));
    expect(result).toEqual({ ok: false, error: { code: "host_error", message: "The host operation failed.", detail: "resource_limit" } });
    expectNoLeak(result);
  });

  it("reports a host the hub cannot use with the daemon's code, not its message", async () => {
    const hub = hubFake();
    hub.settle = { after: 0, status: "error", serverId: "srv_new", error: { code: "authentication_failed", message: `bad password for ${SECRETS.relayEndpoint}` } };
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(RELAY), 2_000);
    expect(result).toMatchObject({ ok: true, host: { status: "error", failure: { code: "authentication_failed" } } });
    expectNoLeak(result);
  });

  it("returns while the hub still connects once the wait is over", async () => {
    const hub = hubFake();
    hub.settle.after = 1_000;
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(RELAY), 0);
    expect(result).toMatchObject({ ok: true, host: { id: "hst_new", status: "connecting", failure: { code: "host_offline", detail: "connecting" } } });
  });

  it("refuses when the hub lacks connected hosts", async () => {
    const hub = hubFake(["hostMultiplexing"]);
    const result = await addHost(new OriginSession(async () => hub.client), "no-home", input(RELAY));
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported_capability" } });
    expect(hub.added).toEqual([]);
  });
});

describe("connectionLink (dialog hint) matches the hub's classification", () => {
  it.each([
    RELAY,
    `https://app.paseo.sh/#connect=${encodeURIComponent(RELAY)}`,
    TCP_PLAIN,
    "tcp://127.0.0.1:6767",
    "tcp://localhost:6767?ssl=true",
    "ws://10.0.0.5:6767",
    "ws://localhost:6767",
    "wss://paseo.example.com",
    "192.168.1.20:6767",
    "6767",
    "localhost:6767",
    "ssh://user@build.example.com",
    "unix:///tmp/paseo.sock",
    "pipe://paseo",
  ])("%s", (text) => {
    expect(connectionLink(text)).toBe(classifyLink(parseHostTarget(text).description));
  });

  it("returns null for text without an accepted shape", () => {
    for (const text of ["", "  ", "not a host", "http://example.com", "paseo host add x"]) expect(connectionLink(text)).toBeNull();
  });
});
