import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRpc } from "../../shared/contracts";
import type { ApplyItem, ApplyOutcome } from "../../shared/contracts";
import { connectRoutedClient } from "../../server/broker/daemon-client";
import type * as DaemonClientModule from "../../server/broker/daemon-client";
import { OriginSession } from "../../server/broker/origin-session";
import { APPLY_BASE_TIMEOUT_MS, applyItems, hostTimeoutMs } from "../../server/rpc/apply";
import { codedError, savedHost, SECRETS } from "./broker-fakes";
import { ALL_FEATURES, plugin, pluginFake } from "./rpc-fakes";
import type { PluginFake, PluginFakeOptions } from "./rpc-fakes";

vi.mock("../../server/broker/daemon-client", async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonClientModule>()),
  connectRoutedClient: vi.fn(),
}));

const routed = vi.mocked(connectRoutedClient);
const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const READS = ["getDaemonConfig", "listPlugins"];

let sessions: OriginSession[] = [];
let log: string[] = [];

beforeEach(() => {
  log = [];
});
afterEach(() => {
  routed.mockReset();
  sessions = [];
});

/** Hub plus remote hosts W and L, all reachable; `options` tune individual daemons. */
function setup(options: { hub?: PluginFakeOptions; W?: PluginFakeOptions; L?: PluginFakeOptions } = {}) {
  const hub = pluginFake("srv_hub", {
    ...options.hub,
    log,
    hosts: [savedHost("srv_W", `relay://${SECRETS.relayEndpoint}/srv_W`), savedHost("srv_L", `relay://${SECRETS.relayEndpoint}/srv_L`)],
  });
  const remote: Record<string, PluginFake> = { srv_W: pluginFake("srv_W", { ...options.W, log }), srv_L: pluginFake("srv_L", { ...options.L, log }) };
  routed.mockImplementation(async (_origin, serverId) => remote[serverId].routed);
  const session = new OriginSession(async () => hub.client);
  sessions.push(session);
  return { hub, W: remote.srv_W, L: remote.srv_L, session };
}

const writes = (fake: PluginFake) => fake.calls.filter((call) => !READS.includes(call));
const run = (session: OriginSession, items: ApplyItem[], timeoutMs?: number) => applyItems(session, "no-home", policy, items, timeoutMs);
const statuses = (results: { outcome: ApplyOutcome }[]) => results.map((result) => result.outcome.status);

