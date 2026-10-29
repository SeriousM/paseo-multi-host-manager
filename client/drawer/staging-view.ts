import type { ApplyItem, ApplyOutcome, HostFailure } from "../../shared/contracts";
import { ROW_BY_ID } from "../../shared/rows";
import type { Severity } from "../grid/palette";
import { formatValue, hostData } from "../state/grid-model";
import { itemOnHost } from "../state/staging";
import type { GridHost, StagedItem } from "../state/types";

const INVALID_ITEM_TEXT: Record<string, string> = {
  self_target: "multi-host-manager runs this view on the hub; it cannot be disabled or removed from here.",
  credentials_in_source: "The source has credentials in its URL. Use a source without them.",
  directory_source: "A local directory exists only on its own host. Use a registry id, an npm: or a git: source.",
  masked_value: "The value contains masked secrets and cannot be written.",
  wrong_value_type: "The value has the wrong type for this setting.",
  read_only_row: "This setting is read-only.",
  protected_row: "This setting is never read or written.",
  unknown_row: "The hub does not know this setting.",
};

const HOST_ERROR_TEXT: Record<string, string> = {
  conflict: "Changed on the host since it was read. Reload and retry.",
  not_allowed: "The host does not allow this change.",
  invalid_input: "The host rejected the values (a masked value has no stored value to keep).",
  invalid_document: "The stored settings document is not valid.",
  not_found: "Not found on the host.",
  update_preview_failed: "The host could not check for an update.",
  update_failed: "The host could not apply the update.",
};

const CAPABILITY_DISABLED_TEXT: Record<string, string> = {
  capability_disabled: "Settings writes are off on this host. Allow them in its multi-host-manager settings.",
  companion_disabled: "multi-host-manager is installed but not running on this host.",
};

/** Readable text for a failed item. `currentRevision` is set when a settings document write lost a race. */
export function failureText(error: HostFailure, currentRevision?: string): string {
  const detail = error.detail ?? "";
  switch (error.code) {
    case "unsupported_capability":
      if (detail === "companion_missing") return "multi-host-manager is not installed on this host.";
      return detail ? `This host's Paseo lacks ${detail}. Update Paseo on that host.` : error.message;
    case "capability_disabled":
      return CAPABILITY_DISABLED_TEXT[detail] ?? error.message;
    case "confirmation_required":
    case "lockout_confirmation_required":
      return "Needs your confirmation. Press Apply again to confirm.";
    case "invalid_item":
      return INVALID_ITEM_TEXT[detail] ?? (detail ? `${error.message} (${detail})` : error.message);
    case "host_error": {
      const text = HOST_ERROR_TEXT[detail] ?? (detail ? `${error.message} (${detail})` : error.message);
      return currentRevision ? `${text} Current revision: ${currentRevision}.` : text;
    }
    case "insecure_link":
      return "The link to this host is not known to be encrypted. Allow it in the host's capabilities.";
    default:
      return error.message;
  }
}

export interface ItemView {
  /** Short operation tag, like the mockup's `opk`: set, install, remove, enable, disable, update, check, settings, restore, reload. */
  kind: string;
  title: string;
  note: string | null;
}

export const PIN_TEXT = { pinned: "pinned", latest: "installs the latest release" } as const;

/** npm `<pkg>@<version>` and git with a `ref` reproduce a version; a registry id or a bare package name install the latest. */
export function installPin(source: string, ref: string | undefined): "pinned" | "latest" {
  if (source.startsWith("npm:")) return /^npm:(?:@[^/@:]+\/)?[^/@:]+@\d[^:]*(?::.*)?$/.test(source) ? "pinned" : "latest";
  if (source.startsWith("git:")) return ref ? "pinned" : "latest";
  return "latest";
}

function currentRow(host: GridHost | undefined, rowId: string) {
  const cell = hostData(host)?.rows[rowId];
  return cell?.state === "ok" ? cell : null;
}

