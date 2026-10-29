import type { ApplyItem, ApplyResult, BrokerPolicy } from "../../shared/contracts";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import type { Confirmation, DialogRequest, GridHost, StagedItem, StagedStatus, StageInput } from "./types";

/**
 * How staged items name their host. Saved hosts by registration id: a host's `id` flips from the registration id to
 * the server id once the hub reached it, the registration id never changes. The hub has none and keeps its id.
 */
export function hostRef(host: GridHost): string {
  return host.registrationId ?? host.id;
}

export function itemOnHost(itemHost: string, host: GridHost): boolean {
  return itemHost === host.id || itemHost === host.registrationId;
}

/**
 * The part of a host an item changes. Staging a second item for the same host and slot replaces the first:
 * install and remove of one plugin share a slot, so do the write and the restore of one settings document (same slot).
 */
export function slotOf(item: StageInput): string {
  switch (item.op) {
    case "setRow":
      return `row:${item.rowId}`;
    case "installPlugin":
      return `plugin:${item.pluginId ?? item.source}:presence`;
    case "removePlugin":
      return `plugin:${item.pluginId}:presence`;
    case "setPluginEnabled":
      return `plugin:${item.pluginId}:enabled`;
    case "updatePlugin":
      return `plugin:${item.pluginId}:version`;
    case "reloadPlugin":
      return `plugin:${item.pluginId}:reload`;
    case "writeSettingsDoc":
    case "restoreSettingsDoc":
      return `doc:${item.pluginId}/${item.settingsId}`;
  }
}

/** Disabling or removing this plugin on the hub takes this view down with it; the server rejects it as `self_target`. */
export function stageRefusal(item: StageInput, host: GridHost | undefined): string | null {
  if (!host) return "Host is no longer in the hub's list";
  const ownOff = (item.op === "removePlugin" || (item.op === "setPluginEnabled" && !item.enabled)) && item.pluginId === OWN_PLUGIN_ID;
  return ownOff && host.isHub ? "This plugin runs this view on the hub; it cannot be disabled or removed from here" : null;
}

/** Confirmations the item needs before Apply; see `Confirmation`. */
export function requiredConfirmations(item: StageInput, host: GridHost): Confirmation[] {
  const needs: Confirmation[] = [];
  if (item.op === "installPlugin") needs.push("trust");
  if (item.op === "removePlugin") needs.push("destructive");
  const relayOff = item.op === "setRow" && item.rowId === "relay" && item.value === false && (host.isHub || host.link === "relay");
  const pluginsOff = item.op === "setRow" && item.rowId === "pen" && item.value === false;
  const ownOff = (item.op === "removePlugin" || (item.op === "setPluginEnabled" && !item.enabled)) && item.pluginId === OWN_PLUGIN_ID;
  if (relayOff || pluginsOff || ownOff) needs.push("lockout");
  return needs;
}

/**
 * Adds items to the queue. An item for a host and slot that is already staged replaces it in place (and loses its
 * confirmations and outcome). Items the hosts refuse (`stageRefusal`) are dropped; the caller shows the reason.
 */
export function stageItems(staged: readonly StagedItem[], hosts: readonly GridHost[], inputs: readonly StageInput[]): StagedItem[] {
  const next = [...staged];
  for (const input of inputs) {
    const host = hosts.find((candidate) => itemOnHost(input.host, candidate));
    if (!host || stageRefusal(input, host)) continue;
    const id = `${hostRef(host)}/${slotOf(input)}`;
    // `input` is one member of the union; adding `id` and the canonical host keeps it that member.
    const item = { ...input, id, host: hostRef(host) } as ApplyItem;
    const entry: StagedItem = { item, status: "pending", outcome: null, requires: requiredConfirmations(input, host), confirmed: [] };
    const index = next.findIndex((existing) => existing.item.id === id);
    if (index >= 0) next[index] = entry;
    else next.push(entry);
  }
  return next;
}

export function confirmItems(staged: readonly StagedItem[], ids: readonly string[], kind: Confirmation): StagedItem[] {
  return staged.map((entry) =>
    ids.includes(entry.item.id) && entry.requires.includes(kind) && !entry.confirmed.includes(kind) ? { ...entry, confirmed: [...entry.confirmed, kind] } : entry,
  );
}

/**
 * Statuses Apply sends: not applied yet, or failed and skipped (Retry). An `ignored` item would be ignored again and an
 * `unknown` one may have been applied: both wait for a reload, or for the user to remove them.
 */
export const SENDABLE: readonly StagedStatus[] = ["pending", "failed", "skipped"];

const CONFIRMATION_ORDER: readonly Confirmation[] = ["lockout", "destructive", "trust"];

/** The dialog Apply has to show first, or null when every outstanding item has its confirmations. Lockout comes first. */
export function nextConfirmation(staged: readonly StagedItem[]): DialogRequest | null {
  for (const kind of CONFIRMATION_ORDER) {
    const itemIds = staged
      .filter((entry) => SENDABLE.includes(entry.status) && entry.requires.includes(kind) && !entry.confirmed.includes(kind))
      .map((entry) => entry.item.id);
    if (itemIds.length > 0) return { kind, itemIds };
  }
  return null;
}

/**
 * Input for `mhm.apply`: the sendable items in staged order (the server orders within a host). `confirmed` is set
 * on items whose confirmations were all given; an item without them is rejected by the server.
 */
export function applyInput(staged: readonly StagedItem[], policy: BrokerPolicy): BrokerPolicy & { items: ApplyItem[] } {
  const items = staged.filter((entry) => SENDABLE.includes(entry.status)).map((entry) => {
    const done = entry.requires.length > 0 && entry.requires.every((kind) => entry.confirmed.includes(kind));
    return done ? { ...entry.item, confirmed: true } : entry.item;
  });
  return { ...policy, items };
}

export function markApplying(staged: readonly StagedItem[]): StagedItem[] {
  return staged.map((entry) => (SENDABLE.includes(entry.status) ? { ...entry, status: "applying" } : entry));
}

const OUTCOME_STATUS: Record<ApplyResult["outcome"]["status"], StagedStatus> = { ok: "ok", ignored: "ignored", failed: "failed", skipped: "skipped" };

/** Merges `mhm.apply` results by item id. Items the response does not mention keep their status. */
export function withResults(staged: readonly StagedItem[], results: readonly ApplyResult[]): StagedItem[] {
  return staged.map((entry) => {
    const result = results.find((candidate) => candidate.id === entry.item.id);
    return result ? { ...entry, status: OUTCOME_STATUS[result.outcome.status], outcome: result.outcome } : entry;
  });
}

/**
 * The `mhm.apply` call itself failed. When the batch switched relay or plugins off on the hub, a lost response is the
 * expected result (the hub dropped this plugin or its link): items become `unknown` and a grid reload tells. Otherwise
 * the applying items fail with the transport message.
 */
export function withApplyError(staged: readonly StagedItem[], hosts: readonly GridHost[], message: string): StagedItem[] {
  const hub = hosts.find((host) => host.isHub);
  const hubLockout = staged.some((entry) => entry.status === "applying" && entry.requires.includes("lockout") && hub !== undefined && itemOnHost(entry.item.host, hub));
  return staged.map((entry): StagedItem => {
    if (entry.status !== "applying") return entry;
    if (hubLockout) return { ...entry, status: "unknown", outcome: null };
    return { ...entry, status: "failed", outcome: { status: "failed", error: { code: "host_error", message } } };
  });
}
