import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  configReadRpc,
  hostInfoRpc,
  settingsListRpc,
  settingsReadRpc,
  settingsRestoreRpc,
  settingsWriteRpc,
} from "../../shared/companion-contracts";
import { patchConfigVerified } from "../../server/broker/config-patch";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import type { DaemonClient, RoutedClient } from "../../server/broker/daemon-client";
import { COMPANION_SETTINGS, connectHub, enabled, hostFiles, PLUGIN_ID, routeTo, setConsent } from "./env";
import type { HostFiles } from "./env";

// Unique per run so the suite can be repeated against the same environment.
const PROMPT = `mhm integration test prompt ${Date.now()}`;
const DUMMY = { pluginId: "mhm-dummy-plugin", settingsId: "prefs" };
const DUMMY_FILE = `plugin-settings/${DUMMY.pluginId}/${DUMMY.settingsId}.json`;
const SECRET = "sk-mhm-integration-secret-0123456789";
const platforms = { W: "win32", L: "linux" } as const;

describe.each(["W", "L"] as const)("companion on %s through the hub", (key) => {
  if (!enabled) return it.skip("needs MHM_TESTENV=1");

  let hub: DaemonClient;
  let routed: RoutedClient;
  let host: DaemonClient;
  const files: HostFiles = hostFiles[key];
  let originalPrompt = "";

  const call = <T extends { name: string; output: { parse(value: unknown): unknown } }>(rpc: T, input: unknown) =>
    host.invokePluginRpc(PLUGIN_ID, rpc.name, input).then((raw) => rpc.output.parse(raw) as ReturnType<T["output"]["parse"]>);

  beforeAll(async () => {
    hub = await connectHub();
    routed = await routeTo(hub, key);
    host = routed.client;
    originalPrompt = (await host.getDaemonConfig()).config.appendSystemPrompt ?? "";
    setConsent(files, false);
    files.remove(`${DUMMY_FILE}.bak`);
    files.write(DUMMY_FILE, JSON.stringify({ version: 1, values: { name: "dummy", count: 3, apiToken: SECRET, nested: { password: "pw-12345" } } }));
  });
  afterAll(async () => {
    await patchConfigVerified(host, { appendSystemPrompt: originalPrompt }).catch(() => undefined);
    files.remove(DUMMY_FILE);
    files.remove(`${DUMMY_FILE}.bak`);
    setConsent(files, false);
    await routed?.close();
    await hub?.close();
  });

  it("host.info reports platform and arch only, and no consent", async () => {
    const raw = await host.invokePluginRpc(PLUGIN_ID, hostInfoRpc.name, {});
    expect(Object.keys(raw as object).sort()).toEqual(["arch", "consent", "paseoHome", "platform"]);
    const info = hostInfoRpc.output.parse(raw);
    expect(info.platform).toBe(platforms[key]);
    expect(info.consent).toEqual({ allowPluginSettingsWrites: false });
    // Only paths below the user's home are reported, and then with "~"; W's home lives in the repo.
    expect(info.paseoHome).toBe(key === "W" ? null : "~/mhm-testenv/home");
  });

  it("settings.write is capability_disabled without consent", async () => {
    const read = await call(settingsReadRpc, DUMMY);
    const result = await call(settingsWriteRpc, { ...DUMMY, expectedRevision: read.ok ? read.revision : "", version: 1, values: {} });
    expect(result).toMatchObject({ ok: false, code: "capability_disabled" });
  });

  it("config.write-keys is not exposed: the hub patches config through config.patch instead", async () => {
    await expect(host.invokePluginRpc(PLUGIN_ID, "mhm.config.write-keys", {})).rejects.toThrow();
  });

  it("patchConfigVerified applies daemon.appendSystemPrompt through the hub and config.get confirms it", async () => {
    const result = await patchConfigVerified(host, { appendSystemPrompt: PROMPT });
    expect(result).toEqual({ applied: ["appendSystemPrompt"], ignored: [] });
    expect((await host.getDaemonConfig()).config.appendSystemPrompt).toBe(PROMPT);
  });

  it("patchConfigVerified reports a key the daemon silently ignores", async () => {
    const ignoredKey = { worktrees: { root: "mhm-not-patchable" } };
    expect(await patchConfigVerified(host, ignoredKey)).toEqual({ applied: [], ignored: ["worktrees.root"] });
  });

  it("config.read returns only the restart-only keys, without secrets", async () => {
    const original = files.read("config.json");
    if (original === null) throw new Error("config.json missing");
    const document = JSON.parse(original);
    const hash: string = document.daemon.auth.password;
    expect(hash).toMatch(/^\$2/);
    document.worktrees = { root: "mhm-worktrees-test" };
    document.log = { console: { level: "info" } };
    document.pluginRegistries = { "registry.example.test": { authorization: `Bearer ${SECRET}` } };
    files.write("config.json", JSON.stringify(document, null, 2));
    try {
      const read = await call(configReadRpc, {});
      expect(read.ok && read.values).toEqual({
        "daemon.listen": `127.0.0.1:${key === "W" ? 6768 : 6769}`,
        "worktrees.root": "mhm-worktrees-test",
        "log.console.level": "info",
      });
      const serialized = JSON.stringify(read);
      for (const needle of [hash, SECRET, PROMPT, "registry.example.test", "authorization"]) expect(serialized.includes(needle)).toBe(false);
    } finally {
      files.write("config.json", original);
    }
  });

  it("keeps the relay transport enabled", async () => {
    expect((await host.getDaemonConfig()).config.relay?.enabled).toBe(true);
  });

  describe("plugin settings documents", () => {
    beforeAll(() => setConsent(files, true));

    it("lists the dummy document", async () => {
      const list = await call(settingsListRpc, {});
      expect(list.documents).toContainEqual(expect.objectContaining({ ...DUMMY, hasBackup: false }));
    });

    it("reads with secrets masked", async () => {
      const read = await call(settingsReadRpc, DUMMY);
      expect(read).toMatchObject({ ok: true, version: 1, values: { name: "dummy", count: 3, apiToken: MASK_PLACEHOLDER, nested: { password: MASK_PLACEHOLDER } } });
      expect(JSON.stringify(read)).not.toContain(SECRET);
      expect(JSON.stringify(read)).not.toContain("pw-12345");
      expect(read.ok && read.maskedPaths.sort()).toEqual(["apiToken", "nested.password"]);
    });

    it("round-trips the masked placeholder, writes a backup and keeps the secret on disk", async () => {
      const read = await call(settingsReadRpc, DUMMY);
      if (!read.ok) throw new Error("read failed");
      const values = { ...(read.values as Record<string, unknown>), name: "renamed", count: 4 };
      const written = await call(settingsWriteRpc, { ...DUMMY, expectedRevision: read.revision, version: 1, values });
      expect(written).toMatchObject({ ok: true, backedUp: true });
      expect(written.ok && written.keptMaskedPaths.sort()).toEqual(["apiToken", "nested.password"]);
      const onDisk = JSON.parse(files.read(DUMMY_FILE) ?? "null");
      expect(onDisk).toEqual({ version: 1, values: { name: "renamed", count: 4, apiToken: SECRET, nested: { password: "pw-12345" } } });
      expect(files.exists(`${DUMMY_FILE}.bak`)).toBe(true);
      if (key === "L") expect(files.mode(DUMMY_FILE)).toBe("600");
    });

    it("rejects a stale revision and an unresolvable placeholder", async () => {
      const read = await call(settingsReadRpc, DUMMY);
      if (!read.ok) throw new Error("read failed");
      const stale = await call(settingsWriteRpc, { ...DUMMY, expectedRevision: "0".repeat(64), version: 1, values: {} });
      expect(stale).toMatchObject({ ok: false, code: "conflict", currentRevision: read.revision });
      const orphan = await call(settingsWriteRpc, { ...DUMMY, expectedRevision: read.revision, version: 1, values: { brandNewToken: MASK_PLACEHOLDER } });
      expect(orphan).toMatchObject({ ok: false, code: "invalid_input" });
    });

    it("restores the previous document", async () => {
      const read = await call(settingsReadRpc, DUMMY);
      if (!read.ok) throw new Error("read failed");
      const restored = await call(settingsRestoreRpc, { ...DUMMY, expectedRevision: read.revision });
      expect(restored.ok).toBe(true);
      const onDisk = JSON.parse(files.read(DUMMY_FILE) ?? "null");
      expect(onDisk.values).toMatchObject({ name: "dummy", count: 3, apiToken: SECRET });
      const after = await call(settingsReadRpc, DUMMY);
      expect(after.ok && after.revision).toBe(restored.ok && restored.revision);
    });

    it("refuses to write the companion's own consent document and path traversal", async () => {
      const consentBefore = files.read(COMPANION_SETTINGS);
      const own = await call(settingsWriteRpc, { pluginId: PLUGIN_ID, settingsId: "companion", expectedRevision: "x", version: 1, values: { allowPluginSettingsWrites: false } });
      expect(own).toMatchObject({ ok: false, code: "not_allowed" });
      expect(files.read(COMPANION_SETTINGS)).toBe(consentBefore);
      await expect(host.invokePluginRpc(PLUGIN_ID, settingsReadRpc.name, { pluginId: "..", settingsId: "x" })).rejects.toThrow();
    });
  });
});
