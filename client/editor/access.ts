import type { z } from "zod";
import type { docReadRpc } from "../../shared/contracts";
import type { Json } from "../../shared/mask";
import { hostData } from "../state/grid-model";
import { itemOnHost } from "../state/staging";
import type { GridHost, StagedItem, WrittenDoc } from "../state/types";

export type EditorAccess =
  | { ok: true }
  /** `optIn`: the reason is the consent switch, which is set on the target host only. */
  | { ok: false; reason: string; optIn: boolean };

/** Where the opt-in lives; shown whenever consent is the reason. This view never offers a toggle for it. */
export const OPT_IN_EXPLANATION =
  "Writing plugin settings is opt-in per host. The switch (allowPluginSettingsWrites) is in the multi-host-manager settings on that host itself and cannot be changed from here; anyone authenticated to that host can set it.";

/** Whether the editor can read and write `pluginId`'s documents on `host`; otherwise why not. Mirrors the paste rules. */
export function editorAccess(host: GridHost | undefined, pluginId: string): EditorAccess {
  if (!host) return { ok: false, reason: "The host is no longer in the hub's list.", optIn: false };
  if (!host.result.ok) return { ok: false, reason: `${host.label} is not reachable: ${host.result.error.message}`, optIn: false };
  const data = hostData(host);
  if (!data) return { ok: false, reason: `${host.label} returned no data.`, optIn: false };
  if (!host.result.snapshot.features.includes("pluginSettings")) return { ok: false, reason: `${host.label} runs a Paseo version without plugin settings documents.`, optIn: false };
  if (!data.plugins.some((plugin) => plugin.id === pluginId)) return { ok: false, reason: `${pluginId} is not installed on ${host.label}.`, optIn: false };
  switch (data.companion.state) {
    case "missing":
      return { ok: false, reason: `multi-host-manager is not installed on ${host.label}; it reads and writes the documents there. Install it on that host first.`, optIn: false };
    case "disabled":
      return { ok: false, reason: `multi-host-manager is disabled on ${host.label} (or its plugins are switched off); enable it there first.`, optIn: false };
    case "failed":
      return { ok: false, reason: `multi-host-manager failed to start on ${host.label}.`, optIn: false };
    case "ok":
      return data.companion.consent.allowPluginSettingsWrites ? { ok: true } : { ok: false, reason: `Settings writes are off on ${host.label}. This editor is read-only there.`, optIn: true };
  }
}

export interface LoadedDoc {
  revision: string;
  /** Schema version of the stored document; null when the host has none. */
  version: number | null;
  /** The document with secrets masked; null when the host has none. */
  values: Json | null;
  maskedPaths: string[];
  hasBackup: boolean;
}

export type DocLoadResult = { ok: true; doc: LoadedDoc } | { ok: false; message: string };

/** Turns a `mhm.doc.read` answer into the editor's document or an error text. */
export function toLoadedDoc(result: z.output<typeof docReadRpc.output>): DocLoadResult {
  if (!result.ok) return { ok: false, message: result.error.message };
  const read = result.value;
  if (!read.ok) return { ok: false, message: `${read.message} (${read.code})` };
  return { ok: true, doc: { revision: read.revision, version: read.version, values: read.values, maskedPaths: read.maskedPaths, hasBackup: read.hasBackup } };
}

/** The staged write or restore of this document and the staged reload of the plugin, on `host`. */
export function stagedFor(staged: readonly StagedItem[], host: GridHost, pluginId: string, settingsId: string): { doc: StagedItem | null; reload: StagedItem | null } {
  const doc = staged.find(({ item }) => (item.op === "writeSettingsDoc" || item.op === "restoreSettingsDoc") && item.pluginId === pluginId && item.settingsId === settingsId && itemOnHost(item.host, host));
  const reload = staged.find(({ item }) => item.op === "reloadPlugin" && item.pluginId === pluginId && itemOnHost(item.host, host));
  return { doc: doc ?? null, reload: reload ?? null };
}

