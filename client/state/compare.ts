import type { GridPlugin } from "../../shared/contracts";
import { MASK_PLACEHOLDER } from "../../shared/mask";
import type { Json } from "../../shared/mask";
import { ROW_BY_ID } from "../../shared/rows";
import { clipFromCell, compareVersions, planPaste } from "./clipboard";
import { hostData, pluginCellView, pluginRows, rowCellView, SETTINGS_ROWS } from "./grid-model";
import type { CellTone, CellView, PluginRow } from "./grid-model";
import { itemOnHost } from "./staging";
import type { CellRef, GridHost, MhmState, StageInput } from "./types";

/**
 * How a cell relates to the baseline host's cell in the same row.
 * - `baseline`: the cell is on the baseline host.
 * - `same` / `differs`: both sides have a value (or both lack it).
 * - `missing`: the baseline has the setting or plugin, this host does not.
 * - `not_comparable`: either host is blocked, or a side cannot be read (companion missing, needs a newer Paseo,
 *   unreadable, never read).
 */
export type CompareState = "baseline" | "same" | "differs" | "missing" | "not_comparable";

export interface CompareView {
  state: CompareState;
  /** Readable line for the cell: what differs, or why it cannot be compared; null for a plain `same`. */
  note: string | null;
  /** A fact about the host (version, OS) or a host-specific row (listen address, saved connection, worktree root): compared and shown, never counted. */
  informational: boolean;
}

type CompareInput = Pick<MhmState, "hosts" | "staged" | "baseline">;

/** The baseline host, resolved by its reference (registration id, or the hub's id). */
export function baselineHost(state: Pick<MhmState, "hosts" | "baseline">): GridHost | undefined {
  const ref = state.baseline;
  return ref === null ? undefined : state.hosts.find((host) => itemOnHost(ref, host));
}

/** Pending or applying items change what a host will have after Apply: compare that, not what it has now. */
function wouldBe<Item extends StageInput>(state: Pick<MhmState, "staged">, host: GridHost, match: (item: StageInput) => item is Item): Item | null {
  for (const { item, status } of state.staged) {
    if ((status === "pending" || status === "applying") && itemOnHost(item.host, host) && match(item)) return item;
  }
  return null;
}

type RowSide = { kind: "value"; value: Json } | { kind: "absent" } | { kind: "unreadable"; reason: string };

const UNREADABLE: Record<string, string> = {
  needs_companion: "needs multi-host-manager",
  needs_newer_paseo: "needs a newer Paseo",
  unreadable: "config.json unreadable",
  protected: "never read",
};

function rowSide(state: Pick<MhmState, "staged">, host: GridHost, rowId: string): RowSide {
  const staged = wouldBe(state, host, (item): item is Extract<StageInput, { op: "setRow" }> => item.op === "setRow" && item.rowId === rowId);
  if (staged) return { kind: "value", value: staged.value };
  const cell = hostData(host)?.rows[rowId];
  if (!cell || cell.state === "absent") return { kind: "absent" };
  if (cell.state !== "ok") return { kind: "unreadable", reason: UNREADABLE[cell.state] ?? cell.state };
  return { kind: "value", value: cell.value };
}

/**
 * Deep equality that never compares secrets: wherever either side holds the masked placeholder, that leaf is skipped
 * and reported. Keys present on one side only are a difference (that a key exists is not a secret).
 */
export function compareMasked(a: Json, b: Json): { equal: boolean; secretsSkipped: boolean } {
  let secretsSkipped = false;
  const walk = (left: Json, right: Json): boolean => {
    if (left === MASK_PLACEHOLDER || right === MASK_PLACEHOLDER) {
      secretsSkipped = true;
      return true;
    }
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
      return left.every((item, index) => walk(item, right[index]));
    }
    if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      return [...keys].every((key) => key in left && key in right && walk(left[key], right[key]));
    }
    return left === right;
  };
  const equal = walk(a, b);
  return { equal, secretsSkipped };
}

function blockedReason(host: GridHost, baseline: GridHost): string | null {
  if (!baseline.result.ok) return "baseline host is blocked";
  return host.result.ok ? null : "host is blocked";
}