describe("apply order", () => {
  it("runs enabling switches first and disabling switches last, the rest in staged order", async () => {
    const { W, session } = setup();
    const results = await run(session, [
      { id: "a", host: "srv_W", op: "setRow", rowId: "relay", value: false, confirmed: true },
      { id: "b", host: "srv_W", op: "setRow", rowId: "sys", value: "hello" },
      { id: "c", host: "srv_W", op: "setRow", rowId: "pen", value: false, confirmed: true },
      { id: "d", host: "srv_W", op: "setRow", rowId: "mcp", value: true },
      { id: "e", host: "srv_W", op: "setRow", rowId: "pen", value: true },
      { id: "f", host: "srv_W", op: "setRow", rowId: "relay", value: true },
    ]);
    // pen=true and relay=true lead, then sys and mcp in staged order, then pen=false; relay=false is the very last.
    expect(writes(W)).toEqual(["patch:pluginsEnabled", "patch:relay", "patch:appendSystemPrompt", "patch:mcp", "patch:pluginsEnabled", "patch:relay"]);
    expect(results.map((result) => result.id)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(statuses(results)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  it("runs plugin operations before pluginsEnabled is switched off", async () => {
    const { L, session } = setup({ L: { plugins: [plugin("keep-awake")] } });
    await run(session, [
      { id: "off", host: "srv_L", op: "setRow", rowId: "pen", value: false, confirmed: true },
      { id: "disable", host: "srv_L", op: "setPluginEnabled", pluginId: "keep-awake", enabled: false },
    ]);
    expect(writes(L)).toEqual(["disable:keep-awake", "patch:pluginsEnabled"]);
  });

  it("applies remote hosts before the hub's own items", async () => {
    const { session } = setup();
    await run(session, [
      { id: "hub", host: "srv_hub", op: "setRow", rowId: "sys", value: "hub" },
      { id: "w", host: "srv_W", op: "setRow", rowId: "sys", value: "w" },
      { id: "l", host: "srv_L", op: "setRow", rowId: "sys", value: "l" },
    ]);
    const patches = log.filter((entry) => entry.includes(":patch:"));
    expect(patches.at(-1)).toBe("srv_hub:patch:appendSystemPrompt");
    expect(patches).toHaveLength(3);
    // The hub is the target through the origin client: no route was opened for it.
    expect(routed).toHaveBeenCalledTimes(2);
  });
});

describe("apply failures", () => {
  it("lets other hosts and unrelated items continue and skips dependent items", async () => {
    const { W, L, session } = setup({ W: { plugins: [plugin("keep-awake")] } });
    W.fail.installPluginSource = codedError("npm failed at C:\\secret\\path", "install_failed");
    const results = await run(session, [
      { id: "install", host: "srv_W", op: "installPlugin", source: "hichamboushaba/keep-awake", pluginId: "keep-awake", confirmed: true },
      { id: "sys", host: "srv_W", op: "setRow", rowId: "sys", value: "still runs" },
      { id: "enable", host: "srv_W", op: "setPluginEnabled", pluginId: "keep-awake", enabled: true },
      { id: "other", host: "srv_L", op: "setRow", rowId: "sys", value: "L" },
    ]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "install_failed" } });
    expect(results[1].outcome.status).toBe("ok");
    expect(results[2].outcome).toEqual({ status: "skipped", dependsOn: "install" });
    expect(results[3].outcome.status).toBe("ok");
    expect(writes(W)).toEqual(["install:hichamboushaba/keep-awake", "patch:appendSystemPrompt"]);
    expect(writes(L)).toEqual(["patch:appendSystemPrompt"]);
    // Daemon messages can carry paths; only the code survives.
    expect(JSON.stringify(results)).not.toContain("secret");
  });

  it("skips every plugin operation when switching pluginsEnabled on did not work, but not settings", async () => {
    const { W, session } = setup({ W: { config: { pluginsEnabled: false } } });
    W.fail.patchDaemonConfig = codedError("no", "boom");
    const results = await run(session, [
      { id: "pen", host: "srv_W", op: "setRow", rowId: "pen", value: true },
      { id: "install", host: "srv_W", op: "installPlugin", source: "a/b", confirmed: true },
      { id: "sys", host: "srv_W", op: "setRow", rowId: "sys", value: "x" },
    ]);
    expect(statuses(results)).toEqual(["failed", "skipped", "failed"]);
    expect(results[1].outcome).toEqual({ status: "skipped", dependsOn: "pen" });
    expect(writes(W).some((call) => call.startsWith("install"))).toBe(false);
  });

  it("marks all items of an unreachable host and leaves the others alone", async () => {
    const { L, session } = setup();
    routed.mockImplementation(async (_origin, serverId) => {
      if (serverId === "srv_W") throw codedError("connect ECONNREFUSED", "ECONNREFUSED");
      return L.routed;
    });
    const results = await run(session, [
      { id: "w1", host: "srv_W", op: "setRow", rowId: "sys", value: "x" },
      { id: "w2", host: "srv_W", op: "reloadPlugin", pluginId: "p" },
      { id: "l1", host: "srv_L", op: "setRow", rowId: "sys", value: "x" },
    ]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_offline" } });
    expect(results[1].outcome).toMatchObject({ status: "failed", error: { code: "host_offline" } });
    expect(results[2].outcome.status).toBe("ok");
  });

  it("keeps finished items and marks the rest when a host times out", async () => {
    const { W, session } = setup();
    const slow = vi.fn(() => new Promise<never>(() => undefined));
    Object.assign(W.client, { reloadPlugin: slow });
    const results = await run(
      session,
      [
        { id: "first", host: "srv_W", op: "setRow", rowId: "sys", value: "x" },
        { id: "hang", host: "srv_W", op: "reloadPlugin", pluginId: "p" },
        { id: "later", host: "srv_W", op: "setRow", rowId: "mcp", value: true },
      ],
      50,
    );
    expect(results[0].outcome.status).toBe("ok");
    expect(results[1].outcome).toMatchObject({ status: "failed", error: { code: "host_offline", detail: "timeout" } });
    expect(results[2].outcome).toMatchObject({ status: "failed", error: { code: "host_offline", detail: "timeout" } });
    expect(W.calls).not.toContain("patch:mcp");
    expect(W.close).toHaveBeenCalled();
  });

  it("fails every item when the hub fails its gates", async () => {
    const { session } = setup({ hub: { version: "0.12.0" } });
    const results = await run(session, [{ id: "w", host: "srv_W", op: "setRow", rowId: "sys", value: "x" }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "below_minimum" } });
    expect(routed).not.toHaveBeenCalled();
  });

  it("rejects items for a host the hub does not know", async () => {
    const { session } = setup();
    const results = await run(session, [{ id: "x", host: "srv_nope", op: "setRow", rowId: "sys", value: "x" }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "unknown_host" } });
  });

  it("applies the version and pre-release gates of the host", async () => {
    const { session } = setup({ W: { version: "0.14.0-beta.2" } });
    const results = await run(session, [{ id: "w", host: "srv_W", op: "setRow", rowId: "sys", value: "x" }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "prerelease_blocked" } });
  });
});

