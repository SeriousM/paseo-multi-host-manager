import type { CompanionState, GridHostData, GridPlugin, HostFailure, PluginSource } from "../../shared/contracts";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import type { Json } from "../../shared/mask";
import { ROW_BY_ID, ROWS } from "../../shared/rows";
import type { RowDef } from "../../shared/rows";
import { failureText } from "./failure-text";
import { itemOnHost } from "./staging";
import type { CellRef, ClipboardEntry, GridHost, MhmState, StagedItem } from "./types";

/** Oldest Paseo the hub serves (server/broker/capabilities.ts MINIMUM_VERSION). */
export const MINIMUM_PASEO = "0.13.0";
/** Newest stable Paseo this plugin was tested against; newer stable hosts get an "untested" tag. */
export const TESTED_VERSION = "0.13.2";

/** Hub first; the others keep the hub directory's order. */
export function orderHosts(hosts: readonly GridHost[]): GridHost[] {
  return [...hosts.filter((host) => host.isHub), ...hosts.filter((host) => !host.isHub)];
}

export function hostData(host: GridHost | undefined): GridHostData | null {
  return host?.result.ok ? host.result.value : null;
}

export function findHost(state: Pick<MhmState, "hosts">, hostId: string): GridHost | undefined {
  return state.hosts.find((host) => host.id === hostId);
}

