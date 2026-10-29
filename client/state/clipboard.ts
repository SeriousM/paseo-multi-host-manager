import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import type { Json } from "../../shared/mask";
import { ROW_BY_ID } from "../../shared/rows";
import { findHost, hostData, pluginRows, sameJson } from "./grid-model";
import { hostRef, itemOnHost } from "./staging";
import type { CellRef, ClipboardEntry, GridHost, MhmState, StageInput } from "./types";

/** Revision the companion reports for a settings document that does not exist yet (server/companion/files.ts). */
export const MISSING_REVISION = "missing";

/**
 * Clipboard entry for a row or plugin cell, or null when the cell has nothing to copy. Document cells are copied with
 * the values from `mhm.doc.read` (the `copyDoc` action), because the grid only has their metadata.
 */
export function clipFromCell(state: Pick<MhmState, "hosts">, ref: CellRef): ClipboardEntry | null {
  const host = findHost(state, ref.hostId);
  const data = hostData(host);
  if (!data) return null;
  if (ref.kind === "row") {
    const cell = data.rows[ref.rowId];
    if (ROW_BY_ID[ref.rowId]?.write !== "live" || cell?.state !== "ok") return null;
    return { kind: "row", rowId: ref.rowId, sourceHost: ref.hostId, value: cell.value };
  }
  if (ref.kind === "plugin") {
    const plugin = data.plugins.find((candidate) => candidate.id === ref.pluginId);
    return plugin ? { kind: "plugin", pluginId: ref.pluginId, sourceHost: ref.hostId, plugin } : null;
  }
  return null;
}

/**
 * Orders two plugin versions: -1 when `a` is older, 1 when newer, 0 when equal, null when they cannot be compared
 * (git or registry revisions, a missing version). Semver cores first; a pre-release sorts before its release.
 */
export function compareVersions(a: string | null, b: string | null): -1 | 0 | 1 | null {
  const parse = (version: string | null) => (version ? /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/.exec(version) : null);
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (left[4] === right[4]) return 0;
  if (left[4] === undefined) return 1;
  if (right[4] === undefined) return -1;
  return left[4].localeCompare(right[4], "en", { numeric: true }) < 0 ? -1 : 1;
}

/** Result of pasting the clipboard onto one host: the items to stage, or why not (`same`: nothing would change). */
export type PastePlan = { ok: true; inputs: StageInput[]; note: string } | { ok: false; same: boolean; reason: string };

function refuse(reason: string, same = false): PastePlan {
  return { ok: false, same, reason };
}

export function hasFeature(host: GridHost, feature: string): boolean {
  return host.result.ok && host.result.snapshot.features.includes(feature);
}

/** `pluginsEnabled` on the host, with a staged change taking precedence. */
export function pluginsOn(state: Pick<MhmState, "staged">, host: GridHost): boolean {
  const staged = state.staged.find(({ item }) => item.op === "setRow" && item.rowId === "pen" && itemOnHost(item.host, host));
  if (staged?.item.op === "setRow") return staged.item.value === true;
  return hostData(host)?.rows.pen?.value !== false;
}

function pasteRow(clip: Extract<ClipboardEntry, { kind: "row" }>, target: GridHost): PastePlan {
  const row = ROW_BY_ID[clip.rowId];
  if (!row || row.write !== "live") return refuse("read-only");
  if (row.feature && !hasFeature(target, row.feature)) return refuse(`host lacks ${row.feature}`);
  // Providers keep the target's own value behind a masked key; any other masked value cannot be written.
  if (row.id !== "prov" && JSON.stringify(clip.value).includes(MASK_PLACEHOLDER)) return refuse("contains masked secrets");
  const current = hostData(target)?.rows[clip.rowId];
  if (current?.state === "ok" && sameJson(current.value, clip.value)) return refuse("identical", true);
  let note = "applied live";
  if (row.id === "prov") {
    // The server only updates providers the target already has (server/rows/patch.ts `existingProvidersOnly`).
    const ids = (value: Json) => (value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : []);
    const pasted = ids(clip.value);
    // null: the target's providers cannot be read, so only the server can tell which exist.
    const existing = current?.state === "ok" ? ids(current.value) : current === undefined || current.state === "absent" ? [] : null;
    const missing = existing === null ? [] : pasted.filter((id) => !existing.includes(id));
    if (pasted.length > 0 && missing.length === pasted.length) return refuse("none of these providers exist on this host; providers are only updated, not created, from here");
    note = missing.length > 0 ? `updates the providers the host already has; not created here: ${missing.join(", ")}` : "updates providers the host already has; new ones are ignored";
  }
  return { ok: true, inputs: [{ op: "setRow", host: hostRef(target), rowId: clip.rowId, value: clip.value }], note };
}

