import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_READ_PATHS,
  consentSchema,
  settingsReadRpc,
  settingsWriteRpc,
  type Consent,
} from "../../shared/companion-contracts";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import { readConfig } from "../../server/companion/config";
import { revisionOf, type CompanionContext } from "../../server/companion/files";
import { hostInfo } from "../../server/companion";
import { listSettings, readSettings, restoreSettings, writeSettings } from "../../server/companion/plugin-settings";

let home: string;
let consent: Consent;
let ctx: CompanionContext;

const configFile = () => path.join(home, "config.json");
const settingsFile = (plugin: string, id: string) => path.join(home, "plugin-settings", plugin, `${id}.json`);
const posixModes = process.platform !== "win32";

function writeConfig(value: object): string {
  fs.writeFileSync(configFile(), JSON.stringify(value), { mode: 0o600 });
  return revisionOf(fs.readFileSync(configFile()));
}

function writeSettingsFile(plugin: string, id: string, document: object): string {
  const file = settingsFile(plugin, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(document));
  return revisionOf(fs.readFileSync(file));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mhm-companion-"));
  consent = { allowPluginSettingsWrites: true };
  ctx = { home, consent: async () => consent };
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("consent defaults", () => {
  it("the settings-write opt-in defaults to false and the removed config-write opt-in is dropped", () => {
    expect(consentSchema.parse({})).toEqual({ allowPluginSettingsWrites: false });
    expect(consentSchema.parse({ allowConfigWrites: true })).toEqual({ allowPluginSettingsWrites: false });
  });
});

describe("hostInfo", () => {
  it("reports platform, arch and a home-relative path only, no OS release or Node version", () => {
    const info = hostInfo(path.join(os.homedir(), ".paseo"), consent);
    expect(info).toEqual({ platform: process.platform, arch: process.arch, paseoHome: "~/.paseo", consent });
    expect(hostInfo(home, consent).paseoHome).toBeNull();
  });
});

describe("config.read", () => {
  it("returns only the restart-only keys and never auth hashes, registry credentials or patchable keys", () => {
    const revision = writeConfig({
      daemon: {
        listen: "127.0.0.1:6767",
        auth: { password: "$2b$10$abcdefghijklmnopqrstuv" },
        relay: { enabled: true, endpoint: "relay.example" },
        appendSystemPrompt: "prompt",
      },
      pluginRegistries: { "plugins.example": { authorization: "Bearer topsecret" } },
      worktrees: { root: "/wt" },
      log: { console: { level: "info" } },
      pluginsEnabled: true,
      agents: { providers: { claude: { enabled: true, env: { ANTHROPIC_API_KEY: "sk-live" } } } },
    });
    expect(readConfig(ctx)).toEqual({
      ok: true,
      revision,
      values: { "daemon.listen": "127.0.0.1:6767", "worktrees.root": "/wt", "log.console.level": "info" },
      maskedPaths: [],
    });
    expect(CONFIG_READ_PATHS).toEqual(["daemon.listen", "worktrees.root", "log.console.level"]);
    const text = JSON.stringify(readConfig(ctx));
    for (const needle of ["$2b$", "topsecret", "sk-live", "relay.example", "prompt"]) expect(text).not.toContain(needle);
  });

  it("returns the 'missing' revision and no values without a file", () => {
    expect(readConfig(ctx)).toEqual({ ok: true, revision: "missing", values: {}, maskedPaths: [] });
  });

  it.each(["{ not json", "[1, 2]", "null"])("reports an unparseable config.json (%s) as invalid_document, not as empty values", (content) => {
    fs.writeFileSync(configFile(), content);
    expect(readConfig(ctx)).toEqual({
      ok: false,
      code: "invalid_document",
      message: expect.any(String),
      currentRevision: revisionOf(Buffer.from(content)),
    });
  });
});

describe("plugin settings documents", () => {
  const ref = { pluginId: "other-plugin", settingsId: "main" };

  it("lists documents, ignoring backups and odd names", () => {
    writeSettingsFile("other-plugin", "main", { version: 1, values: {} });
    fs.writeFileSync(`${settingsFile("other-plugin", "main")}.bak`, "{}");
    fs.writeFileSync(path.join(home, "plugin-settings", "other-plugin", "bad name.json"), "{}");
    expect(listSettings(ctx).documents).toEqual([
      { pluginId: "other-plugin", settingsId: "main", revision: revisionOf(fs.readFileSync(settingsFile("other-plugin", "main"))), hasBackup: true },
    ]);
  });

  it("reads with secrets masked by key and by value, and works with opt-in off", () => {
    consent = { allowPluginSettingsWrites: false };
    const revision = writeSettingsFile("other-plugin", "main", { version: 2, values: { name: "n", apiToken: "abc", note: "ghp_zzz" } });
    expect(readSettings(ctx, ref)).toEqual({
      ok: true,
      revision,
      version: 2,
      values: { name: "n", apiToken: MASK_PLACEHOLDER, note: MASK_PLACEHOLDER },
      maskedPaths: ["apiToken", "note"],
      hasBackup: false,
    });
  });

  it("reads a missing document as revision 'missing'", () => {
    expect(readSettings(ctx, ref)).toMatchObject({ ok: true, revision: "missing", version: null, values: null });
  });

  it("is capability_disabled for write and restore when allowPluginSettingsWrites is off", async () => {
    const revision = writeSettingsFile("other-plugin", "main", { version: 1, values: { a: 1 } });
    consent = { allowPluginSettingsWrites: false };
    expect(await writeSettings(ctx, { ...ref, expectedRevision: revision, version: 1, values: { a: 2 } })).toMatchObject({ ok: false, code: "capability_disabled" });
    expect(await restoreSettings(ctx, { ...ref, expectedRevision: revision })).toMatchObject({ ok: false, code: "capability_disabled" });
    expect(JSON.parse(fs.readFileSync(settingsFile("other-plugin", "main"), "utf8"))).toEqual({ version: 1, values: { a: 1 } });
  });

  it("refuses to write the companion's own settings", async () => {
    const result = await writeSettings(ctx, { pluginId: "paseo-multi-host-manager", settingsId: "companion", expectedRevision: "missing", version: 1, values: { allowPluginSettingsWrites: true } });
    expect(result).toMatchObject({ ok: false, code: "not_allowed" });
    expect(fs.existsSync(settingsFile("paseo-multi-host-manager", "companion"))).toBe(false);
  });

  it("refuses the own settings through a case alias, for write and restore", async () => {
    const alias = { pluginId: "PASEO-Multi-Host-Manager", settingsId: "companion" };
    expect(await writeSettings(ctx, { ...alias, expectedRevision: "missing", version: 1, values: { allowPluginSettingsWrites: true } })).toMatchObject({ ok: false, code: "not_allowed" });
    expect(await restoreSettings(ctx, { ...alias, expectedRevision: "missing" })).toMatchObject({ ok: false, code: "not_allowed" });
    expect(fs.existsSync(path.join(home, "plugin-settings"))).toBe(false);
  });

  it("rejects a trailing-dot alias of the own settings directory", async () => {
    const alias = { pluginId: "paseo-multi-host-manager.", settingsId: "companion" };
    expect(await writeSettings(ctx, { ...alias, expectedRevision: "missing", version: 1, values: { allowPluginSettingsWrites: true } })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await writeSettings(ctx, { pluginId: "other-plugin", settingsId: "companion.", expectedRevision: "missing", version: 1, values: {} })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(settingsWriteRpc.input.safeParse({ ...alias, expectedRevision: "missing", version: 1, values: {} }).success).toBe(false);
    expect(fs.existsSync(path.join(home, "plugin-settings"))).toBe(false);
  });

  it("refuses the own settings through a directory junction or symlink", async () => {
    const ownRevision = writeSettingsFile("paseo-multi-host-manager", "companion", { version: 1, values: { allowPluginSettingsWrites: true } });
    const ownFile = settingsFile("paseo-multi-host-manager", "companion");
    fs.symlinkSync(path.dirname(ownFile), path.join(home, "plugin-settings", "linked-plugin"), "junction");
    const linked = { pluginId: "linked-plugin", settingsId: "companion" };
    expect(await writeSettings(ctx, { ...linked, expectedRevision: ownRevision, version: 1, values: { allowPluginSettingsWrites: false } })).toMatchObject({ ok: false, code: "not_allowed" });
    expect(await restoreSettings(ctx, { ...linked, expectedRevision: ownRevision })).toMatchObject({ ok: false, code: "not_allowed" });
    expect(revisionOf(fs.readFileSync(ownFile))).toBe(ownRevision);
  });

  it("accepts one-character ids", async () => {
    expect(await writeSettings(ctx, { pluginId: "a", settingsId: "b", expectedRevision: "missing", version: 1, values: {} })).toMatchObject({ ok: true });
  });

  it("keeps unknown top-level fields of the existing document and replaces only version and values", async () => {
    const revision = writeSettingsFile("other-plugin", "main", { $schema: "s", version: 1, values: { a: 1 }, meta: { by: "x" } });
    expect(await writeSettings(ctx, { ...ref, expectedRevision: revision, version: 2, values: { a: 2 } })).toMatchObject({ ok: true });
    expect(JSON.parse(fs.readFileSync(settingsFile("other-plugin", "main"), "utf8"))).toEqual({ $schema: "s", version: 2, values: { a: 2 }, meta: { by: "x" } });
  });

  it("writes atomically with a backup, then restores it", async () => {
    const first = writeSettingsFile("other-plugin", "main", { version: 1, values: { a: 1 } });
    const written = await writeSettings(ctx, { ...ref, expectedRevision: first, version: 1, values: { a: 2 } });
    expect(written).toMatchObject({ ok: true, backedUp: true });
    const file = settingsFile("other-plugin", "main");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, values: { a: 2 } });
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"))).toEqual({ version: 1, values: { a: 1 } });
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(["main.json", "main.json.bak"]);
    if (posixModes) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(`${file}.bak`).mode & 0o777).toBe(0o600);
    }
    if (!written.ok) throw new Error("write failed");
    const restored = await restoreSettings(ctx, { ...ref, expectedRevision: written.revision });
    expect(restored).toMatchObject({ ok: true, revision: first });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ version: 1, values: { a: 1 } });
    // Restore swaps, so the overwritten document is now the backup.
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"))).toEqual({ version: 1, values: { a: 2 } });
  });

  it("creates a new document from 'missing' without a backup", async () => {
    const result = await writeSettings(ctx, { ...ref, expectedRevision: "missing", version: 3, values: { a: 1 } });
    expect(result).toMatchObject({ ok: true, backedUp: false });
    expect(JSON.parse(fs.readFileSync(settingsFile("other-plugin", "main"), "utf8"))).toEqual({ version: 3, values: { a: 1 } });
  });

  it("restore without a backup is not_found", async () => {
    const revision = writeSettingsFile("other-plugin", "main", { version: 1, values: {} });
    expect(await restoreSettings(ctx, { ...ref, expectedRevision: revision })).toMatchObject({ ok: false, code: "not_found" });
  });

  it("detects conflicts on write and restore", async () => {
    const stale = writeSettingsFile("other-plugin", "main", { version: 1, values: { a: 1 } });
    const current = writeSettingsFile("other-plugin", "main", { version: 1, values: { a: 9 } });
    expect(await writeSettings(ctx, { ...ref, expectedRevision: stale, version: 1, values: { a: 2 } })).toMatchObject({ ok: false, code: "conflict", currentRevision: current });
    expect(await restoreSettings(ctx, { ...ref, expectedRevision: stale })).toMatchObject({ ok: false, code: "conflict" });
    expect(JSON.parse(fs.readFileSync(settingsFile("other-plugin", "main"), "utf8"))).toEqual({ version: 1, values: { a: 9 } });
  });

  it("placeholder round trip keeps the target's secret; unresolved placeholder is rejected", async () => {
    const revision = writeSettingsFile("other-plugin", "main", { version: 1, values: { name: "old", apiToken: "real-secret" } });
    const read = readSettings(ctx, ref);
    if (!read.ok) throw new Error("read failed");
    const values = { ...(read.values as object), name: "new" };
    const result = await writeSettings(ctx, { ...ref, expectedRevision: revision, version: 1, values });
    expect(result).toMatchObject({ ok: true, keptMaskedPaths: ["apiToken"] });
    expect(JSON.parse(fs.readFileSync(settingsFile("other-plugin", "main"), "utf8")).values).toEqual({ name: "new", apiToken: "real-secret" });

    const target = revisionOf(fs.readFileSync(settingsFile("other-plugin", "main")));
    const rejected = await writeSettings(ctx, { ...ref, expectedRevision: target, version: 1, values: { name: "x", newSecret: MASK_PLACEHOLDER } });
    expect(rejected).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it.each([
    ["..", "main"],
    ["other-plugin", ".."],
    ["../escape", "main"],
    ["other-plugin", "../../config"],
    ["a/b", "main"],
    ["a\\b", "main"],
    ["", "main"],
    [".hidden", "main"],
    ["C:evil", "main"],
  ])("rejects traversal %s / %s in the handlers and in the RPC contracts", async (pluginId, settingsId) => {
    expect(readSettings(ctx, { pluginId, settingsId })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await writeSettings(ctx, { pluginId, settingsId, expectedRevision: "missing", version: 1, values: {} })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(await restoreSettings(ctx, { pluginId, settingsId, expectedRevision: "missing" })).toMatchObject({ ok: false, code: "invalid_input" });
    expect(settingsReadRpc.input.safeParse({ pluginId, settingsId }).success).toBe(false);
    expect(settingsWriteRpc.input.safeParse({ pluginId, settingsId, expectedRevision: "missing", version: 1, values: {} }).success).toBe(false);
    expect(fs.existsSync(path.join(home, "plugin-settings"))).toBe(false);
  });
});
