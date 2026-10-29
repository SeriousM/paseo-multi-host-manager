import { afterEach, describe, expect, it, vi } from "vitest";
import { gridLoadRpc } from "../../shared/contracts";
import type { GridHostData } from "../../shared/contracts";
import { connectRoutedClient } from "../../server/broker/daemon-client";
import type * as DaemonClientModule from "../../server/broker/daemon-client";
import { OriginSession } from "../../server/broker/origin-session";
import { loadGrid } from "../../server/rpc/grid";
import { codedError, savedHost, SECRETS } from "./broker-fakes";
import { plugin, pluginFake } from "./rpc-fakes";
import type { PluginFake, PluginFakeOptions } from "./rpc-fakes";

vi.mock("../../server/broker/daemon-client", async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonClientModule>()),
  connectRoutedClient: vi.fn(),
}));

const routed = vi.mocked(connectRoutedClient);
const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const OWN = "paseo-multi-host-manager";

afterEach(() => routed.mockReset());

const companionAnswers = {
  "mhm.host.info": { platform: "linux", arch: "x64", paseoHome: "~/.paseo", consent: { allowPluginSettingsWrites: false } },
  "mhm.config.read": { ok: true, revision: "r1", values: { "worktrees.root": "/home/u/wt", "log.console.level": "info", "daemon.listen": "127.0.0.1:6767" }, maskedPaths: [] },
  "mhm.settings.list": { documents: [{ pluginId: "keep-awake", settingsId: "display", revision: "d1", hasBackup: false }] },
};

function setup(remotes: Record<string, PluginFakeOptions>, hub: PluginFakeOptions = {}) {
  const fakes: Record<string, PluginFake> = Object.fromEntries(Object.entries(remotes).map(([id, options]) => [id, pluginFake(id, options)]));
  const hubFake = pluginFake("srv_hub", { ...hub, hosts: Object.keys(remotes).map((id) => savedHost(id, `relay://${SECRETS.relayEndpoint}/${id}`)) });
  routed.mockImplementation(async (_origin, serverId) => fakes[serverId].routed);
  const session = new OriginSession(async () => hubFake.client);
  return { fakes, hub: hubFake, session, load: () => loadGrid(session, "no-home", policy) };
}

function dataOf(rows: Awaited<ReturnType<ReturnType<typeof setup>["load"]>>, id: string): GridHostData {
  const result = rows.find((row) => row.id === id)?.result;
  if (!result?.ok) throw new Error(`host ${id} not ok`);
  return result.value;
}