describe("apply capability gates", () => {
  const without = (flag: string) => ({ features: ALL_FEATURES.filter((feature) => feature !== flag) });

  it.each([
    ["pluginSourceInstallation", { op: "installPlugin", source: "a/b", confirmed: true }],
    ["pluginSourceUpdates", { op: "updatePlugin", pluginId: "p" }],
    ["pluginManagement", { op: "setPluginEnabled", pluginId: "p", enabled: true }],
    ["pluginManagement", { op: "removePlugin", pluginId: "p", confirmed: true }],
    ["pluginManagement", { op: "reloadPlugin", pluginId: "p" }],
    ["pluginSettings", { op: "writeSettingsDoc", pluginId: "p", settingsId: "s", expectedRevision: "r", version: 1, values: {} }],
    ["pluginSettings", { op: "restoreSettingsDoc", pluginId: "p", settingsId: "s", expectedRevision: "r" }],
    ["relayConfig", { op: "setRow", rowId: "relay", value: true }],
  ] as const)("returns unsupported_capability for %s without calling the daemon", async (flag, item) => {
    const { W, session } = setup({ W: without(flag) });
    const results = await run(session, [{ id: "i", host: "srv_W", ...item }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "unsupported_capability", detail: flag } });
    expect(writes(W)).toEqual([]);
  });

  it("gates per item: other items on the same host still run", async () => {
    const { W, session } = setup({ W: without("pluginSourceInstallation") });
    const results = await run(session, [
      { id: "install", host: "srv_W", op: "installPlugin", source: "a/b", confirmed: true },
      { id: "sys", host: "srv_W", op: "setRow", rowId: "sys", value: "x" },
    ]);
    expect(statuses(results)).toEqual(["failed", "ok"]);
    expect(writes(W)).toEqual(["patch:appendSystemPrompt"]);
  });
});