function versionCore(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function coreAbove(version: string, reference: string): boolean {
  const actual = versionCore(version);
  const base = versionCore(reference);
  if (!actual || !base) return false;
  for (let i = 0; i < 3; i++) if (actual[i] !== base[i]) return actual[i] > base[i];
  return false;
}

export interface HostSummary {
  id: string;
  label: string;
  isHub: boolean;
  link: GridHost["link"];
  /** The hub reached the host and passed every gate. */
  reachable: boolean;
  version: string | null;
  /** `prerelease`, `untested` (newer stable than TESTED_VERSION) or null. */
  versionTag: "prerelease" | "untested" | null;
  failure: HostFailure | null;
  companion: CompanionState["state"] | null;
  platform: string | null;
  /** The hub reaches the host only over the relay, or it is the hub itself: switching relay or plugins off cuts this view off. */
  accessSensitive: boolean;
}

export function hostSummary(host: GridHost): HostSummary {
  const snapshot = host.result.ok ? host.result.snapshot : (host.result.snapshot ?? null);
  const version = snapshot?.version ?? null;
  const data = hostData(host);
  return {
    id: host.id,
    label: host.label,
    isHub: host.isHub,
    link: host.link,
    reachable: host.result.ok,
    version,
    versionTag: snapshot?.prerelease ? "prerelease" : version && coreAbove(version, TESTED_VERSION) ? "untested" : null,
    failure: host.result.ok ? null : host.result.error,
    companion: data?.companion.state ?? null,
    platform: data?.companion.state === "ok" ? data.companion.platform : null,
    accessSensitive: host.isHub || host.link === "relay",
  };
}

export interface PluginRow {
  id: string;
  name: string | null;
  /** A portable source from any host that has one; null when no host can hand it on (directory installs). */
  source: PluginSource | null;
  /** Per host id: the installed plugin, absent when the host does not have it or could not be read. */
  hosts: Record<string, GridPlugin | undefined>;
}

/** One row per plugin id found on any host; this plugin first, then by id. */
export function pluginRows(hosts: readonly GridHost[]): PluginRow[] {
  const rows: Record<string, PluginRow> = {};
  for (const host of hosts) {
    for (const plugin of hostData(host)?.plugins ?? []) {
      const row = (rows[plugin.id] ??= { id: plugin.id, name: null, source: null, hosts: {} });
      row.name ??= plugin.name;
      if (plugin.source.installSource !== null && row.source?.installSource == null) row.source = plugin.source;
      row.source ??= plugin.source;
      row.hosts[host.id] = plugin;
    }
  }
  return Object.values(rows).sort((a, b) => (a.id === OWN_PLUGIN_ID ? -1 : b.id === OWN_PLUGIN_ID ? 1 : a.id.localeCompare(b.id)));
}

export function sameJson(a: Json | undefined, b: Json | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Short text for a row value. Providers show their count; other JSON is shortened. */
export function formatValue(row: RowDef | undefined, value: Json): string {
  if (value === MASK_PLACEHOLDER) return "masked";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === null) return "-";
  if (typeof value === "string") return value === "" ? "(empty)" : value;
  if (typeof value === "number") return String(value);
  if (row?.id === "prov" && !Array.isArray(value)) {
    const count = Object.keys(value).length;
    return count === 0 ? "none" : `${count} defined`;
  }
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Version text: `v1.2.3`, a git or registry revision as its short commit, `dir` for directory plugins. */
export function formatPlugin(plugin: GridPlugin): string {
  if (!plugin.version) return plugin.source.kind === "directory" ? "dir" : "installed";
  return /^[0-9a-f]{12,40}$/i.test(plugin.version) ? plugin.version.slice(0, 7) : `v${plugin.version}`;
}

/** Why a cell has no value: a host failure code, or the row's own state on a reachable host. */
export interface Unavailable {
  code: string;
  message: string;
}

const ROW_STATE_REASONS: Record<string, string> = {
  absent: "Not set on this host",
  needs_companion: "Needs multi-host-manager running on this host",
  unreadable: "The host's config.json could not be read",
  protected: "Never read or copied",
};

/** `attention`: nothing staged, but something the user should follow up (a written settings document of unknown validity). */
export type CellTone = "plain" | "source" | "differs" | "staged" | "applying" | "applied" | "failed" | "attention";

export interface CellView {
  ref: CellRef;
  /** Main line: the value, or the staged preview "old -> new". */
  text: string;
  /** Second line: plugin status, staged note, apply outcome or the reason it is unavailable. */
  detail: string | null;
  /** The value contains masked secrets; a paste of it is refused. */
  masked: boolean;
  readOnly: boolean;
  unavailable: Unavailable | null;
  staged: StagedItem | null;
  /** Same row as the clipboard on another host, with a different value. */
  differsFromSource: boolean;
  isSource: boolean;
  selected: boolean;
  /** Copy is offered: reachable host, a value, and a row that can be written somewhere. */
  copyable: boolean;
  tone: CellTone;
}

function sameRef(a: CellRef | null, b: CellRef): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

const STATUS_TONE: Record<StagedItem["status"], CellTone> = {
  pending: "staged",
  applying: "applying",
  ok: "applied",
  ignored: "failed",
  failed: "failed",
  skipped: "failed",
  unknown: "staged",
};

export function outcomeText(staged: StagedItem): string {
  const outcome = staged.outcome;
  switch (staged.status) {
    case "pending":
      return staged.requires.includes("lockout") ? "staged - can cut the hub off this host" : "staged";
    case "applying":
      return "applying...";
    case "ok": {
      if (outcome?.status !== "ok") return "applied";
      if (outcome.ignoredPaths && outcome.ignoredPaths.length > 0) return `applied; ignored: ${outcome.ignoredPaths.join(", ")}`;
      return outcome.unverified === true ? "applied, not verified - reload" : "applied";
    }
    case "unknown":
      return "result lost - reload to see the real state";
    case "ignored":
      return outcome?.status === "ignored" ? `ignored by the host: ${outcome.paths.join(", ")}` : "ignored by the host";
    case "skipped":
      return "skipped: an earlier change on this host failed";
    case "failed":
      return outcome?.status === "failed" ? failureText(outcome.error, outcome.currentRevision) : "failed";
  }
}

function tone(staged: StagedItem | null, isSource: boolean, differs: boolean): CellTone {
  if (staged) return STATUS_TONE[staged.status];
  if (isSource) return "source";
  return differs ? "differs" : "plain";
}

/** The staged item that changes this cell, if any. */
export function stagedFor(state: Pick<MhmState, "staged" | "hosts">, ref: CellRef): StagedItem | null {
  const host = findHost(state, ref.hostId);
  return (
    state.staged.find(({ item }) => {
      if (!host || !itemOnHost(item.host, host)) return false;
      if (ref.kind === "row") return item.op === "setRow" && item.rowId === ref.rowId;
      if (ref.kind === "doc") return (item.op === "writeSettingsDoc" || item.op === "restoreSettingsDoc") && item.pluginId === ref.pluginId && item.settingsId === ref.settingsId;
      return item.op !== "setRow" && item.op !== "writeSettingsDoc" && item.op !== "restoreSettingsDoc" && item.pluginId === ref.pluginId;
    }) ?? null
  );
}

function clipboardRef(clip: ClipboardEntry): CellRef {
  switch (clip.kind) {
    case "row":
      return { kind: "row", rowId: clip.rowId, hostId: clip.sourceHost };
    case "plugin":
      return { kind: "plugin", pluginId: clip.pluginId, hostId: clip.sourceHost };
    case "doc":
      return { kind: "doc", pluginId: clip.pluginId, settingsId: clip.settingsId, hostId: clip.sourceHost };
  }
}

function hostUnavailable(host: GridHost | undefined): Unavailable | null {
  if (!host) return { code: "unknown_host", message: "Host is no longer in the hub's list" };
  return host.result.ok ? null : { code: host.result.error.code, message: host.result.error.message };
}

/** "old -> new" while the change is outstanding; once applied the reloaded grid already shows the new value. */
function stagedRowText(staged: StagedItem, current: string, row: RowDef | undefined): string {
  return staged.item.op === "setRow" && staged.status !== "ok" ? `${current} -> ${formatValue(row, staged.item.value)}` : current;
}

export function rowCellView(state: MhmState, rowId: string, hostId: string): CellView {
  const ref: CellRef = { kind: "row", rowId, hostId };
  const row = ROW_BY_ID[rowId];
  const host = findHost(state, hostId);
  const staged = stagedFor(state, ref);
  const isSource = state.clipboard !== null && sameRef(clipboardRef(state.clipboard), ref);
  const selected = sameRef(state.selection, ref);
  const readOnly = row?.write !== "live";
  const blocked = hostUnavailable(host);
  const cell = hostData(host)?.rows[rowId];
  const base = { ref, readOnly, staged, isSource, selected };
  if (blocked || !cell || cell.state !== "ok") {
    const unavailable = blocked ?? { code: cell?.state ?? "absent", message: ROW_STATE_REASONS[cell?.state ?? "absent"] ?? "No value" };
    const text = !blocked && cell?.state === "protected" ? "never shown" : "-";
    // A blocked host says why once, in its header; its cells stay quiet.
    const detail = staged ? outcomeText(staged) : blocked ? null : unavailable.message;
    return { ...base, text: staged ? stagedRowText(staged, text, row) : text, detail, masked: false, unavailable, differsFromSource: false, copyable: false, tone: tone(staged, false, false) };
  }
  const clip = state.clipboard;
  const differs = clip?.kind === "row" && clip.rowId === rowId && clip.sourceHost !== hostId && !sameJson(clip.value, cell.value);
  const masked = cell.maskedPaths.length > 0;
  const text = formatValue(row, cell.value);
  // Providers paste with their masked keys: the target keeps its own value at each of them.
  const maskedNote = rowId === "prov" ? "secrets masked; each host keeps its own" : "contains masked secrets";
  return {
    ...base,
    text: staged ? stagedRowText(staged, text, row) : text,
    detail: staged ? outcomeText(staged) : masked ? maskedNote : null,
    masked,
    unavailable: null,
    differsFromSource: differs,
    copyable: !readOnly && (!masked || rowId === "prov"),
    tone: tone(staged, isSource, differs),
  };
}

const STAGED_PLUGIN_TEXT: Record<string, (item: StagedItem["item"], current: GridPlugin | undefined) => string> = {
  installPlugin: () => "install",
  removePlugin: (_item, current) => `${current ? formatPlugin(current) : "plugin"} -> remove`,
  setPluginEnabled: (item) => (item.op === "setPluginEnabled" && item.enabled ? "enable" : "disable"),
  updatePlugin: (_item, current) => `${current ? formatPlugin(current) : "plugin"} -> update`,
  reloadPlugin: () => "reload",
};

export function pluginCellView(state: MhmState, row: PluginRow, hostId: string): CellView {
  const ref: CellRef = { kind: "plugin", pluginId: row.id, hostId };
  const host = findHost(state, hostId);
  const staged = stagedFor(state, ref);
  const isSource = state.clipboard !== null && sameRef(clipboardRef(state.clipboard), ref);
  const selected = sameRef(state.selection, ref);
  const blocked = hostUnavailable(host);
  const current = row.hosts[hostId];
  const base = { ref, readOnly: false, staged, isSource, selected, masked: false };
  const stagedText = staged ? (STAGED_PLUGIN_TEXT[staged.item.op]?.(staged.item, current) ?? "staged") : null;
  if (blocked) {
    return { ...base, text: stagedText ?? "-", detail: staged ? outcomeText(staged) : null, unavailable: blocked, differsFromSource: false, copyable: false, tone: tone(staged, false, false) };
  }
  const clip = state.clipboard;
  const differs =
    clip?.kind === "plugin" && clip.pluginId === row.id && clip.sourceHost !== hostId && (!current || current.version !== clip.plugin.version || current.enabled !== clip.plugin.enabled);
  const status = current ? `${current.status} - ${current.source.kind}` : null;
  const written = host ? state.writtenDocs.filter((doc) => doc.pluginId === row.id && itemOnHost(doc.host, host)) : [];
  // A check result holds while the host still reports the version it had at the check.
  const update = host && current ? state.updateChecks.some((check) => check.pluginId === row.id && itemOnHost(check.host, host) && check.version === current.version) : false;
  const notes = [
    ...(update ? ["update available"] : []),
    ...(written.length > 0 ? [`settings written (${written.map((doc) => doc.settingsId).join(", ")}), validity unknown - reload the plugin`] : []),
  ];
  const attention = !staged && notes.length > 0 ? notes.join("; ") : null;
  return {
    ...base,
    text: stagedText ?? (current ? formatPlugin(current) : "not installed"),
    detail: staged ? outcomeText(staged) : (attention ?? status),
    unavailable: null,
    differsFromSource: differs,
    copyable: current !== undefined,
    tone: attention && !isSource ? "attention" : tone(staged, isSource, differs),
  };
}

/** Settings rows in grid order: host info first, then daemon settings, then protected rows. */
export const SETTINGS_ROWS: readonly RowDef[] = ROWS;
