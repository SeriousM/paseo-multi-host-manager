import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { applyRpc, gridLoadRpc, docReadRpc } from "../../shared/contracts";
import type { ApplyItem, ApplyResult, GridHostData } from "../../shared/contracts";
import { patchConfigVerified } from "../../server/broker/config-patch";
import type { DaemonClient } from "../../server/broker/daemon-client";
import { connectDirectW, connectHub, enabled, hostFiles, hubHome, PLUGIN_ID, readSecrets, readState, relayPairing, routeTo, setConsent } from "./env";

const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
const KEEP_AWAKE = "hichamboushaba/keep-awake";
const KEEP_AWAKE_ID = "keep-awake";
// An npm source with a version pins it, which is how an update can be tried: the registry always installs the latest.
const KEEP_AWAKE_OLD = "npm:paseo-keep-awake@0.1.2";
const PROMPT = `mhm grid test prompt ${Date.now()}`;
const DUMMY = { pluginId: "mhm-dummy-plugin", settingsId: "prefs" };
const DUMMY_FILE = `plugin-settings/${DUMMY.pluginId}/${DUMMY.settingsId}.json`;
const SECRET = "sk-mhm-grid-secret-0123456789";

describe.skipIf(!enabled)("grid load and apply through the hub plugin", () => {
  let hub: DaemonClient;
  const ids = { W: "", L: "" };

  const load = async () => gridLoadRpc.output.parse(await hub.invokePluginRpc(PLUGIN_ID, gridLoadRpc.name, policy)).hosts;
  const dataOf = async (host: "W" | "L"): Promise<GridHostData> => {
    const result = (await load()).find((row) => row.id === ids[host])?.result;
    if (!result?.ok) throw new Error(`host ${host} is not ok: ${JSON.stringify(result)}`);
    return result.value;
  };
  const apply = async (...items: ApplyItem[]): Promise<ApplyResult[]> =>
    applyRpc.output.parse(await hub.invokePluginRpc(PLUGIN_ID, applyRpc.name, { ...policy, items })).results;
  const waitFor = async <T>(read: () => Promise<T>, done: (value: T) => boolean, attempts = 20): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const value = await read();
      if (done(value) || attempt >= attempts) return value;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  };

  beforeAll(async () => {
    hub = await connectHub();
    const state = readState();
    for (const key of ["W", "L"] as const) {
      const serverId = state.hubHosts.find((h) => h.key === key)?.serverId;
      if (!serverId) throw new Error(`host ${key} has no serverId`);
      ids[key] = serverId;
    }
  });
  afterAll(async () => {
    await hub?.close();
  });

  describe("grid.load", () => {
    it("shows the hub and W and L with rows, plugins and a running companion", async () => {
      const hosts = await load();
      expect(hosts[0]).toMatchObject({ isHub: true, result: { ok: true } });
      const hubData = hosts[0].result.ok ? hosts[0].result.value : null;
      expect(hubData?.companion.state).toBe("ok");
      expect(hubData?.rows.ver.value).toMatch(/^0\.1[34]\./);
      expect(hubData?.rows.pw.state).toBe("protected");
      for (const [key, platform, port] of [["W", "win32", 6768], ["L", "linux", 6769]] as const) {
        const data = await dataOf(key);
        expect(data.rows.ver).toMatchObject({ state: "ok" });
        expect(data.rows.osn).toMatchObject({ state: "ok", value: platform });
        expect(data.rows.conn).toMatchObject({ state: "ok", value: "relay" });
        expect(data.rows.listen).toMatchObject({ state: "ok", value: `127.0.0.1:${port}` });
        expect(data.rows.relay).toMatchObject({ state: "ok", value: true });
        expect(data.rows.pen).toMatchObject({ state: "ok", value: true });
        expect(data.companion).toMatchObject({ state: "ok", platform, consent: { allowPluginSettingsWrites: false } });
        expect(data.plugins.find((plugin) => plugin.id === PLUGIN_ID)).toMatchObject({ enabled: true, status: "running" });
      }
    });

    it("reports the wrong-password entry as a failure of that host only", async () => {
      const state = readState();
      const entry = state.hubHosts.find((h) => h.key === "W-wrongpw");
      const row = (await load()).find((host) => host.id === (entry?.serverId ?? entry?.registrationId));
      expect(row?.result).toMatchObject({ ok: false, error: { code: "authentication_failed" } });
    });

    it("leaks no secret, connection string, relay endpoint or local path", async () => {
      const raw = await hub.invokePluginRpc(PLUGIN_ID, gridLoadRpc.name, policy);
      const secrets = readSecrets();
      const pairing = relayPairing();
      const credential = fs.readFileSync(path.join(hubHome(), "local-credential"), "utf8").trim();
      const needles = [secrets.windows, secrets.wsl, "wrong-password", pairing.endpoint, pairing.key, credential, "relay://", ".testenv", "mhm-testenv"];
      const text = JSON.stringify(raw);
      for (const needle of needles) {
        expect(needle.length).toBeGreaterThan(5);
        expect(text.includes(needle), `grid output contains a needle (${needle.slice(0, 3)}...)`).toBe(false);
      }
      expect(text).not.toMatch(/[A-Za-z]:\\\\|\/home\//);
    });
  });

  describe("plugin lifecycle on L", () => {
    const find = async () => (await dataOf("L")).plugins.find((plugin) => plugin.id === KEEP_AWAKE_ID);
    const removeIfPresent = async () => {
      const present = await find();
      if (present) await apply({ id: "cleanup", host: ids.L, op: "removePlugin", pluginId: present.id, confirmed: true });
    };
    beforeAll(removeIfPresent, 120_000);
    afterAll(removeIfPresent, 120_000);

    it("refuses an install without confirmation", async () => {
      const [result] = await apply({ id: "i", host: ids.L, op: "installPlugin", source: KEEP_AWAKE });
      expect(result.outcome).toMatchObject({ status: "failed", error: { code: "confirmation_required" } });
      expect(await find()).toBeUndefined();
    });

    it("installs keep-awake from the registry", async () => {
      const [result] = await apply({ id: "i", host: ids.L, op: "installPlugin", source: KEEP_AWAKE, confirmed: true });
      expect(result.outcome).toMatchObject({ status: "ok", pluginStatus: "running" });
      const installed = await find();
      expect(installed).toMatchObject({ enabled: true, status: "running", source: { kind: "registry", installSource: KEEP_AWAKE, pinned: false } });
      expect(installed?.version).toBeTruthy();
    }, 120_000);

    it("disables and enables it on the remote host", async () => {
      const installed = await find();
      if (!installed) throw new Error("not installed");
      const [off] = await apply({ id: "d", host: ids.L, op: "setPluginEnabled", pluginId: installed.id, enabled: false });
      expect(off.outcome).toMatchObject({ status: "ok", pluginStatus: "disabled" });
      expect(await find()).toMatchObject({ enabled: false, status: "disabled" });
      const [on] = await apply({ id: "e", host: ids.L, op: "setPluginEnabled", pluginId: installed.id, enabled: true });
      expect(on.outcome).toMatchObject({ status: "ok", pluginStatus: "running" });
      expect(await find()).toMatchObject({ enabled: true, status: "running" });
    }, 120_000);

    it("checks for updates without changing anything, and agrees with the daemon's own preview", async () => {
      const installed = await find();
      if (!installed) throw new Error("not installed");
      const [check] = await apply({ id: "u", host: ids.L, op: "updatePlugin", pluginId: installed.id, checkOnly: true });
      expect(check.outcome).toMatchObject({ status: "ok", pluginId: installed.id });
      const routed = await routeTo(hub, "L");
      try {
        const [preview] = await routed.client.previewPluginUpdates({ pluginId: installed.id });
        expect(preview?.outcome).not.toBe("error");
        expect(check.outcome.status === "ok" && check.outcome.updateOutcome).toBe(preview?.outcome);
      } finally {
        await routed.close();
      }
      expect((await find())?.version).toBe(installed.version);
    }, 120_000);

    it("runs the update item (a no-op when current) and reloads the plugin", async () => {
      const installed = await find();
      if (!installed) throw new Error("not installed");
      const [update, reload] = await apply(
        { id: "u", host: ids.L, op: "updatePlugin", pluginId: installed.id },
        { id: "r", host: ids.L, op: "reloadPlugin", pluginId: installed.id },
      );
      expect(update.outcome).toMatchObject({ status: "ok" });
      expect(reload.outcome).toMatchObject({ status: "ok", pluginStatus: "running" });
    }, 120_000);

    it("applies a real update from a pinned older version", async () => {
      await apply({ id: "x", host: ids.L, op: "removePlugin", pluginId: KEEP_AWAKE_ID, confirmed: true });
      const [install] = await apply({ id: "i", host: ids.L, op: "installPlugin", source: KEEP_AWAKE_OLD, confirmed: true });
      expect(install.outcome).toMatchObject({ status: "ok", pluginId: KEEP_AWAKE_ID, version: "0.1.2" });
      // The listed source is pinned, so copying it to another host reproduces 0.1.2.
      expect(await find()).toMatchObject({ version: "0.1.2", source: { kind: "npm", installSource: KEEP_AWAKE_OLD, ref: null, pinned: true } });
      const [check] = await apply({ id: "c", host: ids.L, op: "updatePlugin", pluginId: KEEP_AWAKE_ID, checkOnly: true });
      expect(check.outcome).toMatchObject({ status: "ok", updateOutcome: "update" });
      expect((await find())?.version).toBe("0.1.2");
      const [update] = await apply({ id: "u", host: ids.L, op: "updatePlugin", pluginId: KEEP_AWAKE_ID });
      expect(update.outcome).toMatchObject({ status: "ok", updateOutcome: "updated", version: "0.1.3" });
      expect(await find()).toMatchObject({ version: "0.1.3", enabled: true, status: "running" });
    }, 180_000);

    it("removes it after confirmation", async () => {
      const installed = await find();
      if (!installed) throw new Error("not installed");
      const [unconfirmed] = await apply({ id: "x", host: ids.L, op: "removePlugin", pluginId: installed.id });
      expect(unconfirmed.outcome).toMatchObject({ status: "failed", error: { code: "confirmation_required" } });
      expect(await find()).toBeDefined();
      const [removed] = await apply({ id: "x", host: ids.L, op: "removePlugin", pluginId: installed.id, confirmed: true });
      expect(removed.outcome).toMatchObject({ status: "ok" });
      expect(await find()).toBeUndefined();
    }, 120_000);
  });

  describe("setRow", () => {
    it("sets appendSystemPrompt on W and the next load confirms it", async () => {
      const original = (await dataOf("W")).rows.sys.value;
      expect(typeof original).toBe("string");
      try {
        const [result] = await apply({ id: "s", host: ids.W, op: "setRow", rowId: "sys", value: PROMPT });
        expect(result.outcome).toEqual({ status: "ok" });
        expect((await dataOf("W")).rows.sys).toMatchObject({ state: "ok", value: PROMPT });
      } finally {
        // The saved host's registration id names the same host as its server id.
        const registrationId = readState().hubHosts.find((h) => h.key === "W")?.registrationId ?? "";
        const [restored] = await apply({ id: "restore", host: registrationId, op: "setRow", rowId: "sys", value: String(original) });
        expect(restored.outcome).toEqual({ status: "ok" });
      }
      expect((await dataOf("W")).rows.sys.value).toBe(original);
    });

    it.each(["W", "L"] as const)("handles the idle row on %s by Paseo version: live from 0.14.0, 'needs newer Paseo' before", async (key) => {
      const before = (await dataOf(key)).rows;
      const minor = Number(/^0\.(\d+)\./.exec(String(before.ver.value))?.[1]);
      const item = (value: boolean): ApplyItem => ({ id: "idle", host: ids[key], op: "setRow", rowId: "idle", value });
      if (minor < 14) {
        expect(before.idle).toEqual({ state: "needs_newer_paseo", value: null, maskedPaths: [] });
        const [result] = await apply(item(false));
        expect(result.outcome).toMatchObject({ status: "failed", error: { code: "unsupported_capability", detail: "idleRuntimeCleanupSetting" } });
        return;
      }
      expect(before.idle).toMatchObject({ state: "ok", value: expect.any(Boolean) });
      const original = before.idle.value === true;
      try {
        const [result] = await apply(item(!original));
        expect(result.outcome).toEqual({ status: "ok" });
        expect((await dataOf(key)).rows.idle).toMatchObject({ state: "ok", value: !original });
      } finally {
        const [restored] = await apply(item(original));
        expect(restored.outcome).toEqual({ status: "ok" });
      }
      expect((await dataOf(key)).rows.idle.value).toBe(original);
    });

    it("rejects read-only rows and leaves the host alone", async () => {
      const results = await apply(
        { id: "wt", host: ids.W, op: "setRow", rowId: "wt", value: "/x" },
        { id: "pw", host: ids.W, op: "setRow", rowId: "pw", value: "x" },
        { id: "nope", host: ids.W, op: "setRow", rowId: "nope", value: true },
      );
      expect(results.map((result) => result.outcome)).toMatchObject([
        { status: "failed", error: { code: "invalid_item", detail: "read_only_row" } },
        { status: "failed", error: { code: "invalid_item", detail: "protected_row" } },
        { status: "failed", error: { code: "invalid_item", detail: "unknown_row" } },
      ]);
    });

    it("targets the hub without touching it: update check of our own directory plugin is local", async () => {
      const hubId = (await load())[0].id;
      const [result] = await apply({ id: "h", host: hubId, op: "updatePlugin", pluginId: PLUGIN_ID, checkOnly: true });
      expect(result.outcome).toMatchObject({ status: "ok", updateOutcome: "local" });
    });
  });

  describe("settings document paste from W to L", () => {
    const readDoc = async (host: string) =>
      docReadRpc.output.parse(await hub.invokePluginRpc(PLUGIN_ID, docReadRpc.name, { ...policy, host, ...DUMMY }));
    const clean = () => {
      for (const files of [hostFiles.W, hostFiles.L]) {
        files.remove(DUMMY_FILE);
        files.remove(`${DUMMY_FILE}.bak`);
      }
      setConsent(hostFiles.L, false);
    };
    beforeAll(() => {
      clean();
      hostFiles.W.write(DUMMY_FILE, JSON.stringify({ version: 2, values: { name: "from W", count: 3, apiToken: SECRET } }));
    });
    afterAll(clean);

    it("is refused while L has not opted in", async () => {
      const target = await readDoc(ids.L);
      if (!target.ok || !target.value.ok) throw new Error("read L failed");
      const [result] = await apply({ id: "w", host: ids.L, op: "writeSettingsDoc", ...DUMMY, expectedRevision: target.value.revision, version: 2, values: { name: "x" } });
      expect(result.outcome).toMatchObject({ status: "failed", error: { code: "capability_disabled", detail: "capability_disabled" } });
    });

    it("reads W's document masked and lists it in the grid", async () => {
      const source = await readDoc(ids.W);
      expect(source).toMatchObject({ ok: true, value: { ok: true, version: 2, values: { name: "from W", count: 3, apiToken: "<masked>" }, maskedPaths: ["apiToken"] } });
      expect(JSON.stringify(source)).not.toContain(SECRET);
      const companion = (await dataOf("W")).companion;
      expect(companion.state === "ok" && companion.settingsDocuments).toContainEqual(expect.objectContaining(DUMMY));
    });

    it("writes the pasted document to L, reports validity unknown and the plugin can then be reloaded", async () => {
      setConsent(hostFiles.L, true);
      const source = await readDoc(ids.W);
      const target = await readDoc(ids.L);
      if (!source.ok || !source.value.ok || !target.ok || !target.value.ok) throw new Error("read failed");
      const maskedPaths = source.value.maskedPaths;
      const values = z.record(z.string(), z.json()).parse(source.value.values);
      // A masked placeholder has no value on L: the paste drops the secret instead of copying it.
      const [withSecret] = await apply({ id: "bad", host: ids.L, op: "writeSettingsDoc", ...DUMMY, expectedRevision: target.value.revision, version: 2, values });
      expect(withSecret.outcome).toMatchObject({ status: "failed", error: { detail: "invalid_input" } });
      const portable = Object.fromEntries(Object.entries(values).filter(([key]) => !maskedPaths.includes(key)));
      const [written, reload] = await apply(
        { id: "w", host: ids.L, op: "writeSettingsDoc", ...DUMMY, expectedRevision: target.value.revision, version: 2, values: portable },
        { id: "r", host: ids.L, op: "reloadPlugin", pluginId: PLUGIN_ID },
      );
      expect(written.outcome).toMatchObject({ status: "ok", validity: "unknown", reloadSuggested: true, backedUp: false });
      expect(reload.outcome).toMatchObject({ status: "ok", pluginStatus: "running" });
      expect(JSON.parse(hostFiles.L.read(DUMMY_FILE) ?? "null")).toEqual({ version: 2, values: { name: "from W", count: 3 } });
      expect(JSON.stringify(written)).not.toContain(SECRET);
      // A stale revision is a conflict that names the current one.
      const [stale] = await apply({ id: "s", host: ids.L, op: "writeSettingsDoc", ...DUMMY, expectedRevision: target.value.revision, version: 2, values: portable });
      expect(stale.outcome).toMatchObject({ status: "failed", error: { detail: "conflict" }, currentRevision: written.outcome.status === "ok" ? written.outcome.revision : "" });
    }, 120_000);
  });

  describe("pluginsEnabled off on L", () => {
    afterAll(async () => {
      const routed = await routeTo(hub, "L");
      try {
        await patchConfigVerified(routed.client, { pluginsEnabled: true });
      } finally {
        await routed.close();
      }
    });

    it("marks the companion disabled, not failed, and comes back after switching on", async () => {
      const [off] = await apply({ id: "off", host: ids.L, op: "setRow", rowId: "pen", value: false, confirmed: true });
      expect(off.outcome).toEqual({ status: "ok" });
      const row = (await load()).find((host) => host.id === ids.L);
      expect(row?.result.ok).toBe(true);
      const data = await dataOf("L");
      expect(data.companion).toEqual({ state: "disabled" });
      expect(data.rows.pen).toMatchObject({ state: "ok", value: false });
      expect(data.rows.osn.state).toBe("needs_companion");
      expect(data.rows.ver.state).toBe("ok");

      const [on] = await apply({ id: "on", host: ids.L, op: "setRow", rowId: "pen", value: true });
      expect(on.outcome).toEqual({ status: "ok" });
      const back = await waitFor(() => dataOf("L"), (value) => value.companion.state === "ok");
      expect(back.companion.state).toBe("ok");
      expect(back.rows.pen.value).toBe(true);
    }, 120_000);
  });

  describe("lockout confirmation and self target", () => {
    it("refuses switches that cut the hub off without confirmation and leaves the hosts alone", async () => {
      const results = await apply(
        { id: "relay", host: ids.W, op: "setRow", rowId: "relay", value: false },
        { id: "pen", host: ids.L, op: "setRow", rowId: "pen", value: false },
        { id: "remove", host: ids.W, op: "removePlugin", pluginId: PLUGIN_ID },
        { id: "disable", host: ids.L, op: "setPluginEnabled", pluginId: PLUGIN_ID, enabled: false },
      );
      for (const result of results) expect(result.outcome).toMatchObject({ status: "failed", error: { code: "lockout_confirmation_required" } });
      const [W, L] = [await dataOf("W"), await dataOf("L")];
      expect(W.rows.relay.value).toBe(true);
      expect(L.rows.pen.value).toBe(true);
      for (const data of [W, L]) expect(data.plugins.find((plugin) => plugin.id === PLUGIN_ID)).toMatchObject({ enabled: true, status: "running" });
    });

    it("never removes or disables this plugin on the hub, even when confirmed", async () => {
      const hubId = (await load())[0].id;
      const results = await apply(
        { id: "remove", host: hubId, op: "removePlugin", pluginId: PLUGIN_ID, confirmed: true },
        { id: "disable", host: hubId, op: "setPluginEnabled", pluginId: PLUGIN_ID, enabled: false, confirmed: true },
      );
      for (const result of results) expect(result.outcome).toMatchObject({ status: "failed", error: { code: "invalid_item", detail: "self_target" } });
      const hubRow = (await load())[0];
      expect(hubRow.result.ok && hubRow.result.value.plugins.find((plugin) => plugin.id === PLUGIN_ID)).toMatchObject({ enabled: true, status: "running" });
    });
  });

  describe("providers paste on W", () => {
    const KNOWN = "claude";
    const ABSENT = "mhm-absent-provider";
    let original: unknown;

    beforeAll(async () => {
      const routed = await routeTo(hub, "W");
      try {
        const providers = (await routed.client.getDaemonConfig()).config.providers;
        original = providers[KNOWN];
        if (original === undefined) await patchConfigVerified(routed.client, { providers: { [KNOWN]: { enabled: true } } });
      } finally {
        await routed.close();
      }
    });
    afterAll(async () => {
      const routed = await routeTo(hub, "W");
      try {
        await routed.client.patchDaemonConfig(original === undefined ? { removeProviders: [KNOWN] } : { providers: { [KNOWN]: z.record(z.string(), z.json()).parse(original) } });
      } finally {
        await routed.close();
      }
    });

    it("updates only providers W already has, drops masked keys and reports the others as ignoredPaths", async () => {
      const [result] = await apply({
        id: "p",
        host: ids.W,
        op: "setRow",
        rowId: "prov",
        value: { [KNOWN]: { enabled: false, apiKey: "<masked>" }, [ABSENT]: { enabled: true } },
      });
      expect(result.outcome).toEqual({ status: "ok", ignoredPaths: [`providers.${ABSENT}`] });
      const providers = (await dataOf("W")).rows.prov.value;
      expect(providers).toMatchObject({ [KNOWN]: { enabled: false } });
      expect(providers).not.toHaveProperty(ABSENT);
      expect(providers).not.toHaveProperty([KNOWN, "apiKey"]);
    });
  });

  // Last on purpose: it cuts the hub's relay link to W and restores it directly, so nothing may run on W meanwhile.
  describe("switch-off order on W", () => {
    it("runs other items, then pluginsEnabled off, and relay off last of all", async () => {
      const original = (await dataOf("W")).rows.sys.value;
      const direct = await connectDirectW();
      try {
        const results = await apply(
          { id: "relay", host: ids.W, op: "setRow", rowId: "relay", value: false, confirmed: true },
          { id: "pen", host: ids.W, op: "setRow", rowId: "pen", value: false, confirmed: true },
          { id: "sys", host: ids.W, op: "setRow", rowId: "sys", value: PROMPT },
        );
        // Relay off may drop the very connection that re-reads it: then it is ok but unverified, never failed.
        expect(results.map((result) => result.outcome)).toMatchObject([{ status: "ok" }, { status: "ok" }, { status: "ok" }]);
        const { config } = await direct.getDaemonConfig();
        expect(config.relay?.enabled).toBe(false);
        expect(config.pluginsEnabled).toBe(false);
        expect(config.appendSystemPrompt).toBe(PROMPT);
      } finally {
        await direct.patchDaemonConfig({ relay: { enabled: true }, pluginsEnabled: true, appendSystemPrompt: String(original) });
        await direct.close();
      }
      const back = await waitFor(
        async () => (await load()).find((row) => row.id === ids.W)?.result,
        (result) => result?.ok === true && result.value.companion.state === "ok",
        90,
      );
      expect(back).toMatchObject({ ok: true, value: { rows: { relay: { value: true }, pen: { value: true }, sys: { value: original } } } });
    }, 180_000);
  });
});