describe("apply confirmation and validation", () => {
  it("rejects unconfirmed installs and removals without contacting the host", async () => {
    const { session } = setup();
    const results = await run(session, [
      { id: "install", host: "srv_W", op: "installPlugin", source: "a/b" },
      { id: "remove", host: "srv_W", op: "removePlugin", pluginId: "p", confirmed: false },
    ]);
    expect(results.map((result) => result.outcome)).toMatchObject([
      { status: "failed", error: { code: "confirmation_required" } },
      { status: "failed", error: { code: "confirmation_required" } },
    ]);
    expect(routed).not.toHaveBeenCalled();
  });

  it("an unconfirmed install blocks later items for the same plugin", async () => {
    const { W, session } = setup();
    const results = await run(session, [
      { id: "install", host: "srv_W", op: "installPlugin", source: "a/b", pluginId: "b" },
      { id: "enable", host: "srv_W", op: "setPluginEnabled", pluginId: "b", enabled: true },
      { id: "sys", host: "srv_W", op: "setRow", rowId: "sys", value: "x" },
    ]);
    expect(statuses(results)).toEqual(["failed", "skipped", "ok"]);
    expect(writes(W)).toEqual(["patch:appendSystemPrompt"]);
  });

  it.each([
    ["unknown row", { rowId: "idle", value: true }, "unknown_row"],
    ["removed row", { rowId: "agents.idleRuntimeCleanup", value: true }, "unknown_row"],
    ["read-only row", { rowId: "wt", value: "/x" }, "read_only_row"],
    ["version row", { rowId: "ver", value: "9.9.9" }, "read_only_row"],
    ["secret row", { rowId: "pw", value: "x" }, "protected_row"],
    ["wrong type", { rowId: "mcp", value: "yes" }, "wrong_value_type"],
    ["placeholder", { rowId: "sys", value: "<masked>" }, "masked_value"],
    ["provider with only masked fields", { rowId: "prov", value: { x: { options: { apiKey: "<masked>" } } } }, "masked_value"],
    ["masked provider array element", { rowId: "prov", value: { x: { args: ["<masked>"] } } }, "masked_value"],
    ["empty providers", { rowId: "prov", value: {} }, "wrong_value_type"],
    ["provider command", { rowId: "prov", value: { x: { command: ["/bin/x"] } } }, "wrong_value_type"],
  ])("rejects a %s", async (_name, input, detail) => {
    const { W, session } = setup();
    const results = await run(session, [{ id: "i", host: "srv_W", op: "setRow", ...input }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "invalid_item", detail } });
    expect(routed).not.toHaveBeenCalled();
    expect(W.calls).toEqual([]);
  });

  it.each(["/etc/plugin", "C:\\dev\\plugin", "~/plugin", "./plugin", "..\\plugin", "\\\\share\\plugin"])("rejects the local directory source %s", async (source) => {
    const { session } = setup();
    const results = await run(session, [{ id: "i", host: "srv_W", op: "installPlugin", source, confirmed: true }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "invalid_item", detail: "directory_source" } });
  });

  it("requires unique item ids in the contract", () => {
    const item = { host: "h", op: "reloadPlugin", pluginId: "p" };
    const input = { items: [{ id: "a", ...item }, { id: "a", ...item }] };
    expect(applyRpc.input.safeParse(input).success).toBe(false);
  });
});

describe("setRow", () => {
  it("reports a patch the daemon ignored instead of success", async () => {
    const { W, session } = setup();
    // The fake daemon drops this key like the real one drops unknown keys; `providers` is accepted, `relay` is not on this fake.
    delete (W.config as Record<string, unknown>).relay;
    Object.assign(W.client, { patchDaemonConfig: async () => ({ requestId: "r", config: W.config }) });
    const results = await run(session, [{ id: "r", host: "srv_W", op: "setRow", rowId: "relay", value: true }]);
    expect(results[0].outcome).toEqual({ status: "ignored", paths: ["relay.enabled"] });
  });

  it("applies a live row and verifies it by re-reading", async () => {
    const { W, session } = setup();
    const results = await run(session, [{ id: "s", host: "srv_W", op: "setRow", rowId: "sys", value: "new prompt" }]);
    expect(results[0].outcome).toEqual({ status: "ok" });
    expect(W.config.appendSystemPrompt).toBe("new prompt");
    expect(W.calls).toEqual(["patch:appendSystemPrompt", "getDaemonConfig"]);
  });

  it("applies providers without binary paths and environment", async () => {
    const { W, session } = setup({ W: { config: { providers: { claude: { enabled: true } } } } });
    const results = await run(session, [{ id: "p", host: "srv_W", op: "setRow", rowId: "prov", value: { claude: { enabled: false } } }]);
    expect(results[0].outcome.status).toBe("ok");
    expect(W.config.providers).toEqual({ claude: { enabled: false } });
  });

  it("works on the hub as a target", async () => {
    const { hub, session } = setup();
    const results = await run(session, [{ id: "h", host: "srv_hub", op: "setRow", rowId: "autoarch", value: true }]);
    expect(results[0].outcome.status).toBe("ok");
    expect(hub.config.autoArchiveAfterMerge).toBe(true);
    expect(routed).not.toHaveBeenCalled();
  });
});

