import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callHost } from "../../server/broker/call";
import { connectOriginClient, connectRoutedClient, DaemonAuthenticationError } from "../../server/broker/daemon-client";
import type { DaemonClient } from "../../server/broker/daemon-client";
import type * as DaemonClientModule from "../../server/broker/daemon-client";
import type { HostEntry } from "../../server/broker/hosts";
import { paseoHome, readHubAddress } from "../../server/broker/origin";
import { connectHubOrigin, OriginSession } from "../../server/broker/origin-session";
import { hostsOverview } from "../../server/broker/overview";
import { codedError, fakeClient, savedHost, SECRETS, serverInfo } from "./broker-fakes";
import type { FakeClient } from "./broker-fakes";

vi.mock("../../server/broker/daemon-client", async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonClientModule>()),
  connectOriginClient: vi.fn(),
  connectRoutedClient: vi.fn(),
}));

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const request = { policy, requiredFeatures: [], timeoutMs: 1_000, run: async () => "value" };
const remote: HostEntry = { id: "srv_W", registrationId: "reg_W", label: "W", link: "relay", isHub: false, unavailable: null };
const routed = vi.mocked(connectRoutedClient);
const originConnect = vi.mocked(connectOriginClient);

let tempHomes: string[] = [];
let consoleCalls: unknown[][] = [];

beforeEach(() => {
  consoleCalls = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleCalls.push(args);
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  routed.mockReset();
  originConnect.mockReset();
  for (const home of tempHomes) fs.rmSync(home, { recursive: true, force: true });
  tempHomes = [];
});

function makeHome(pid: object | null, credential = SECRETS.credential): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mhm-broker-"));
  tempHomes.push(home);
  if (pid) fs.writeFileSync(path.join(home, "paseo.pid"), JSON.stringify(pid));
  fs.writeFileSync(path.join(home, "local-credential"), `${credential}\n`);
  return home;
}

function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value) + JSON.stringify(consoleCalls);
  for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
}

