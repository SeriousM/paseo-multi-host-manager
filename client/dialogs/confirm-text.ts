import type { ApplyItem } from "../../shared/contracts";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { ROW_BY_ID } from "../../shared/rows";
import { PIN_TEXT, installPin } from "../drawer/staging-view";
import { formatValue } from "../state/grid-model";
import { itemOnHost } from "../state/staging";
import type { GridHost, StagedItem } from "../state/types";

export interface ConfirmLine {
  itemId: string;
  host: string;
  title: string;
  detail: string;
  /** Installs only: the source reproduces a version, or takes the latest release. */
  pin: "pinned" | "latest" | null;
}

function hostLabel(item: ApplyItem, hosts: readonly GridHost[]): string {
  return hosts.find((host) => itemOnHost(item.host, host))?.label ?? item.host;
}

/** One line per install: the host, the plugin, and the source it is installed from. */
export function trustLines(entries: readonly StagedItem[], hosts: readonly GridHost[]): ConfirmLine[] {
  return entries.flatMap(({ item }) => {
    if (item.op !== "installPlugin") return [];
    const ref = item.ref ? ` at ${item.ref.slice(0, 7)}` : "";
    const pin = installPin(item.source, item.ref);
    return [{ itemId: item.id, host: hostLabel(item, hosts), title: item.pluginId ?? item.source, detail: `${item.source}${ref} (${PIN_TEXT[pin]})`, pin }];
  });
}

export function removalLines(entries: readonly StagedItem[], hosts: readonly GridHost[]): ConfirmLine[] {
  return entries.flatMap(({ item }) =>
    item.op === "removePlugin" ? [{ itemId: item.id, host: hostLabel(item, hosts), title: item.pluginId, detail: "plugin files and settings documents are deleted", pin: null }] : [],
  );
}

/**
 * Why a staged item can cut the hub off its host, in terms of what is lost. Mirrors `requiredConfirmations`
 * (relay off on the hub or over a relay link, plugins off anywhere, this plugin off on a remote).
 */
export function lockoutReason(item: ApplyItem, host: GridHost | undefined): string | null {
  if (item.op === "setRow" && item.rowId === "relay" && item.value === false) {
    return host?.isHub
      ? "Clients that reach the hub through its relay, such as the app on another network, lose it. This view may close."
      : "The hub reaches this host over its relay. With the relay off the hub loses the host and cannot switch it back on from here.";
  }
  if (item.op === "setRow" && item.rowId === "pen" && item.value === false) {
    return host?.isHub
      ? "Switching plugins off stops every plugin on the hub, including multi-host-manager. This view stops working until plugins are switched on again on the hub itself."
      : "Switching plugins off stops every plugin on this host, including multi-host-manager. The hub can no longer manage it from here until plugins are switched on again on the host itself.";
  }
  if ((item.op === "removePlugin" || (item.op === "setPluginEnabled" && !item.enabled)) && item.pluginId === OWN_PLUGIN_ID) {
    const verb = item.op === "removePlugin" ? "Removing" : "Disabling";
    return `${verb} multi-host-manager here ends settings documents and the config rows that need it on this host. It can be installed or enabled again from the hub while plugins are on.`;
  }
  return null;
}

/** The setting an item changes, in words, for the lockout list. */
export function lockoutTitle(item: ApplyItem): string {
  switch (item.op) {
    case "setRow":
      return `${ROW_BY_ID[item.rowId]?.label ?? item.rowId} -> ${formatValue(ROW_BY_ID[item.rowId], item.value)}`;
    case "removePlugin":
      return `Remove ${item.pluginId}`;
    case "setPluginEnabled":
      return `${item.enabled ? "Enable" : "Disable"} ${item.pluginId}`;
    default:
      return item.op;
  }
}

/** Lockout lines grouped by host: the hosts that can be cut off, with each cause. */
export function lockoutLines(entries: readonly StagedItem[], hosts: readonly GridHost[]): ConfirmLine[] {
  return entries.flatMap(({ item }) => {
    const host = hosts.find((candidate) => itemOnHost(item.host, candidate));
    const detail = lockoutReason(item, host);
    return detail ? [{ itemId: item.id, host: hostLabel(item, hosts), title: lockoutTitle(item), detail, pin: null }] : [];
  });
}