describe("plugin operations", () => {
  it("installs from a source and reports the plugin the daemon created", async () => {
    const { W, session } = setup();
    const results = await run(session, [{ id: "i", host: "srv_W", op: "installPlugin", source: "hichamboushaba/keep-awake", confirmed: true }]);
    expect(results[0].outcome).toEqual({ status: "ok", pluginId: "installed-plugin", version: "0.1.3", pluginStatus: "running" });
    expect(writes(W)).toEqual(["install:hichamboushaba/keep-awake"]);
  });

  it("disables, enables, reloads and removes", async () => {
    const { L, session } = setup({ L: { plugins: [plugin("keep-awake")] } });
    const results = await run(session, [
      { id: "d", host: "srv_L", op: "setPluginEnabled", pluginId: "keep-awake", enabled: false },
      { id: "e", host: "srv_L", op: "setPluginEnabled", pluginId: "keep-awake", enabled: true },
      { id: "r", host: "srv_L", op: "reloadPlugin", pluginId: "keep-awake" },
      { id: "x", host: "srv_L", op: "removePlugin", pluginId: "keep-awake", confirmed: true },
    ]);
    expect(writes(L)).toEqual(["disable:keep-awake", "enable:keep-awake", "reload:keep-awake", "remove:keep-awake"]);
    expect(results[0].outcome).toMatchObject({ status: "ok", pluginStatus: "disabled" });
    expect(results[1].outcome).toMatchObject({ status: "ok", pluginStatus: "running" });
    expect(results[3].outcome).toEqual({ status: "ok", pluginId: "keep-awake" });
  });

  it("reports a plugin the daemon refused to toggle as failed", async () => {
    const { L, session } = setup();
    L.fail.disable = codedError("no such plugin", "plugin_not_found");
    const results = await run(session, [{ id: "d", host: "srv_L", op: "setPluginEnabled", pluginId: "x", enabled: false }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "plugin_not_found" } });
  });
});

describe("plugin update", () => {
  const proposal = { id: "keep-awake", expected: {}, target: {} };

  it("previews and applies a pending update", async () => {
    const { L, session } = setup();
    L.preview.mockResolvedValue([{ id: "keep-awake", outcome: "update", links: [], proposal }]);
    L.applyUpdates.mockResolvedValue([{ id: "keep-awake", outcome: "updated", plugin: plugin("keep-awake", { npm: { packageName: "k", requestedSpec: "k", version: "0.2.0", integrity: "i" } }) }]);
    const results = await run(session, [{ id: "u", host: "srv_L", op: "updatePlugin", pluginId: "keep-awake" }]);
    expect(L.preview).toHaveBeenCalledWith({ pluginId: "keep-awake" });
    expect(L.applyUpdates).toHaveBeenCalledWith([proposal]);
    expect(results[0].outcome).toEqual({ status: "ok", pluginId: "keep-awake", version: "0.2.0", pluginStatus: "running", updateOutcome: "updated" });
  });

  it("checkOnly stops after the preview", async () => {
    const { L, session } = setup();
    L.preview.mockResolvedValue([{ id: "keep-awake", outcome: "update", links: [], proposal }]);
    const results = await run(session, [{ id: "u", host: "srv_L", op: "updatePlugin", pluginId: "keep-awake", checkOnly: true }]);
    expect(results[0].outcome).toEqual({ status: "ok", pluginId: "keep-awake", updateOutcome: "update" });
    expect(L.applyUpdates).not.toHaveBeenCalled();
  });

  it.each(["current", "installed-newer", "local"] as const)("is ok without changes when the preview says %s", async (outcome) => {
    const { L, session } = setup();
    L.preview.mockResolvedValue([{ id: "keep-awake", outcome, links: [] }]);
    const results = await run(session, [{ id: "u", host: "srv_L", op: "updatePlugin", pluginId: "keep-awake" }]);
    expect(results[0].outcome).toEqual({ status: "ok", pluginId: "keep-awake", updateOutcome: outcome });
    expect(L.applyUpdates).not.toHaveBeenCalled();
  });

  it("fails when the preview or the apply reports an error", async () => {
    const { L, session } = setup();
    L.preview.mockResolvedValueOnce([{ id: "k", outcome: "error", links: [], error: "network C:\\x" }]);
    L.preview.mockResolvedValueOnce([{ id: "k", outcome: "update", links: [], proposal }]);
    L.applyUpdates.mockResolvedValue([{ id: "k", outcome: "error", error: "boom" }]);
    const results = await run(session, [
      { id: "u1", host: "srv_L", op: "updatePlugin", pluginId: "k" },
      { id: "u2", host: "srv_L", op: "updatePlugin", pluginId: "k2" },
    ]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "update_preview_failed" } });
    expect(results[1].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "update_failed" } });
  });
});

