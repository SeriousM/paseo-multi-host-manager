import { describe, expect, it } from "vitest";
import type { ApplyOutcome, GridHostData } from "../../shared/contracts";
import type { Json } from "../../shared/mask";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import { docStatus, editorAccess, stagedFor, toLoadedDoc } from "../../client/editor/access";
import { pasteNote, planDocPaste, previewWrite, summarizePreview } from "../../client/editor/doc-preview";
import { flattenDoc, getAt, parseDraft, removeAt, setAt } from "../../client/editor/doc-tree";
import type { GridHost, StagedItem } from "../../client/state/types";

const doc: Json = { name: "main", retries: 3, nested: { token: "<masked>", url: "http://x" }, list: ["a", "<masked>"] };

describe("doc-tree", () => {
  it("flattens to leaves with maskedPaths notation", () => {
    expect(flattenDoc(doc).map((leaf) => leaf.path)).toEqual(["name", "retries", "nested.token", "nested.url", "list[0]", "list[1]"]);
    expect(flattenDoc({ a: {}, b: [] }).map((leaf) => leaf.path)).toEqual(["a", "b"]);
    expect(flattenDoc("x")).toEqual([{ path: "", segments: [], value: "x" }]);
  });

  it("gets, sets and removes without mutating", () => {
    const before = JSON.stringify(doc);
    expect(getAt(doc, ["nested", "url"])).toBe("http://x");
    expect(getAt(doc, ["nested", "nope"])).toBeUndefined();
    expect(getAt(doc, ["list", 1])).toBe(MASK_PLACEHOLDER);
    expect(getAt(doc, ["toString"])).toBeUndefined();
    expect(getAt(setAt(doc, ["nested", "url"], "y"), ["nested", "url"])).toBe("y");
    expect(setAt(doc, ["nope"], 1)).toEqual(doc);
    expect(removeAt(doc, ["nested", "token"])).toMatchObject({ nested: { url: "http://x" } });
    expect(removeAt(doc, ["nested", "token"])).not.toHaveProperty("nested.token");
    expect(getAt(removeAt(doc, ["list", 0]), ["list"])).toEqual([MASK_PLACEHOLDER]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("parses draft text", () => {
    expect(parseDraft('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseDraft("{a").ok).toBe(false);
  });
});

describe("previewWrite", () => {
  const current: Json = { name: "main", retries: 3, apiKey: MASK_PLACEHOLDER, gone: true, nested: { password: MASK_PLACEHOLDER } };
  const maskedPaths = ["apiKey", "nested.password"];

  it("lists changed, new, removed, kept and unchanged keys", () => {
    const preview = previewWrite({
      current,
      currentMaskedPaths: maskedPaths,
      draft: { name: "other", retries: 3, apiKey: MASK_PLACEHOLDER, fresh: 1, nested: { password: MASK_PLACEHOLDER } },
    });
    const kinds = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.kind]));
    expect(kinds).toEqual({ name: "changed", retries: "unchanged", apiKey: "kept", fresh: "added", "nested.password": "kept", gone: "removed" });
    expect(preview.changed).toBe(true);
    expect(preview.blocked).toBeNull();
    expect(summarizePreview(preview)).toBe("Writes 5 keys: 1 changed, 1 new, 1 removed, 2 masked kept as on the host");
  });

  it("is a no-op when only placeholders stay and nothing else differs", () => {
    const preview = previewWrite({ current, currentMaskedPaths: maskedPaths, draft: current });
    expect(preview.changed).toBe(false);
    expect(summarizePreview(preview)).toContain("2 masked kept");
  });

  it("never shows secret values, typed or stored", () => {
    const preview = previewWrite({
      current,
      currentMaskedPaths: maskedPaths,
      draft: { name: "main", retries: 3, apiKey: "sk-live-123", gone: true, nested: { password: "hunter2" }, authToken: "abc" },
    });
    const text = JSON.stringify(preview.entries);
    expect(text).not.toContain("sk-live-123");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain('"abc"');
    const kinds = Object.fromEntries(preview.entries.map((entry) => [entry.path, entry.kind]));
    expect(kinds).toMatchObject({ apiKey: "secretReplaced", "nested.password": "secretReplaced", authToken: "secretAdded" });
    expect(preview.changed).toBe(true);
  });

  it("flags a deleted secret", () => {
    const preview = previewWrite({ current, currentMaskedPaths: maskedPaths, draft: { name: "main", retries: 3, gone: true, nested: { password: MASK_PLACEHOLDER } } });
    expect(preview.entries.find((entry) => entry.path === "apiKey")).toMatchObject({ kind: "secretRemoved", before: MASK_PLACEHOLDER, after: null });
  });

  it("blocks a placeholder the host has no value for", () => {
    const preview = previewWrite({ current, currentMaskedPaths: maskedPaths, draft: { name: "main", token: MASK_PLACEHOLDER } });
    expect(preview.counts.unresolved).toBe(1);
    expect(preview.blocked).toContain("token");
  });

  it("treats a missing document as all new", () => {
    const preview = previewWrite({ current: null, currentMaskedPaths: [], draft: { a: 1, b: { c: "x" } } });
    expect(preview.entries.map((entry) => entry.kind)).toEqual(["added", "added"]);
    expect(preview.changed).toBe(true);
  });

  it("shortens long values", () => {
    const preview = previewWrite({ current: { a: "x" }, currentMaskedPaths: [], draft: { a: "y".repeat(200) } });
    expect(preview.entries[0].after?.length).toBeLessThan(80);
  });
});

describe("planDocPaste", () => {
  it("keeps placeholders the target stores and drops the ones it lacks", () => {
    const clip: Json = { name: "src", apiKey: MASK_PLACEHOLDER, extra: { secret: MASK_PLACEHOLDER, ok: 1 } };
    const target: Json = { name: "dst", apiKey: MASK_PLACEHOLDER };
    const plan = planDocPaste(clip, target);
    expect(plan.values).toEqual({ name: "src", apiKey: MASK_PLACEHOLDER, extra: { ok: 1 } });
    expect(plan.dropped).toEqual(["extra.secret"]);
    expect(plan.unresolved).toEqual([]);
    expect(pasteNote(plan, "L")).toContain("extra.secret");
    const preview = previewWrite({ current: target, currentMaskedPaths: ["apiKey"], draft: plan.values });
    expect(preview.blocked).toBeNull();
  });

  it("drops every placeholder when the target has no document", () => {
    const plan = planDocPaste({ a: MASK_PLACEHOLDER, b: 1 }, null);
    expect(plan.values).toEqual({ b: 1 });
    expect(plan.dropped).toEqual(["a"]);
  });

  it("cannot drop a list element: it stays and blocks the preview", () => {
    const plan = planDocPaste({ keys: ["a", MASK_PLACEHOLDER] }, { keys: ["z"] });
    expect(plan.values).toEqual({ keys: ["a", MASK_PLACEHOLDER] });
    expect(plan.unresolved).toEqual(["keys[1]"]);
    expect(pasteNote(plan, "L")).toContain("keys[1]");
    expect(previewWrite({ current: { keys: ["z"] }, currentMaskedPaths: [], draft: plan.values }).blocked).not.toBeNull();
  });

  it("has nothing to say for a clean paste", () => {
    expect(pasteNote(planDocPaste({ a: 1 }, { a: 2 }), "L")).toBe("");
  });
});

function host(overrides: { companion?: GridHostData["companion"]; plugins?: string[]; features?: string[]; id?: string } = {}): GridHost {
  const data: GridHostData = {
    rows: {},
    plugins: (overrides.plugins ?? ["keep-awake"]).map((id) => ({ id, name: id, version: "1", enabled: true, status: "running", source: { kind: "npm", installSource: null, ref: null, pinned: false } })),
    companion: overrides.companion ?? { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: true }, settingsDocuments: [] },
  };
  return {
    id: overrides.id ?? "L",
    registrationId: "reg-L",
    label: "Linux",
    link: "relay",
    isHub: false,
    result: { ok: true, snapshot: { serverId: "L", version: "0.13.2", protocolVersion: 1, prerelease: false, features: overrides.features ?? ["pluginSettings"] }, value: data },
  };
}

describe("editorAccess", () => {
  it("allows a host with companion, consent and the feature", () => {
    expect(editorAccess(host(), "keep-awake")).toEqual({ ok: true });
  });

  it("explains that consent is set on the host itself, with no toggle", () => {
    const access = editorAccess(host({ companion: { state: "ok", platform: "linux", arch: "x64", consent: { allowPluginSettingsWrites: false }, settingsDocuments: [] } }), "keep-awake");
    expect(access).toMatchObject({ ok: false, optIn: true });
    if (!access.ok) expect(access.reason).toContain("read-only");
  });

  it("names the companion state", () => {
    for (const state of ["missing", "disabled", "failed"] as const) {
      const access = editorAccess(host({ companion: { state } }), "keep-awake");
      expect(access).toMatchObject({ ok: false, optIn: false });
      if (!access.ok) expect(access.reason).toContain("multi-host-manager");
    }
  });

  it("keeps multi-host-manager's own documents read-only: the companion refuses remote writes to them", () => {
    expect(editorAccess(host({ plugins: ["paseo-multi-host-manager"] }), "paseo-multi-host-manager")).toMatchObject({ ok: false, optIn: false, reason: expect.stringContaining("read-only") });
  });

  it("refuses a missing plugin, missing feature, offline or unknown host", () => {
    expect(editorAccess(host(), "other")).toMatchObject({ ok: false });
    expect(editorAccess(host({ features: [] }), "keep-awake")).toMatchObject({ ok: false });
    expect(editorAccess(undefined, "keep-awake")).toMatchObject({ ok: false });
    const offline: GridHost = { ...host(), result: { ok: false, error: { code: "host_offline", message: "Host is offline" } } };
    expect(editorAccess(offline, "keep-awake")).toMatchObject({ ok: false });
  });
});

describe("toLoadedDoc", () => {
  const snapshot = { serverId: "L", version: "0.13.2", protocolVersion: 1, prerelease: false, features: [] };

  it("maps a read, a companion failure and a host failure", () => {
    const ok = toLoadedDoc({ ok: true, snapshot, value: { ok: true, revision: "r1", version: 2, values: { a: 1 }, maskedPaths: ["k"], hasBackup: true } });
    expect(ok).toEqual({ ok: true, doc: { revision: "r1", version: 2, values: { a: 1 }, maskedPaths: ["k"], hasBackup: true } });
    expect(toLoadedDoc({ ok: true, snapshot, value: { ok: false, code: "capability_disabled", message: "off" } })).toEqual({ ok: false, message: "off (capability_disabled)" });
    expect(toLoadedDoc({ ok: false, error: { code: "host_offline", message: "down" } })).toEqual({ ok: false, message: "down" });
  });
});

function entry(item: StagedItem["item"], status: StagedItem["status"], outcome: ApplyOutcome | null = null): StagedItem {
  return { item, status, outcome, requires: [], confirmed: [] };
}

const write = { id: "reg-L/doc:keep-awake/mode", host: "reg-L", op: "writeSettingsDoc", pluginId: "keep-awake", settingsId: "mode", expectedRevision: "r1", version: 1, values: {} } as const;

describe("stagedFor and docStatus", () => {
  it("finds the write or restore and the reload of this document's plugin", () => {
    const reload = { id: "reg-L/plugin:keep-awake:reload", host: "reg-L", op: "reloadPlugin", pluginId: "keep-awake" } as const;
    const otherDoc = { ...write, id: "x", settingsId: "other" };
    const staged = [entry(otherDoc, "pending"), entry(write, "pending"), entry(reload, "pending")];
    expect(stagedFor(staged, host(), "keep-awake", "mode")).toEqual({ doc: staged[1], reload: staged[2] });
    expect(stagedFor([], host(), "keep-awake", "mode")).toEqual({ doc: null, reload: null });
  });

  it("describes each phase", () => {
    expect(docStatus(null).phase).toBe("none");
    expect(docStatus(entry(write, "pending")).phase).toBe("staged");
    expect(docStatus(entry(write, "applying")).phase).toBe("applying");
    expect(docStatus(entry(write, "unknown")).phase).toBe("unknown");
    const written = docStatus(entry(write, "ok", { status: "ok", revision: "r2", validity: "unknown", reloadSuggested: true, keptMaskedPaths: ["k"], backedUp: true }));
    expect(written).toMatchObject({ phase: "written", validityUnknown: true, reloadSuggested: true, keptMaskedPaths: ["k"], backedUp: true });
    expect(written.message).toContain("validity unknown");
    expect(docStatus(entry({ ...write, op: "restoreSettingsDoc" } as never, "ok", { status: "ok", validity: "unknown" })).message).toContain("Restored");
    expect(docStatus(entry(write, "ignored", { status: "ignored", paths: ["a"] })).phase).toBe("ignored");
    expect(docStatus(entry(write, "skipped", { status: "skipped", dependsOn: "x" })).phase).toBe("skipped");
  });

  it("reports a conflict with the current revision", () => {
    const status = docStatus(entry(write, "failed", { status: "failed", error: { code: "host_error", message: "m", detail: "conflict" }, currentRevision: "r9" }));
    expect(status).toMatchObject({ phase: "conflict", currentRevision: "r9" });
  });

  it("explains other failures", () => {
    expect(docStatus(entry(write, "failed", { status: "failed", error: { code: "host_error", message: "m", detail: "invalid_input" } }))).toMatchObject({ phase: "failed" });
    expect(docStatus(entry(write, "failed", { status: "failed", error: { code: "host_error", message: "The host operation failed.", detail: "weird" } })).message).toBe("The host operation failed. (weird)");
  });
});