function pastePlugin(state: Pick<MhmState, "hosts" | "staged">, clip: Extract<ClipboardEntry, { kind: "plugin" }>, target: GridHost): PastePlan {
  const current = hostData(target)?.plugins.find((plugin) => plugin.id === clip.pluginId);
  const host = hostRef(target);
  if (!current) {
    // The copied host's own source reproduces its version (`pinned`); another host's source is the fallback when the
    // copied one cannot be handed on (a directory install there).
    const portable = clip.plugin.source.installSource !== null ? clip.plugin.source : (pluginRows(state.hosts).find((row) => row.id === clip.pluginId)?.source ?? null);
    const source = portable?.installSource ?? null;
    if (portable === null || source === null) return refuse("local directory source: exists only on its own host");
    if (!hasFeature(target, "pluginSourceInstallation")) return refuse("host lacks pluginSourceInstallation");
    if (!pluginsOn(state, target)) return refuse('plugins are switched off on this host (stage "Plugins enabled" first)');
    const ref = portable.ref ?? undefined;
    const input: StageInput = ref === undefined ? { op: "installPlugin", host, source, pluginId: clip.pluginId } : { op: "installPlugin", host, source, ref, pluginId: clip.pluginId };
    const pin = portable.pinned ? `pinned${ref ? ` at ${ref.slice(0, 7)}` : ""}` : "installs the latest release";
    return { ok: true, inputs: [input], note: `install from ${source}; ${pin}` };
  }
  const inputs: StageInput[] = [];
  const notes: string[] = [];
  const order = compareVersions(current.version, clip.plugin.version);
  // An update installs the newest release, never an older one: a target ahead of the source is left alone.
  if (order === 1) return refuse("target is newer");
  if (current.version !== clip.plugin.version && current.source.kind !== "directory" && hasFeature(target, "pluginSourceUpdates")) {
    inputs.push({ op: "updatePlugin", host, pluginId: clip.pluginId });
    notes.push(order === -1 ? `update from ${current.version ?? "?"} to the newest release` : "update to the newest release (revisions cannot be compared)");
  }
  const selfOff = target.isHub && clip.pluginId === OWN_PLUGIN_ID && !clip.plugin.enabled;
  if (current.enabled !== clip.plugin.enabled && !selfOff) {
    inputs.push({ op: "setPluginEnabled", host, pluginId: clip.pluginId, enabled: clip.plugin.enabled });
    notes.push(clip.plugin.enabled ? "enable" : "disable");
  }
  return inputs.length > 0 ? { ok: true, inputs, note: notes.join("; ") } : refuse("identical", true);
}

function pasteDoc(clip: Extract<ClipboardEntry, { kind: "doc" }>, target: GridHost): PastePlan {
  const data = hostData(target);
  if (!data?.plugins.some((plugin) => plugin.id === clip.pluginId)) return refuse("plugin not installed on this host");
  if (clip.pluginId.toLowerCase() === OWN_PLUGIN_ID) return refuse("multi-host-manager's own settings are changed on each host itself");
  if (data.companion.state !== "ok") return refuse("needs multi-host-manager running on this host");
  if (!data.companion.consent.allowPluginSettingsWrites) return refuse("settings writes are off on this host (opt-in in its multi-host-manager settings)");
  if (!hasFeature(target, "pluginSettings")) return refuse("host lacks pluginSettings");
  const existing = data.companion.settingsDocuments.find((doc) => doc.pluginId === clip.pluginId && doc.settingsId === clip.settingsId);
  const input: StageInput = {
    op: "writeSettingsDoc",
    host: hostRef(target),
    pluginId: clip.pluginId,
    settingsId: clip.settingsId,
    expectedRevision: existing?.revision ?? MISSING_REVISION,
    version: clip.version,
    values: clip.values,
  };
  const kept = clip.maskedPaths.length > 0 ? `; ${clip.maskedPaths.length} masked value(s) keep this host's own` : "";
  return { ok: true, inputs: [input], note: `${existing ? "replace" : "create"} settings document${kept}` };
}

/** What pasting the clipboard onto `targetHostId` would stage. Same row/plugin/document only; the grid has no cross-row paste. */
export function planPaste(state: Pick<MhmState, "hosts" | "staged">, clip: ClipboardEntry, targetHostId: string): PastePlan {
  const target = findHost(state, targetHostId);
  if (!target) return refuse("unknown host");
  if (!target.result.ok) return refuse(target.result.error.message);
  if (clip.sourceHost === targetHostId) return refuse("source", true);
  switch (clip.kind) {
    case "row":
      return pasteRow(clip, target);
    case "plugin":
      return pastePlugin(state, clip, target);
    case "doc":
      return pasteDoc(clip, target);
  }
}

/** Items for "paste to several hosts": every selected target the clipboard can be pasted onto. */
export function pasteTargetsInputs(state: Pick<MhmState, "hosts" | "staged" | "clipboard" | "pasteTargets">): StageInput[] {
  const clip = state.clipboard;
  if (!clip) return [];
  return state.pasteTargets.flatMap((hostId) => {
    const plan = planPaste(state, clip, hostId);
    return plan.ok ? plan.inputs : [];
  });
}