describe("settings documents", () => {
  const write = { op: "writeSettingsDoc", pluginId: "keep-awake", settingsId: "display", expectedRevision: "rev1", version: 1, values: { mode: "display" } } as const;
  const companion = plugin("paseo-multi-host-manager");

  it("writes through the companion and reports validity unknown with a reload suggestion", async () => {
    const answer = vi.fn(() => ({ ok: true, revision: "rev2", keptMaskedPaths: ["token"], backedUp: true }));
    const { L, session } = setup({ L: { plugins: [companion], rpc: { "mhm.settings.write": answer } } });
    const results = await run(session, [{ id: "w", host: "srv_L", ...write }]);
    expect(results[0].outcome).toEqual({ status: "ok", revision: "rev2", keptMaskedPaths: ["token"], backedUp: true, validity: "unknown", reloadSuggested: true });
    expect(answer).toHaveBeenCalledWith({ pluginId: "keep-awake", settingsId: "display", expectedRevision: "rev1", version: 1, values: { mode: "display" } });
    expect(L.rpc).toHaveBeenCalledWith("paseo-multi-host-manager", "mhm.settings.write", expect.anything());
  });

  it("restores through the companion", async () => {
    const { session } = setup({ L: { plugins: [companion], rpc: { "mhm.settings.restore": { ok: true, revision: "rev3" } } } });
    const results = await run(session, [{ id: "r", host: "srv_L", op: "restoreSettingsDoc", pluginId: "keep-awake", settingsId: "display", expectedRevision: "rev2" }]);
    expect(results[0].outcome).toEqual({ status: "ok", revision: "rev3", validity: "unknown", reloadSuggested: true });
  });

  it("passes on a conflict with the current revision", async () => {
    const { session } = setup({ L: { plugins: [companion], rpc: { "mhm.settings.write": { ok: false, code: "conflict", message: "changed", currentRevision: "rev9" } } } });
    const results = await run(session, [{ id: "w", host: "srv_L", ...write }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "conflict" }, currentRevision: "rev9" });
  });

  it("maps a refused opt-in to capability_disabled", async () => {
    const { session } = setup({ L: { plugins: [companion], rpc: { "mhm.settings.write": { ok: false, code: "capability_disabled", message: "off" } } } });
    const results = await run(session, [{ id: "w", host: "srv_L", ...write }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "capability_disabled" } });
  });

  it("explains a missing or disabled companion without calling it", async () => {
    const missing = setup();
    expect((await run(missing.session, [{ id: "w", host: "srv_L", ...write }]))[0].outcome).toMatchObject({ error: { code: "unsupported_capability", detail: "companion_missing" } });
    expect(missing.L.rpc).not.toHaveBeenCalled();
    const disabled = setup({ L: { plugins: [{ ...companion, enabled: false, status: "disabled" }] } });
    expect((await run(disabled.session, [{ id: "w", host: "srv_L", ...write }]))[0].outcome).toMatchObject({ error: { code: "capability_disabled", detail: "companion_disabled" } });
    expect(disabled.L.rpc).not.toHaveBeenCalled();
  });

  it("a reload after the write is a separate, dependent item", async () => {
    const { L, session } = setup({ L: { plugins: [companion], rpc: { "mhm.settings.write": { ok: false, code: "conflict", message: "x" } } } });
    const results = await run(session, [
      { id: "w", host: "srv_L", ...write },
      { id: "r", host: "srv_L", op: "reloadPlugin", pluginId: "keep-awake" },
    ]);
    expect(statuses(results)).toEqual(["failed", "skipped"]);
    expect(writes(L).some((call) => call.startsWith("reload"))).toBe(false);
  });
});

describe("apply output", () => {
  it("matches the contract and leaks nothing", async () => {
    const { session } = setup();
    const results = await run(session, [
      { id: "1", host: "srv_W", op: "setRow", rowId: "sys", value: "x" },
      { id: "2", host: "srv_L", op: "installPlugin", source: "a/b" },
    ]);
    expect(applyRpc.output.parse({ results })).toEqual({ results });
    const text = JSON.stringify(results);
    for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret);
  });
});