/** Compare state of a settings row on `hostId` against the baseline; null when no baseline is set. */
export function compareRow(state: CompareInput, rowId: string, hostId: string): CompareView | null {
  const baseline = baselineHost(state);
  const host = state.hosts.find((candidate) => candidate.id === hostId);
  if (!baseline || !host) return null;
  // Facts about the host rather than settings (version, OS) and host-specific rows inform; they are not differences.
  const def = ROW_BY_ID[rowId];
  const informational = def?.hostSpecific === true || def?.source === "server_info" || def?.source === "companion.info";
  if (host === baseline) return { state: "baseline", note: null, informational };
  const blocked = blockedReason(host, baseline);
  if (blocked) return { state: "not_comparable", note: blocked, informational };
  const mine = rowSide(state, host, rowId);
  const theirs = rowSide(state, baseline, rowId);
  if (mine.kind === "unreadable" || theirs.kind === "unreadable") {
    const reason = mine.kind === "unreadable" ? mine.reason : theirs.kind === "unreadable" ? `baseline ${theirs.reason}` : "";
    return { state: "not_comparable", note: `not compared: ${reason}`, informational };
  }
  if (mine.kind === "absent" && theirs.kind === "absent") return { state: "same", note: null, informational };
  if (mine.kind === "absent") return { state: "missing", note: "not set here, set on baseline", informational };
  if (theirs.kind === "absent") return { state: "differs", note: "not set on baseline", informational };
  const { equal, secretsSkipped } = compareMasked(mine.value, theirs.value);
  if (!equal) return { state: "differs", note: "differs from baseline", informational };
  return { state: "same", note: secretsSkipped ? "same as baseline; secrets not compared" : null, informational };
}

/** The plugin as it will be after the staged items run: installs and updates have an unknown version until then. */
function pluginSide(state: Pick<MhmState, "staged">, host: GridHost, row: PluginRow): { version: string | null; enabled: boolean } | null {
  const ofPlugin = (item: StageInput) => "pluginId" in item && item.pluginId === row.id;
  const presence = wouldBe(state, host, (item): item is Extract<StageInput, { op: "installPlugin" | "removePlugin" }> => (item.op === "installPlugin" || item.op === "removePlugin") && ofPlugin(item));
  if (presence?.op === "removePlugin") return null;
  const current: GridPlugin | undefined = row.hosts[host.id];
  if (!current && presence?.op !== "installPlugin") return null;
  const toggle = wouldBe(state, host, (item): item is Extract<StageInput, { op: "setPluginEnabled" }> => item.op === "setPluginEnabled" && ofPlugin(item));
  const update = wouldBe(state, host, (item): item is Extract<StageInput, { op: "updatePlugin" }> => item.op === "updatePlugin" && !item.checkOnly && ofPlugin(item));
  return { version: current && !update ? current.version : null, enabled: toggle ? toggle.enabled : (current?.enabled ?? true) };
}

/** Compare state of a plugin on `hostId` against the baseline: installed or not, version, enabled. */
export function comparePlugin(state: CompareInput, row: PluginRow, hostId: string): CompareView | null {
  const baseline = baselineHost(state);
  const host = state.hosts.find((candidate) => candidate.id === hostId);
  if (!baseline || !host) return null;
  if (host === baseline) return { state: "baseline", note: null, informational: false };
  const blocked = blockedReason(host, baseline);
  if (blocked) return { state: "not_comparable", note: blocked, informational: false };
  const mine = pluginSide(state, host, row);
  const theirs = pluginSide(state, baseline, row);
  if (!mine && !theirs) return { state: "same", note: null, informational: false };
  if (!mine) return { state: "missing", note: "missing; installed on baseline", informational: false };
  if (!theirs) return { state: "differs", note: "not on baseline", informational: false };
  const notes: string[] = [];
  if (mine.version !== null && theirs.version !== null && mine.version !== theirs.version) {
    const order = compareVersions(mine.version, theirs.version);
    notes.push(order === -1 ? `older than baseline (${theirs.version})` : order === 1 ? `newer than baseline (${theirs.version})` : "other revision than baseline");
  }
  if (mine.enabled !== theirs.enabled) notes.push(mine.enabled ? "enabled, disabled on baseline" : "disabled, enabled on baseline");
  return notes.length > 0 ? { state: "differs", note: notes.join("; "), informational: false } : { state: "same", note: null, informational: false };
}

/** Differs or missing, on a row that counts (host-specific rows only inform). */
export function isCountedDifference(view: CompareView | null): boolean {
  return view !== null && !view.informational && (view.state === "differs" || view.state === "missing");
}