describe("callHost", () => {
  const origin = fakeClient({ info: serverInfo("srv_hub", "0.13.2") });

  it("returns the value and snapshot, and disposes the routed client", async () => {
    const target = fakeClient({ info: serverInfo("srv_W", "0.13.2") });
    routed.mockResolvedValue(target.routed);
    const result = await callHost(origin.client, remote, request);
    expect(result).toMatchObject({ ok: true, value: "value", snapshot: { serverId: "srv_W", version: "0.13.2" } });
    expect(routed).toHaveBeenCalledWith(origin.client, "srv_W", expect.any(AbortSignal));
    expect(target.close).toHaveBeenCalledTimes(1);
  });

  it("runs hub calls on the origin client without closing it", async () => {
    const run = vi.fn(async (client: DaemonClient) => client === origin.client);
    const result = await callHost(origin.client, { ...remote, id: "srv_hub", isHub: true, link: "loopback" }, { ...request, run });
    expect(result).toMatchObject({ ok: true, value: true });
    expect(routed).not.toHaveBeenCalled();
    expect(origin.close).not.toHaveBeenCalled();
  });

  it.each(["tcp-plain", "unknown"] as const)("blocks %s links unless the host is opted out", async (link) => {
    const unverified: HostEntry = { ...remote, link };
    expect(await callHost(origin.client, unverified, request)).toMatchObject({ ok: false, error: { code: "insecure_link" } });
    expect(routed).not.toHaveBeenCalled();

    routed.mockResolvedValue(fakeClient({ info: serverInfo("srv_W", "0.13.2") }).routed);
    const allowed = await callHost(origin.client, unverified, { ...request, policy: { ...policy, insecureLinkRegistrationIds: ["reg_W"] } });
    expect(allowed.ok).toBe(true);
  });

  it("keys the insecure-link opt-in by registration id, which survives the host id flipping to the server id", async () => {
    routed.mockResolvedValue(fakeClient({ info: serverInfo("srv_W", "0.13.2") }).routed);
    const optIn = { ...request, policy: { ...policy, insecureLinkRegistrationIds: ["reg_W"] } };
    const neverReached: HostEntry = { ...remote, id: "reg_W", link: "tcp-plain" };
    const reached: HostEntry = { ...remote, id: "srv_W", link: "tcp-plain" };
    expect((await callHost(origin.client, neverReached, optIn)).ok).toBe(true);
    expect((await callHost(origin.client, reached, optIn)).ok).toBe(true);
    const byServerId = { ...request, policy: { ...policy, insecureLinkRegistrationIds: ["srv_W"] } };
    expect(await callHost(origin.client, reached, byServerId)).toMatchObject({ ok: false, error: { code: "insecure_link" } });
  });

  it.each(["relay", "ssh", "loopback", "tls"] as const)("allows %s links without an opt-out", async (link) => {
    routed.mockResolvedValue(fakeClient({ info: serverInfo("srv_W", "0.13.2") }).routed);
    expect((await callHost(origin.client, { ...remote, link }, request)).ok).toBe(true);
  });

  it("returns the directory failure without routing", async () => {
    const failure = { code: "authentication_failed" as const, message: "m" };
    expect(await callHost(origin.client, { ...remote, unavailable: failure }, request)).toEqual({ ok: false, error: failure });
    expect(routed).not.toHaveBeenCalled();
  });

  it.each([
    [new DaemonAuthenticationError("incorrect_password"), "authentication_failed"],
    [codedError("Host srv_W is offline", "host_offline"), "host_offline"],
    [codedError("Update the managing daemon", "unsupported_capability"), "unsupported_capability"],
    [new Error(`connect failed relay://${SECRETS.relayEndpoint}?key=${SECRETS.relayKey}`), "host_offline"],
  ])("maps a route failure (%s) to %s", async (error, code) => {
    routed.mockRejectedValue(error);
    const result = await callHost(origin.client, remote, request);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expectNoSecrets(result);
  });

  it("disposes the routed client when a gate fails", async () => {
    const target = fakeClient({ info: serverInfo("srv_W", "0.12.0") });
    routed.mockResolvedValue(target.routed);
    expect(await callHost(origin.client, remote, request)).toMatchObject({ ok: false, error: { code: "below_minimum" }, snapshot: { version: "0.12.0" } });
    expect(target.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["0.14.0-beta.2", [], "prerelease_blocked"],
    ["0.13.2", ["pluginManagement"], "unsupported_capability"],
  ] as const)("gates %s with %j -> %s", async (version, features, code) => {
    routed.mockResolvedValue(fakeClient({ info: serverInfo("srv_W", version, []) }).routed);
    expect(await callHost(origin.client, remote, { ...request, requiredFeatures: features })).toMatchObject({ ok: false, error: { code } });
  });

  it("reports host_offline when the routed client has no server_info", async () => {
    routed.mockResolvedValue(fakeClient({ info: null }).routed);
    expect(await callHost(origin.client, remote, request)).toMatchObject({ ok: false, error: { code: "host_offline" } });
  });

  it("disposes the routed client when the call throws", async () => {
    const target = fakeClient({ info: serverInfo("srv_W", "0.13.2") });
    routed.mockResolvedValue(target.routed);
    const run = async () => {
      throw new Error(`failed with password=${SECRETS.password}`);
    };
    const result = await callHost(origin.client, remote, { ...request, run });
    expect(result).toMatchObject({ ok: false, error: { code: "host_error" }, snapshot: { serverId: "srv_W" } });
    expect(target.close).toHaveBeenCalledTimes(1);
    expectNoSecrets(result);
  });

  // A routed connect or call that never settles on its own.
  const pending = () => new Promise<never>(() => undefined);

  it("times out as host_offline and closes the routed client right away, while the call still runs", async () => {
    vi.useFakeTimers();
    const target = fakeClient({ info: serverInfo("srv_W", "0.13.2") });
    routed.mockResolvedValue(target.routed);
    const result = callHost(origin.client, remote, { ...request, timeoutMs: 20, run: pending });
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ ok: false, error: { code: "host_offline", detail: "timeout" } });
    expect(target.close).toHaveBeenCalled();
  });

  it("aborts a routed connect that is still pending at the timeout", async () => {
    vi.useFakeTimers();
    routed.mockImplementation(pending);
    const result = callHost(origin.client, remote, { ...request, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ ok: false, error: { code: "host_offline", detail: "timeout" } });
    expect(routed.mock.calls[0][2]?.aborted).toBe(true);
  });

  it("clears the timeout of a call that finished in time, so nothing is aborted later", async () => {
    vi.useFakeTimers();
    routed.mockResolvedValue(fakeClient({ info: serverInfo("srv_W", "0.13.2") }).routed);
    expect((await callHost(origin.client, remote, { ...request, timeoutMs: 20 })).ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(routed.mock.calls[0][2]?.aborted).toBe(false);
  });
});