describe("lockout confirmation and self target", () => {
  const OWN = "paseo-multi-host-manager";

  it.each([
    ["relay off on a relay-linked host", { host: "srv_W", op: "setRow", rowId: "relay", value: false }],
    ["pluginsEnabled off on a remote", { host: "srv_W", op: "setRow", rowId: "pen", value: false }],
    ["pluginsEnabled off on the hub", { host: "srv_hub", op: "setRow", rowId: "pen", value: false }],
    ["removing this plugin on a remote", { host: "srv_W", op: "removePlugin", pluginId: OWN }],
    ["disabling this plugin on a remote", { host: "srv_W", op: "setPluginEnabled", pluginId: OWN, enabled: false }],
  ] as const)("rejects %s without confirmation and contacts no host", async (_name, item) => {
    const { hub, session } = setup();
    const results = await run(session, [{ id: "i", ...item }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "lockout_confirmation_required" } });
    expect(routed).not.toHaveBeenCalled();
    expect(writes(hub)).toEqual([]);
  });

  it("runs them once confirmed", async () => {
    const { W, session } = setup({ W: { plugins: [plugin(OWN)] } });
    const results = await run(session, [
      { id: "r", host: "srv_W", op: "setRow", rowId: "relay", value: false, confirmed: true },
      { id: "d", host: "srv_W", op: "setPluginEnabled", pluginId: OWN, enabled: false, confirmed: true },
    ]);
    expect(statuses(results)).toEqual(["ok", "ok"]);
    expect(writes(W)).toEqual([`disable:${OWN}`, "patch:relay"]);
  });

  it("needs no lockout confirmation for relay off over a non-relay link, switches on, or other plugins", async () => {
    const { hub, W, session } = setup({ W: { plugins: [plugin("keep-awake")] } });
    const results = await run(session, [
      { id: "hubRelay", host: "srv_hub", op: "setRow", rowId: "relay", value: false },
      { id: "on", host: "srv_W", op: "setRow", rowId: "pen", value: true },
      { id: "other", host: "srv_W", op: "setPluginEnabled", pluginId: "keep-awake", enabled: false },
      { id: "enableOwn", host: "srv_W", op: "setPluginEnabled", pluginId: OWN, enabled: true },
    ]);
    expect(statuses(results)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(writes(hub)).toEqual(["patch:relay"]);
    expect(writes(W)).toEqual(["patch:pluginsEnabled", "disable:keep-awake", `enable:${OWN}`]);
  });

  it.each([
    ["remove", { op: "removePlugin", pluginId: OWN, confirmed: true }],
    ["disable", { op: "setPluginEnabled", pluginId: OWN, enabled: false, confirmed: true }],
  ] as const)("refuses to %s this plugin on the hub even when confirmed", async (_name, item) => {
    const { hub, session } = setup();
    const results = await run(session, [{ id: "i", host: "srv_hub", ...item }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "invalid_item", detail: "self_target" } });
    expect(writes(hub)).toEqual([]);
  });
});

describe("install sources", () => {
  it.each(["git:https://user:pw-123456@github.com/a/b.git", "https://ghtoken123456@github.com/a/b.git", "git:ssh://git:pw-123456@host/a/b.git"])(
    "rejects credentials in %s without contacting the host",
    async (source) => {
      const { session } = setup();
      const results = await run(session, [{ id: "i", host: "srv_W", op: "installPlugin", source, confirmed: true }]);
      expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "invalid_item", detail: "credentials_in_source" } });
      expect(routed).not.toHaveBeenCalled();
      expect(JSON.stringify(results)).not.toContain("123456");
    },
  );

  it("accepts an ssh login name, which is not a credential", async () => {
    const { W, session } = setup();
    const results = await run(session, [{ id: "i", host: "srv_W", op: "installPlugin", source: "git:ssh://git@github.com/a/b.git", confirmed: true }]);
    expect(results[0].outcome.status).toBe("ok");
    expect(writes(W)).toEqual(["install:git:ssh://git@github.com/a/b.git"]);
  });
});