export type DocPhase = "none" | "staged" | "applying" | "written" | "conflict" | "failed" | "ignored" | "skipped" | "unknown";

export interface DocStatus {
  phase: DocPhase;
  message: string;
  /** Revision the host reports as current after a conflict. */
  currentRevision: string | null;
  /** Written or restored: the plugin was not asked whether it accepts the values. Stays shown for as long as the item is. */
  validityUnknown: boolean;
  reloadSuggested: boolean;
  /** Secret paths where the host kept its own value. */
  keptMaskedPaths: string[];
  backedUp: boolean;
}

const FAILURE_TEXT: Record<string, string> = {
  capability_disabled: "Settings writes are off on the host (opt-in on that host).",
  invalid_input: "The host rejected the document: a <masked> placeholder has no stored value there, or the values are malformed.",
  invalid_document: "The host rejected the document as invalid.",
  not_allowed: "The host does not allow this write.",
  not_found: "The host has no backup to restore.",
};

/** What to tell the user about the staged write or restore (`entry`); `none` when nothing is staged. */
export function docStatus(entry: StagedItem | null): DocStatus {
  const base: DocStatus = { phase: "none", message: "", currentRevision: null, validityUnknown: false, reloadSuggested: false, keptMaskedPaths: [], backedUp: false };
  if (!entry) return base;
  const verb = entry.item.op === "restoreSettingsDoc" ? "restore" : "write";
  const { outcome } = entry;
  if (entry.status === "pending") return { ...base, phase: "staged", message: `A ${verb} is staged. It is sent with Apply.` };
  if (entry.status === "applying") return { ...base, phase: "applying", message: `Applying the ${verb}...` };
  if (entry.status === "unknown" || !outcome) return { ...base, phase: "unknown", message: "The answer was lost. Reload the document to see what the host stores." };
  switch (outcome.status) {
    case "ok":
      return {
        ...base,
        phase: "written",
        message: `${verb === "restore" ? "Restored" : "Written"}, validity unknown: the plugin was not asked whether it accepts these values.`,
        validityUnknown: outcome.validity === "unknown",
        reloadSuggested: outcome.reloadSuggested === true,
        keptMaskedPaths: outcome.keptMaskedPaths ?? [],
        backedUp: outcome.backedUp === true,
      };
    case "failed": {
      const { error } = outcome;
      if (error.detail === "conflict") {
        return { ...base, phase: "conflict", currentRevision: outcome.currentRevision ?? null, message: "The document changed on the host after it was loaded. Nothing was written." };
      }
      const known = error.detail ? FAILURE_TEXT[error.detail] : undefined;
      return { ...base, phase: "failed", message: known ?? `${error.message}${error.detail ? ` (${error.detail})` : ""}` };
    }
    case "ignored":
      return { ...base, phase: "ignored", message: `The host ignored: ${outcome.paths.join(", ")}.` };
    case "skipped":
      return { ...base, phase: "skipped", message: "Skipped because an earlier item for this host did not succeed." };
  }
}

/** The marker of this document on `host` that outlives its staged item (see `WrittenDoc`), or null. */
export function writtenFor(written: readonly WrittenDoc[], host: GridHost, pluginId: string, settingsId: string): WrittenDoc | null {
  return written.find((doc) => doc.pluginId === pluginId && doc.settingsId === settingsId && itemOnHost(doc.host, host)) ?? null;
}

/** Status for a document written earlier in this session whose staged item is gone (cleared after Apply). */
export function writtenStatus(doc: WrittenDoc | null): DocStatus {
  const base = docStatus(null);
  if (!doc) return base;
  return {
    ...base,
    phase: "written",
    message: `${doc.op === "restoreSettingsDoc" ? "Restored" : "Written"} earlier in this session, validity unknown: the plugin was not asked whether it accepts these values.`,
    validityUnknown: true,
    reloadSuggested: true,
    keptMaskedPaths: doc.keptMaskedPaths,
    backedUp: doc.backedUp,
  };
}
