import * as fs from "node:fs";
import * as path from "node:path";
import type { z } from "zod";
import {
  OWN_PLUGIN_ID,
  type CompanionFailure,
  type settingsListRpc,
  type settingsReadRpc,
  type settingsRestoreRpc,
  type settingsWriteRpc,
} from "../../shared/companion-contracts";
import { maskJson, restoreMasked, type Json } from "../../shared/mask";
import { atomicWrite, failure, readBytes, revisionOf, type CompanionContext } from "./files";

type Ok<Rpc extends { output: z.ZodType }> = Extract<z.output<Rpc["output"]>, { ok: true }>;
type DocumentRef = { pluginId: string; settingsId: string };

// Same pattern as the RPC contracts; repeated here so a caller that bypasses zod still cannot traverse.
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function settingsRoot(home: string): string {
  return path.join(home, "plugin-settings");
}

function locate(home: string, ref: DocumentRef): { file: string } | { error: CompanionFailure } {
  if (!SAFE_SEGMENT.test(ref.pluginId) || !SAFE_SEGMENT.test(ref.settingsId)) {
    return { error: failure("invalid_input", "Invalid pluginId or settingsId") };
  }
  const root = settingsRoot(home);
  const file = path.resolve(root, ref.pluginId, `${ref.settingsId}.json`);
  if (path.relative(root, file).startsWith("..")) return { error: failure("invalid_input", "Path escapes plugin-settings") };
  return { file };
}

function parseDocument(bytes: Buffer): { version: number; values: Json } | null {
  try {
    const parsed: Json = JSON.parse(bytes.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const { version, values } = parsed;
    return typeof version === "number" && values !== undefined ? { version, values } : null;
  } catch {
    return null;
  }
}

export function listSettings(ctx: CompanionContext): z.output<typeof settingsListRpc.output> {
  const root = settingsRoot(ctx.home);
  const documents: z.output<typeof settingsListRpc.output>["documents"] = [];
  if (!fs.existsSync(root)) return { documents };
  for (const plugin of fs.readdirSync(root, { withFileTypes: true })) {
    if (!plugin.isDirectory() || !SAFE_SEGMENT.test(plugin.name)) continue;
    for (const entry of fs.readdirSync(path.join(root, plugin.name), { withFileTypes: true })) {
      const settingsId = entry.name.endsWith(".json") ? entry.name.slice(0, -".json".length) : "";
      if (!entry.isFile() || !SAFE_SEGMENT.test(settingsId)) continue;
      const file = path.join(root, plugin.name, entry.name);
      documents.push({
        pluginId: plugin.name,
        settingsId,
        revision: revisionOf(readBytes(file)),
        hasBackup: fs.existsSync(`${file}.bak`),
      });
    }
  }
  return { documents };
}

export function readSettings(ctx: CompanionContext, ref: DocumentRef): Ok<typeof settingsReadRpc> | CompanionFailure {
  const located = locate(ctx.home, ref);
  if ("error" in located) return located.error;
  const bytes = readBytes(located.file);
  const hasBackup = fs.existsSync(`${located.file}.bak`);
  if (bytes === null) {
    return { ok: true, revision: revisionOf(null), version: null, values: null, maskedPaths: [], hasBackup };
  }
  const document = parseDocument(bytes);
  if (document === null) return failure("invalid_document", "Settings document is not {version, values}", revisionOf(bytes));
  const masked = maskJson(document.values);
  return {
    ok: true,
    revision: revisionOf(bytes),
    version: document.version,
    values: masked.value,
    maskedPaths: masked.maskedPaths,
    hasBackup,
  };
}

async function checkWriteAllowed(ctx: CompanionContext, pluginId: string): Promise<CompanionFailure | null> {
  if (!(await ctx.consent()).allowPluginSettingsWrites) {
    return failure("capability_disabled", "This host has not enabled plugin settings writes (allowPluginSettingsWrites).");
  }
  // Our own consent document must only be changed by the host's user, never through this RPC.
  if (pluginId === OWN_PLUGIN_ID) return failure("not_allowed", "The companion's own settings cannot be written remotely.");
  return null;
}

export async function writeSettings(
  ctx: CompanionContext,
  input: DocumentRef & { expectedRevision: string; version: number; values: Json },
): Promise<Ok<typeof settingsWriteRpc> | CompanionFailure> {
  const denied = await checkWriteAllowed(ctx, input.pluginId);
  if (denied) return denied;
  const located = locate(ctx.home, input);
  if ("error" in located) return located.error;

  // Re-read and compare immediately before writing; everything below is synchronous.
  const before = readBytes(located.file);
  const current = revisionOf(before);
  if (current !== input.expectedRevision) {
    return failure("conflict", "The settings document changed since it was read.", current);
  }
  const existing = before === null ? null : parseDocument(before);
  const restored = restoreMasked(input.values, existing?.values);
  if (restored.unresolvedPaths.length > 0) {
    return failure("invalid_input", `Masked placeholder without an existing value at: ${restored.unresolvedPaths.join(", ")}`);
  }
  const next = Buffer.from(`${JSON.stringify({ version: input.version, values: restored.value }, null, 2)}\n`, "utf8");
  if (before !== null) atomicWrite(`${located.file}.bak`, before);
  atomicWrite(located.file, next);
  return { ok: true, revision: revisionOf(next), keptMaskedPaths: restored.keptPaths, backedUp: before !== null };
}

/** Swaps the document with its `.bak`, so a restore can itself be undone by restoring again. */
export async function restoreSettings(
  ctx: CompanionContext,
  input: DocumentRef & { expectedRevision: string },
): Promise<Ok<typeof settingsRestoreRpc> | CompanionFailure> {
  const denied = await checkWriteAllowed(ctx, input.pluginId);
  if (denied) return denied;
  const located = locate(ctx.home, input);
  if ("error" in located) return located.error;

  const before = readBytes(located.file);
  const current = revisionOf(before);
  if (current !== input.expectedRevision) {
    return failure("conflict", "The settings document changed since it was read.", current);
  }
  const backup = readBytes(`${located.file}.bak`);
  if (backup === null) return failure("not_found", "No backup exists for this settings document.");
  atomicWrite(located.file, backup);
  if (before !== null) atomicWrite(`${located.file}.bak`, before);
  return { ok: true, revision: revisionOf(backup) };
}