/** What an item does, for lists. `host` supplies the current value of a setting for the "old -> new" preview. */
export function describeItem(item: ApplyItem, host: GridHost | undefined): ItemView {
  switch (item.op) {
    case "setRow": {
      const row = ROW_BY_ID[item.rowId];
      const current = currentRow(host, item.rowId);
      const next = formatValue(row, item.value);
      return { kind: "set", title: row?.label ?? item.rowId, note: current ? `${formatValue(row, current.value)} -> ${next}` : next };
    }
    case "installPlugin": {
      const ref = item.ref ? ` at ${item.ref.slice(0, 7)}` : "";
      return { kind: "install", title: item.pluginId ?? item.source, note: `from ${item.source}${ref}; ${PIN_TEXT[installPin(item.source, item.ref)]}` };
    }
    case "removePlugin":
      return { kind: "remove", title: item.pluginId, note: "deletes the plugin's files and settings" };
    case "setPluginEnabled":
      return { kind: item.enabled ? "enable" : "disable", title: item.pluginId, note: null };
    case "updatePlugin":
      return item.checkOnly ? { kind: "check", title: item.pluginId, note: "checks for an update, changes nothing" } : { kind: "update", title: item.pluginId, note: "to the newest release" };
    case "writeSettingsDoc":
      return { kind: "settings", title: `${item.pluginId}/${item.settingsId}`, note: item.expectedRevision === "missing" ? "create the settings document" : "replace the settings document" };
    case "restoreSettingsDoc":
      return { kind: "restore", title: `${item.pluginId}/${item.settingsId}`, note: "restore the backup of the settings document" };
    case "reloadPlugin":
      return { kind: "reload", title: item.pluginId, note: null };
  }
}

export interface StatusView {
  label: string;
  severity: Severity;
  /** Second line: the outcome in words, or what Apply will ask first. */
  detail: string | null;
}

const UPDATE_TEXT: Record<NonNullable<Extract<ApplyOutcome, { status: "ok" }>["updateOutcome"]>, string> = {
  update: "an update is available (nothing was changed)",
  updated: "updated",
  current: "already up to date",
  "installed-newer": "the installed version is newer than the release",
  local: "local plugin: it has no update source",
};

function okDetail(outcome: Extract<ApplyOutcome, { status: "ok" }>): string | null {
  const parts: string[] = [];
  if (outcome.unverified) parts.push("the host dropped the connection before the change could be re-read; reload the grid to see the real state");
  if (outcome.updateOutcome) parts.push(UPDATE_TEXT[outcome.updateOutcome] + (outcome.updateOutcome === "updated" && outcome.version ? ` to ${outcome.version}` : ""));
  else if (outcome.version) parts.push(`version ${outcome.version}`);
  if (outcome.pluginStatus && outcome.pluginStatus !== "running") parts.push(`plugin ${outcome.pluginStatus}`);
  if (outcome.keptMaskedPaths && outcome.keptMaskedPaths.length > 0) parts.push(`${outcome.keptMaskedPaths.length} masked value(s) kept the host's own`);
  if (outcome.backedUp) parts.push("backup made");
  if (outcome.validity === "unknown") parts.push("the plugin was not asked whether it accepts the values");
  if (outcome.reloadSuggested) parts.push("reload the plugin to use the new values");
  return parts.length > 0 ? parts.join("; ") : null;
}

const CONFIRMATION_TEXT = { trust: "trust", destructive: "removal", lockout: "lockout" } as const;