describe("grid load", () => {
  it("returns hub and hosts, each read over one connection, in a contract-valid shape", async () => {
    const { fakes, hub, load } = setup({ srv_W: { plugins: [plugin(OWN)], rpc: companionAnswers }, srv_L: {} });
    const rows = await load();
    expect(rows.map((row) => [row.id, row.isHub, row.result.ok])).toEqual([["srv_hub", true, true], ["srv_W", false, true], ["srv_L", false, true]]);
    expect(routed).toHaveBeenCalledTimes(2);
    for (const fake of Object.values(fakes)) expect(fake.close).toHaveBeenCalledTimes(1);
    expect(hub.close).not.toHaveBeenCalled();
    expect(gridLoadRpc.output.parse({ hosts: rows })).toBeDefined();
    // One batch: config, plugins and status exactly once per host.
    expect(fakes.srv_L.calls).toEqual(["getDaemonConfig", "listPlugins", "getDaemonStatus"]);
  });

  it("builds every row of ROWS.md and none else", async () => {
    const { load } = setup({ srv_W: { plugins: [plugin(OWN)], rpc: companionAnswers } });
    const data = dataOf(await load(), "srv_W");
    expect(Object.keys(data.rows)).toEqual(["ver", "osn", "listen", "conn", "wt", "log", "relay", "mcp", "browser", "hooks", "autoarch", "sys", "prov", "pen", "pw", "rc"]);
    expect(data.rows).toMatchObject({
      ver: { state: "ok", value: "0.13.2" },
      osn: { state: "ok", value: "linux" },
      listen: { state: "ok", value: "127.0.0.1:6767" },
      conn: { state: "ok", value: "relay" },
      wt: { state: "ok", value: "/home/u/wt" },
      log: { state: "ok", value: "info" },
      mcp: { state: "ok", value: false },
      autoarch: { state: "ok", value: false },
      sys: { state: "ok", value: "" },
      pen: { state: "ok", value: true },
      pw: { state: "protected", value: null },
      rc: { state: "protected", value: null },
    });
    // Not configured on this daemon: shown as absent, never as false.
    expect(data.rows.relay.state).toBe("absent");
  });

  it("masks secret-looking values and drops provider commands and environments", async () => {
    const config = {
      appendSystemPrompt: "sk-live-0123456789abcdef",
      providers: { mine: { enabled: true, command: ["C:\\bin\\claude.exe"], env: { ANTHROPIC_API_KEY: "sk-real-secret" }, options: { apiToken: "tok-123456" } } },
    };
    const { load } = setup({ srv_W: { config } });
    const data = dataOf(await load(), "srv_W");
    expect(data.rows.sys).toMatchObject({ state: "ok", value: "<masked>", maskedPaths: [""] });
    expect(data.rows.prov.value).toEqual({ mine: { enabled: true, options: { apiToken: "<masked>" } } });
    const text = JSON.stringify(data);
    for (const leaked of ["sk-live", "sk-real-secret", "claude.exe", "tok-123456"]) expect(text).not.toContain(leaked);
  });

  it("shows plugins with a portable source and never a path", async () => {
    const plugins = [
      plugin("keep-awake", { npm: { packageName: "keep-awake", requestedSpec: "k", version: "0.1.3", integrity: "i" }, installation: { identity: { kind: "npm", packageName: "keep-awake", pluginPath: ".", registry: { url: "https://plugins.paseo.sh", id: "hichamboushaba/keep-awake" } }, currentRevision: "0.1.3" } }),
      plugin("plain-npm", { installation: { identity: { kind: "npm", packageName: "@scope/pkg", pluginPath: "plugins/a" }, currentRevision: "2.0.0" } }),
      plugin("from-git", { source: "git", installation: { identity: { kind: "git", remote: "https://github.com/a/b.git", pluginPath: "." }, currentRevision: "abc123" } }),
      plugin("secret-git", { source: "git", installation: { identity: { kind: "git", remote: "https://user:hunter2-password@github.com/a/c.git", pluginPath: "." }, currentRevision: "def456" } }),
      plugin("custom-registry", { installation: { identity: { kind: "git", remote: "https://x/y.git", pluginPath: ".", registry: { url: "https://reg.example.org", id: "me/thing" } } } }),
      plugin("local", { source: "directory", installation: { identity: { kind: "directory", path: "C:\\dev\\local" } } }),
      plugin("off", { enabled: false, status: "disabled", name: "Off one" }),
    ];
    const { load } = setup({ srv_W: { plugins } });
    const data = dataOf(await load(), "srv_W");
    expect(data.plugins).toEqual([
      { id: "keep-awake", name: null, version: "0.1.3", enabled: true, status: "running", source: { kind: "registry", installSource: "hichamboushaba/keep-awake" } },
      { id: "plain-npm", name: null, version: "2.0.0", enabled: true, status: "running", source: { kind: "npm", installSource: "npm:@scope/pkg:plugins/a" } },
      { id: "from-git", name: null, version: "abc123", enabled: true, status: "running", source: { kind: "git", installSource: "git:https://github.com/a/b.git" } },
      { id: "secret-git", name: null, version: "def456", enabled: true, status: "running", source: { kind: "git", installSource: null } },
      { id: "custom-registry", name: null, version: null, enabled: true, status: "running", source: { kind: "registry", installSource: "reg.example.org/me/thing" } },
      { id: "local", name: null, version: null, enabled: true, status: "running", source: { kind: "directory", installSource: null } },
      { id: "off", name: "Off one", version: null, enabled: false, status: "disabled", source: { kind: "directory", installSource: null } },
    ]);
    const text = JSON.stringify(data);
    for (const leaked of ["C:\\\\", "hunter2", "abs\\\\path"]) expect(text).not.toContain(leaked);
  });
});