describe("origin", () => {
  it("reads the listen address, mapping wildcard binds to loopback", () => {
    expect(readHubAddress(makeHome({ listen: "0.0.0.0:6767", serverId: "srv_hub" }))).toEqual({ listen: "127.0.0.1:6767", serverId: "srv_hub" });
    expect(readHubAddress(makeHome({ listen: "[::]:6767" }))?.listen).toBe("[::1]:6767");
    expect(readHubAddress(makeHome({ pid: 1 }))).toBeNull();
    expect(readHubAddress(makeHome(null))).toBeNull();
  });

  it("falls back to ~/.paseo when PASEO_HOME is unset", () => {
    vi.stubEnv("PASEO_HOME", "");
    expect(paseoHome()).toBe(path.join(os.homedir(), ".paseo"));
    vi.stubEnv("PASEO_HOME", "/custom/home");
    expect(paseoHome()).toBe("/custom/home");
    vi.unstubAllEnvs();
  });
});

describe("hostsOverview", () => {
  const directory = {
    self: { serverId: "srv_hub", label: "hub-label" },
    hosts: [
      savedHost("srv_W", `relay://${SECRETS.relayEndpoint}:443/srv_W`),
      savedHost("srv_L", "tcp://127.0.0.1:6769"),
      savedHost("srv_pw", "tcp://127.0.0.1:6770", { status: "error", error: { code: "authentication_failed", message: "Incorrect password" } }),
      savedHost("srv_plain", `tcp://${SECRETS.tcpHost}:6768`),
      savedHost("srv_beta", "tcp://127.0.0.1:6771"),
    ],
  };

  let sessions: OriginSession[] = [];
  afterEach(async () => {
    for (const session of sessions) await session.close();
    sessions = [];
  });

  /** A fresh session per home, as index.server.ts creates one per plugin load. */
  function sessionFor(home: string): OriginSession {
    const session = new OriginSession(() => connectHubOrigin(home));
    sessions.push(session);
    return session;
  }

  it("lists the hub and every saved host with a snapshot or failure, without secrets", async () => {
    const home = makeHome({ listen: "0.0.0.0:6767", serverId: "srv_hub" });
    const origin = fakeClient({ info: serverInfo("srv_hub", "0.13.2"), directory });
    originConnect.mockResolvedValue(origin.client);
    const targets: Record<string, FakeClient> = {
      srv_W: fakeClient({ info: serverInfo("srv_W", "0.13.2") }),
      srv_L: fakeClient({ info: serverInfo("srv_L", "0.13.0") }),
      srv_beta: fakeClient({ info: serverInfo("srv_beta", "0.14.0-beta.2") }),
    };
    routed.mockImplementation(async (_origin, serverId) => targets[serverId].routed);

    const session = sessionFor(home);
    const hosts = await hostsOverview(session, home, policy);

    expect(hosts.map((host) => [host.id, host.label, host.link, host.isHub, host.result.ok ? "ok" : host.result.error.code])).toEqual([
      ["srv_hub", "hub-label", "loopback", true, "ok"],
      ["srv_W", "label-srv_W", "relay", false, "ok"],
      ["srv_L", "label-srv_L", "loopback", false, "ok"],
      ["srv_pw", "label-srv_pw", "loopback", false, "authentication_failed"],
      ["srv_plain", "label-srv_plain", "tcp-plain", false, "insecure_link"],
      ["srv_beta", "label-srv_beta", "loopback", false, "prerelease_blocked"],
    ]);
    expect(hosts.map((host) => host.registrationId)).toEqual([null, "reg_srv_W", "reg_srv_L", "reg_srv_pw", "reg_srv_plain", "reg_srv_beta"]);
    expect(originConnect.mock.calls[0][0]).toBe("127.0.0.1:6767");
    expect(originConnect.mock.calls[0][1]()).toBe(SECRETS.credential);
    // The hub connection stays open for the next call; routed clients close per call.
    expect(origin.close).not.toHaveBeenCalled();
    for (const target of Object.values(targets)) expect(target.close).toHaveBeenCalledTimes(1);
    await hostsOverview(session, home, policy);
    expect(originConnect).toHaveBeenCalledTimes(1);
    await session.close();
    expect(origin.close).toHaveBeenCalledTimes(1);
    expectNoSecrets(hosts);
  });

  it("returns a hub failure when paseo.pid is missing", async () => {
    const home = makeHome(null);
    const hosts = await hostsOverview(sessionFor(home), home, policy);
    expect(hosts).toMatchObject([{ id: "hub", isHub: true, result: { ok: false, error: { code: "host_offline", detail: "no_pid_file" } } }]);
    expect(originConnect).not.toHaveBeenCalled();
  });

  it("returns authentication_failed when the hub rejects the local credential", async () => {
    originConnect.mockRejectedValue(new DaemonAuthenticationError("incorrect_password"));
    const home = makeHome({ listen: "127.0.0.1:6767", serverId: "srv_hub" });
    const hosts = await hostsOverview(sessionFor(home), home, policy);
    expect(hosts).toMatchObject([{ id: "srv_hub", isHub: true, result: { ok: false, error: { code: "authentication_failed" } } }]);
    expectNoSecrets(hosts);
  });

  it("returns host_offline when the hub is unreachable", async () => {
    originConnect.mockRejectedValue(codedError("connect ECONNREFUSED 127.0.0.1:6767", "ECONNREFUSED"));
    const home = makeHome({ listen: "127.0.0.1:6767" });
    const hosts = await hostsOverview(sessionFor(home), home, policy);
    expect(hosts).toMatchObject([{ id: "hub", result: { ok: false, error: { code: "host_offline" } } }]);
  });

  it("stops at the hub when the hub fails its own gates", async () => {
    const origin = fakeClient({ info: serverInfo("srv_hub", "0.14.0-beta.2"), directory });
    originConnect.mockResolvedValue(origin.client);
    const home = makeHome({ listen: "127.0.0.1:6767" });
    const hosts = await hostsOverview(sessionFor(home), home, policy);
    expect(hosts).toMatchObject([{ id: "srv_hub", result: { ok: false, error: { code: "prerelease_blocked" } } }]);
    expect(routed).not.toHaveBeenCalled();
    expect(origin.close).not.toHaveBeenCalled();
  });

  it("returns a hub failure when the host list cannot be read", async () => {
    const origin = fakeClient({ info: serverInfo("srv_hub", "0.13.2"), directory: codedError("nope", "permission_denied") });
    originConnect.mockResolvedValue(origin.client);
    const home = makeHome({ listen: "127.0.0.1:6767" });
    const hosts = await hostsOverview(sessionFor(home), home, policy);
    expect(hosts).toMatchObject([{ id: "srv_hub", result: { ok: false, error: { code: "host_error", detail: "permission_denied" } } }]);
    expect(origin.close).not.toHaveBeenCalled();
  });
});