/** Label, severity and detail line of one staged item; `staged` resolves what a skipped item depended on. */
export function statusView(entry: StagedItem, staged: readonly StagedItem[], hosts: readonly GridHost[]): StatusView {
  const { outcome } = entry;
  switch (entry.status) {
    case "pending": {
      const open = entry.requires.filter((kind) => !entry.confirmed.includes(kind)).map((kind) => CONFIRMATION_TEXT[kind]);
      return { label: "staged", severity: "warn", detail: open.length > 0 ? `Apply asks for ${open.join(" and ")} confirmation first` : null };
    }
    case "applying":
      return { label: "applying...", severity: "accent", detail: null };
    case "ok": {
      const done = outcome?.status === "ok" ? outcome : null;
      return done?.unverified
        ? { label: "applied, not verified", severity: "warn", detail: okDetail(done) }
        : { label: "ok", severity: "ok", detail: done ? okDetail(done) : null };
    }
    case "unknown":
      return { label: "result lost", severity: "warn", detail: "The hub dropped the connection while applying. Reload the grid to see what changed." };
    case "ignored":
      return {
        label: "ignored",
        severity: "bad",
        detail: outcome?.status === "ignored" ? `The host did not apply: ${outcome.paths.join(", ")}` : "The host did not apply this change.",
      };
    case "skipped": {
      const dependency = outcome?.status === "skipped" ? staged.find((other) => other.item.id === outcome.dependsOn) : undefined;
      const host = dependency ? hosts.find((candidate) => itemOnHost(dependency.item.host, candidate)) : undefined;
      const view = dependency ? describeItem(dependency.item, host) : null;
      return { label: "skipped", severity: "bad", detail: view ? `Not run: ${view.kind} ${view.title} did not succeed first.` : "Not run: an earlier change on this host did not succeed." };
    }
    case "failed":
      return { label: "failed", severity: "bad", detail: outcome?.status === "failed" ? failureText(outcome.error, outcome.currentRevision) : "The change failed." };
  }
}

/**
 * Position within a host: the server runs `pluginsEnabled` and `relay` switched on first and switched off last
 * (`pen` off, then `relay` off at the very end); everything else keeps the staged order (server/rpc/apply.ts `rank`).
 */
export function applyRank(item: ApplyItem): number {
  if (item.op !== "setRow" || typeof item.value !== "boolean" || (item.rowId !== "pen" && item.rowId !== "relay")) return 1;
  if (item.value) return 0;
  return item.rowId === "pen" ? 2 : 3;
}

export interface DrawerItem {
  entry: StagedItem;
  /** 1-based place in the host's apply order. */
  position: number;
  view: ItemView;
  status: StatusView;
}

export interface DrawerGroup {
  hostId: string;
  label: string;
  items: DrawerItem[];
}

/** Staged items per host, hosts in grid order (hub first), items in the order the server applies them. */
export function groupStaged(staged: readonly StagedItem[], hosts: readonly GridHost[]): DrawerGroup[] {
  const groups: { hostId: string; host: GridHost | undefined; entries: StagedItem[] }[] = [];
  for (const entry of staged) {
    const host = hosts.find((candidate) => itemOnHost(entry.item.host, candidate));
    const hostId = host?.id ?? entry.item.host;
    const group = groups.find((candidate) => candidate.hostId === hostId);
    if (group) group.entries.push(entry);
    else groups.push({ hostId, host, entries: [entry] });
  }
  const order = (hostId: string) => {
    const index = hosts.findIndex((host) => host.id === hostId);
    return index < 0 ? hosts.length : index;
  };
  groups.sort((a, b) => order(a.hostId) - order(b.hostId));
  return groups.map(({ hostId, host, entries }) => ({
    hostId,
    label: host?.label ?? hostId,
    items: entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => applyRank(a.entry.item) - applyRank(b.entry.item) || a.index - b.index)
      .map(({ entry }, index) => ({ entry, position: index + 1, view: describeItem(entry.item, host), status: statusView(entry, staged, hosts) })),
  }));
}

export interface DrawerSummary {
  total: number;
  pending: number;
  ok: number;
  /** `failed` and `skipped`: what Retry is for. */
  failed: number;
  ignored: number;
  unknown: number;
  /** Items Apply would send. */
  outstanding: number;
  applyLabel: string;
}

export function summarize(staged: readonly StagedItem[], applying: boolean): DrawerSummary {
  const count = (...statuses: StagedItem["status"][]) => staged.filter((entry) => statuses.includes(entry.status)).length;
  const ok = count("ok");
  const pending = count("pending");
  const failed = count("failed", "skipped");
  const outstanding = staged.length - ok;
  const applyLabel = applying ? "Applying..." : pending === 0 && failed > 0 ? "Retry failed" : outstanding > 0 ? `Apply (${outstanding})` : "Apply";
  return { total: staged.length, pending, ok, failed, ignored: count("ignored"), unknown: count("unknown"), outstanding, applyLabel };
}