describe("companion state", () => {
  it("is missing when our plugin is not installed, and the rows that need it say so", async () => {
    const { load } = setup({ srv_W: { plugins: [plugin("other")] } });
    const data = dataOf(await load(), "srv_W");
    expect(data.companion).toEqual({ state: "missing" });
    expect(data.rows.osn.state).toBe("needs_companion");
    expect(data.rows.wt.state).toBe("needs_companion");
    expect(data.rows.log.state).toBe("needs_companion");
    // Listen comes from the daemon status and needs no companion.
    expect(data.rows.listen.state).toBe("ok");
  });

  it("is ok with consent, platform and the settings documents", async () => {
    const { fakes, load } = setup({ srv_W: { plugins: [plugin(OWN)], rpc: companionAnswers } });
    const data = dataOf(await load(), "srv_W");
    expect(data.companion).toEqual({
      state: "ok",
      platform: "linux",
      arch: "x64",
      consent: { allowPluginSettingsWrites: false },
      settingsDocuments: [{ pluginId: "keep-awake", settingsId: "display", revision: "d1", hasBackup: false }],
    });
    expect(fakes.srv_W.rpc).toHaveBeenCalledTimes(3);
  });

  it("is disabled, not failed, when the plugin is disabled or pluginsEnabled is false, and is not called", async () => {
    const { fakes, load } = setup({
      srv_W: { plugins: [plugin(OWN, { enabled: false, status: "disabled" })], rpc: companionAnswers },
      srv_L: { plugins: [plugin(OWN, { status: "running" })], rpc: companionAnswers, config: { pluginsEnabled: false } },
    });
    const rows = await load();
    for (const id of ["srv_W", "srv_L"]) {
      expect(rows.find((row) => row.id === id)?.result.ok).toBe(true);
      expect(dataOf(rows, id).companion).toEqual({ state: "disabled" });
      expect(dataOf(rows, id).rows.osn.state).toBe("needs_companion");
    }
    expect(dataOf(rows, "srv_L").rows.pen).toMatchObject({ state: "ok", value: false });
    expect(fakes.srv_W.rpc).not.toHaveBeenCalled();
    expect(fakes.srv_L.rpc).not.toHaveBeenCalled();
  });

  it("is failed when the plugin failed to start or its RPC throws", async () => {
    const { load } = setup({
      srv_W: { plugins: [plugin(OWN, { status: "failed" })], rpc: companionAnswers },
      srv_L: { plugins: [plugin(OWN)], rpc: { ...companionAnswers, "mhm.host.info": () => Promise.reject(codedError("gone", "plugin_unavailable")) } },
    });
    const rows = await load();
    expect(dataOf(rows, "srv_W").companion).toEqual({ state: "failed" });
    expect(dataOf(rows, "srv_L").companion).toEqual({ state: "failed" });
  });

  it("marks restart-only rows unreadable when config.json cannot be parsed", async () => {
    const answers = { ...companionAnswers, "mhm.config.read": { ok: false, code: "invalid_document", message: "bad" } };
    const { load } = setup({ srv_W: { plugins: [plugin(OWN)], rpc: answers } });
    const data = dataOf(await load(), "srv_W");
    expect(data.companion.state).toBe("ok");
    expect(data.rows.wt.state).toBe("unreadable");
    expect(data.rows.osn).toMatchObject({ state: "ok", value: "linux" });
  });
});

describe("grid failures", () => {
  it("isolates a failing host and keeps the others", async () => {
    const { fakes, load } = setup({ srv_W: {}, srv_L: {}, srv_bad: { version: "0.12.9" } });
    fakes.srv_W.fail.getDaemonConfig = codedError("boom", "internal");
    const rows = await load();
    expect(rows.find((row) => row.id === "srv_W")?.result).toMatchObject({ ok: false, error: { code: "host_error", detail: "internal" } });
    expect(rows.find((row) => row.id === "srv_L")?.result.ok).toBe(true);
    expect(rows.find((row) => row.id === "srv_bad")?.result).toMatchObject({ ok: false, error: { code: "below_minimum" } });
  });

  it("does not fail a host because its status call fails", async () => {
    const { fakes, load } = setup({ srv_W: {} });
    fakes.srv_W.fail.getDaemonStatus = codedError("no", "x");
    const data = dataOf(await load(), "srv_W");
    expect(data.rows.listen.state).toBe("absent");
  });

  it("skips the status call on a daemon without daemonStatusRpc", async () => {
    const { fakes, load } = setup({ srv_W: { features: ["connectedHosts", "pluginManagement"] } });
    await load();
    expect(fakes.srv_W.calls).not.toContain("getDaemonStatus");
  });

  it("reports the hub itself when it fails its gates", async () => {
    const { load } = setup({ srv_W: {} }, { version: "0.12.0" });
    expect(await load()).toMatchObject([{ id: "srv_hub", isHub: true, result: { ok: false, error: { code: "below_minimum" } } }]);
  });
});