/** Settings rows and plugins on `hostId` that differ from the baseline (host-specific rows are not counted). */
export function differenceCount(state: CompareInput, hostId: string): number {
  const rows = SETTINGS_ROWS.filter((row) => isCountedDifference(compareRow(state, row.id, hostId))).length;
  const plugins = pluginRows(state.hosts).filter((row) => isCountedDifference(comparePlugin(state, row, hostId))).length;
  return rows + plugins;
}

/**
 * "Only differences": keep a row when some host differs from the baseline on it, or has a staged change in it (a change
 * copied from the baseline makes the cell equal, and it must not vanish before Apply). Without a baseline every row stays.
 */
export function rowHasDifferences(state: CompareInput, compare: (hostId: string) => CompareView | null, staged: (hostId: string) => boolean = () => false): boolean {
  if (!baselineHost(state)) return true;
  return state.hosts.some((host) => isCountedDifference(compare(host.id)) || staged(host.id));
}

export interface BaselinePlan {
  inputs: StageInput[];
  /** Differences that cannot be staged from here, with the reason (read-only row, directory plugin, target is newer...). */
  refusals: { label: string; reason: string }[];
}

/** One differing cell copied from the baseline: the existing paste path, so every paste rule and confirmation applies. */
export function copyFromBaseline(state: Pick<MhmState, "hosts" | "staged" | "baseline">, ref: CellRef) {
  const baseline = baselineHost(state);
  if (!baseline || ref.kind === "doc") return null;
  const clip = clipFromCell(state, { ...ref, hostId: baseline.id });
  if (!clip) return { ok: false as const, same: false, reason: ref.kind === "row" ? "read-only or no value on the baseline" : "not on the baseline; remove it with Remove... if it should go" };
  return planPaste(state, clip, ref.hostId);
}

/** Everything on `hostId` that differs from the baseline and can be staged through the paste rules, plus what cannot. */
export function planBaselineSync(state: Pick<MhmState, "hosts" | "staged" | "baseline">, hostId: string): BaselinePlan {
  const plan: BaselinePlan = { inputs: [], refusals: [] };
  const take = (label: string, ref: CellRef) => {
    const result = copyFromBaseline(state, ref);
    if (result?.ok) plan.inputs.push(...result.inputs);
    else if (result && !result.same) plan.refusals.push({ label, reason: result.reason });
  };
  for (const row of SETTINGS_ROWS) if (isCountedDifference(compareRow(state, row.id, hostId))) take(row.label, { kind: "row", rowId: row.id, hostId });
  for (const row of pluginRows(state.hosts)) if (isCountedDifference(comparePlugin(state, row, hostId))) take(row.id, { kind: "plugin", pluginId: row.id, hostId });
  return plan;
}

const COMPARE_TONE: Record<CompareState, CellTone> = { baseline: "baseline", same: "plain", differs: "differs", missing: "differs", not_comparable: "plain" };

/**
 * Lays the baseline comparison over a cell. With a baseline it replaces the clipboard's source/differs highlight;
 * staged cells keep their staged tone and add how the would-be value compares. Blocked hosts stay quiet.
 */
export function withCompare(view: CellView, compare: CompareView | null): CellView {
  if (!compare) return view;
  const base = { ...view, compare, isSource: false, differsFromSource: false };
  if (view.staged) {
    const against = compare.state === "same" ? "same as baseline" : compare.state === "baseline" ? null : compare.note;
    return { ...base, detail: [view.detail, against].filter((part) => part).join(" - ") || null };
  }
  if (view.unavailable && compare.state === "not_comparable") return { ...base, tone: view.tone };
  const informational = compare.informational && (compare.state === "differs" || compare.state === "missing");
  const detail = compare.state === "baseline" ? view.detail : compare.state === "same" ? (compare.note ?? view.detail) : `${compare.note ?? ""}${informational ? " (for information)" : ""}`;
  return { ...base, tone: informational ? "plain" : COMPARE_TONE[compare.state], detail };
}

export function compareRowCell(state: MhmState, rowId: string, hostId: string): CellView {
  return withCompare(rowCellView(state, rowId, hostId), compareRow(state, rowId, hostId));
}

export function comparePluginCell(state: MhmState, row: PluginRow, hostId: string): CellView {
  return withCompare(pluginCellView(state, row, hostId), comparePlugin(state, row, hostId));
}