describe("host references", () => {
  it("accepts the registration id as well as the server id, and echoes the reference given", async () => {
    const { W, session } = setup();
    const results = await run(session, [
      { id: "a", host: "reg_srv_W", op: "setRow", rowId: "sys", value: "by registration" },
      { id: "b", host: "srv_W", op: "setRow", rowId: "mcp", value: true },
    ]);
    expect(statuses(results)).toEqual(["ok", "ok"]);
    expect(results[0].host).toBe("reg_srv_W");
    // Both references name one host: one connection, items in staged order.
    expect(routed).toHaveBeenCalledTimes(1);
    expect(writes(W)).toEqual(["patch:appendSystemPrompt", "patch:mcp"]);
  });
});

describe("setRow verification", () => {
  it("reports ok but unverified when only the re-read fails", async () => {
    const { W, session } = setup();
    W.fail.getDaemonConfig = codedError("connection lost", "DAEMON_CONNECTION_LOST");
    const results = await run(session, [{ id: "r", host: "srv_W", op: "setRow", rowId: "relay", value: false, confirmed: true }]);
    expect(results[0].outcome).toEqual({ status: "ok", unverified: true });
    expect(W.config.relay).toEqual({ enabled: false });
  });

  it("still fails when the patch itself fails", async () => {
    const { W, session } = setup();
    W.fail.patchDaemonConfig = codedError("no", "boom");
    const results = await run(session, [{ id: "s", host: "srv_W", op: "setRow", rowId: "sys", value: "x" }]);
    expect(results[0].outcome).toMatchObject({ status: "failed", error: { code: "host_error", detail: "boom" } });
  });
});

describe("providers paste", () => {
  const target = { providers: { claude: { enabled: true, options: { apiKey: "real-key-on-target" } } } };

  it("updates only providers the target has, keeps masked keys and reports the others as ignored", async () => {
    const { W, session } = setup({ W: { config: target } });
    const results = await run(session, [
      { id: "p", host: "srv_W", op: "setRow", rowId: "prov", value: { claude: { enabled: false, options: { apiKey: "<masked>" } }, extra: { enabled: true } } },
    ]);
    expect(results[0].outcome).toEqual({ status: "ignored", paths: ["providers.extra"] });
    expect(W.config.providers).toEqual({ claude: { enabled: false, options: { apiKey: "real-key-on-target" } } });
    expect(W.calls).toEqual(["getDaemonConfig", "patch:providers", "getDaemonConfig"]);
  });

  it("does not patch at all when the target has none of the providers", async () => {
    const { W, session } = setup({ W: { config: target } });
    const results = await run(session, [{ id: "p", host: "srv_W", op: "setRow", rowId: "prov", value: { a: { enabled: true }, b: { enabled: false } } }]);
    expect(results[0].outcome).toEqual({ status: "ignored", paths: ["providers.a", "providers.b"] });
    expect(writes(W)).toEqual([]);
  });

  it("is ok when every provider exists on the target", async () => {
    const { W, session } = setup({ W: { config: target } });
    const results = await run(session, [{ id: "p", host: "srv_W", op: "setRow", rowId: "prov", value: { claude: { enabled: false } } }]);
    expect(results[0].outcome).toEqual({ status: "ok" });
    expect(W.config.providers).toEqual({ claude: { enabled: false, options: { apiKey: "real-key-on-target" } } });
  });
});

describe("per-host timeout", () => {
  it("is the base plus one step per install or update item", () => {
    const base = { host: "h" };
    const items: ApplyItem[] = [
      { ...base, id: "i", op: "installPlugin", source: "a/b", confirmed: true },
      { ...base, id: "u", op: "updatePlugin", pluginId: "p" },
      { ...base, id: "s", op: "setRow", rowId: "sys", value: "x" },
      { ...base, id: "r", op: "reloadPlugin", pluginId: "p" },
    ];
    expect(hostTimeoutMs([])).toBe(APPLY_BASE_TIMEOUT_MS);
    expect(APPLY_BASE_TIMEOUT_MS).toBe(60_000);
    expect(hostTimeoutMs(items)).toBe(180_000);
    expect(hostTimeoutMs(items.slice(2))).toBe(60_000);
  });
});
