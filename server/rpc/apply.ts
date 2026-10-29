import type { ApplyItem, ApplyOutcome, ApplyResult, BrokerPolicy, HostFailure } from "../../shared/contracts";
import { OWN_PLUGIN_ID, settingsRestoreRpc, settingsWriteRpc } from "../../shared/companion-contracts";
import type { CompanionFailure } from "../../shared/companion-contracts";
import { callHost } from "../broker/call";
import { callCompanion } from "../broker/companion-call";
import { patchConfigVerified } from "../broker/config-patch";
import type { DaemonClient, MutableDaemonConfigPatch, PluginListItem } from "../broker/daemon-client";
import { failureFromError, hostFailure } from "../broker/failures";
import { withHostList } from "../broker/host-list";
import type { HostEntry } from "../broker/hosts";
import type { OriginSession } from "../broker/origin-session";
import { ROW_BY_ID } from "../../shared/rows";
import { gridPlugin } from "../rows/plugins";
import { rowPatch } from "../rows/patch";

/** Per host, all of its items together; an install may run a package manager on the host. */
export const APPLY_TIMEOUT_MS = 180_000;

/** Same shape the protocol uses to tell a local path from a managed source. A directory exists only on the host that has it. */
const DIRECTORY_SOURCE = /^(\.\.?(?:[/\\]|$)|\/|~|[A-Za-z]:[/\\]|\\\\)/;

interface Planned {
  item: ApplyItem;
  /** Set when the item is rejected before any host is contacted. */
  rejected: ApplyOutcome | null;
  patch?: MutableDaemonConfigPatch;
}

function failed(error: HostFailure, currentRevision?: string): ApplyOutcome {
  return currentRevision === undefined ? { status: "failed", error } : { status: "failed", error, currentRevision };
}

function plan(item: ApplyItem): Planned {
  if ((item.op === "installPlugin" || item.op === "removePlugin") && item.confirmed !== true) {
    return { item, rejected: failed(hostFailure("confirmation_required")) };
  }
  if (item.op === "installPlugin" && DIRECTORY_SOURCE.test(item.source)) {
    return { item, rejected: failed(hostFailure("invalid_item", "directory_source")) };
  }
  if (item.op === "setRow") {
    const built = rowPatch(item.rowId, item.value);
    return "patch" in built ? { item, rejected: null, patch: built.patch } : { item, rejected: failed(hostFailure("invalid_item", built.invalid)) };
  }
  return { item, rejected: null };
}

/**
 * Execution order within a host: `pluginsEnabled` and `relay` first when they are switched on (plugin calls and the
 * relay need them), last when switched off (switching `pluginsEnabled` off takes our own plugin, and the relay
 * connection the call may run on, down). Everything else keeps its staged order.
 */
function rank(item: ApplyItem): number {
  const switchRow = item.op === "setRow" && (item.rowId === "pen" || item.rowId === "relay") && typeof item.value === "boolean";
  if (!switchRow) return 1;
  return item.value ? 0 : 2;
}

/**
 * Dependency rule: `later` is skipped when an earlier item of the same host did not succeed and either both name the same
 * plugin id (installs name it through the optional `pluginId`), or the earlier one switches `pluginsEnabled` on and `later` is any plugin operation.
 * Nothing else is linked: unrelated items still run after a failure.
 */
function dependsOn(later: ApplyItem, earlier: ApplyItem): boolean {
  const laterPlugin = "pluginId" in later ? later.pluginId : undefined;
  if (laterPlugin !== undefined && laterPlugin === ("pluginId" in earlier ? earlier.pluginId : undefined)) return true;
  return later.op !== "setRow" && earlier.op === "setRow" && earlier.rowId === "pen" && earlier.value === true;
}

function requiredFeatures(item: ApplyItem): string[] {
  switch (item.op) {
    case "setRow":
      return [ROW_BY_ID[item.rowId]?.feature ?? []].flat();
    case "installPlugin":
      return ["pluginManagement", "pluginSourceInstallation"];
    case "updatePlugin":
      return ["pluginManagement", "pluginSourceUpdates"];
    case "writeSettingsDoc":
    case "restoreSettingsDoc":
      return ["pluginSettings"];
    default:
      return ["pluginManagement"];
  }
}

type OkOutcome = Extract<ApplyOutcome, { status: "ok" }>;

function pluginOutcome(plugin: PluginListItem): OkOutcome {
  return { status: "ok", pluginId: plugin.id, version: gridPlugin(plugin).version, pluginStatus: plugin.status };
}

/** Our plugin must be running on the host before a document RPC; a clear reason beats a transport error. */
async function companionBlocker(client: DaemonClient): Promise<HostFailure | null> {
  const own = (await client.listPlugins()).find((plugin) => plugin.id === OWN_PLUGIN_ID);
  if (!own) return hostFailure("unsupported_capability", "companion_missing");
  return own.enabled && own.status === "running" ? null : hostFailure("capability_disabled", "companion_disabled");
}

/** The plugin was not asked whether it accepts the values: validity stays unknown until a reload shows it. */
function documentOutcome(revision: string): OkOutcome {
  return { status: "ok", revision, validity: "unknown", reloadSuggested: true };
}

function companionFailure(result: CompanionFailure): ApplyOutcome {
  const code = result.code === "capability_disabled" ? "capability_disabled" : "host_error";
  return failed(hostFailure(code, result.code), result.currentRevision);
}

async function updatePlugin(client: DaemonClient, pluginId: string, checkOnly: boolean | undefined): Promise<ApplyOutcome> {
  const [preview] = await client.previewPluginUpdates({ pluginId });
  if (!preview || preview.outcome === "error") return failed(hostFailure("host_error", "update_preview_failed"));
  if (preview.outcome !== "update") return { status: "ok", pluginId, updateOutcome: preview.outcome };
  if (checkOnly) return { status: "ok", pluginId, updateOutcome: "update" };
  if (!preview.proposal) return failed(hostFailure("host_error", "update_preview_failed"));
  const [result] = await client.applyPluginUpdates([preview.proposal]);
  if (result?.outcome !== "updated") return failed(hostFailure("host_error", "update_failed"));
  const base: OkOutcome = result.plugin ? pluginOutcome(result.plugin) : { status: "ok", pluginId };
  return { ...base, updateOutcome: "updated" };
}

async function runOperation(client: DaemonClient, planned: Planned): Promise<ApplyOutcome> {
  const { item } = planned;
  switch (item.op) {
    case "setRow": {
      // A patch that ends the connection (relay off) may fail the verifying re-read; `mhm.grid.load` shows the real state.
      const verified = await patchConfigVerified(client, planned.patch ?? {});
      return verified.ignored.length > 0 ? { status: "ignored", paths: verified.ignored } : { status: "ok" };
    }
    case "installPlugin":
      return pluginOutcome(await client.installPluginSource({ source: item.source, ref: item.ref }));
    case "removePlugin":
      await client.removePlugin(item.pluginId);
      return { status: "ok", pluginId: item.pluginId };
    case "setPluginEnabled":
      return pluginOutcome(await (item.enabled ? client.enablePlugin(item.pluginId) : client.disablePlugin(item.pluginId)));
    case "reloadPlugin":
      return pluginOutcome(await client.reloadPlugin(item.pluginId));
    case "updatePlugin":
      return updatePlugin(client, item.pluginId, item.checkOnly);
    case "writeSettingsDoc": {
      const blocker = await companionBlocker(client);
      if (blocker) return failed(blocker);
      const written = await callCompanion(client, settingsWriteRpc, {
        pluginId: item.pluginId,
        settingsId: item.settingsId,
        expectedRevision: item.expectedRevision,
        version: item.version,
        values: item.values,
      });
      if (!written.ok) return companionFailure(written);
      return { ...documentOutcome(written.revision), keptMaskedPaths: written.keptMaskedPaths, backedUp: written.backedUp };
    }
    case "restoreSettingsDoc": {
      const blocker = await companionBlocker(client);
      if (blocker) return failed(blocker);
      const restored = await callCompanion(client, settingsRestoreRpc, { pluginId: item.pluginId, settingsId: item.settingsId, expectedRevision: item.expectedRevision });
      return restored.ok ? documentOutcome(restored.revision) : companionFailure(restored);
    }
  }
}

async function runItem(client: DaemonClient, features: readonly string[], planned: Planned): Promise<ApplyOutcome> {
  const missing = requiredFeatures(planned.item).find((feature) => !features.includes(feature));
  if (missing) return failed(hostFailure("unsupported_capability", missing));
  try {
    return await runOperation(client, planned);
  } catch (error) {
    return failed(failureFromError(error, "host_error"));
  }
}

/**
 * Applies one host's items in rank order over one connection. Slots are filled as items finish, so that a timeout or a
 * lost connection keeps what already happened and marks only the rest.
 */
async function applyHost(client: DaemonClient, host: HostEntry, policy: BrokerPolicy, timeoutMs: number, group: { index: number; planned: Planned }[], slots: (ApplyOutcome | undefined)[]) {
  const order = [...group].sort((a, b) => rank(a.planned.item) - rank(b.planned.item));
  const settle = (index: number, outcome: ApplyOutcome) => void (slots[index] ??= outcome);
  for (const entry of order) if (entry.planned.rejected) settle(entry.index, entry.planned.rejected);
  if (order.every((entry) => entry.planned.rejected)) return;

  let stopped = false;
  const result = await callHost(client, host, {
    policy,
    requiredFeatures: [],
    timeoutMs,
    run: async (hostClient, snapshot) => {
      for (const [position, entry] of order.entries()) {
        if (stopped) return;
        if (slots[entry.index]) continue;
        const blocker = order.slice(0, position).find((earlier) => slots[earlier.index]?.status !== "ok" && dependsOn(entry.planned.item, earlier.planned.item));
        settle(entry.index, blocker ? { status: "skipped", dependsOn: blocker.planned.item.id } : await runItem(hostClient, snapshot.features, entry.planned));
      }
    },
  });
  stopped = true;
  if (!result.ok) for (const entry of order) settle(entry.index, failed(result.error));
}

/**
 * Applies staged items; results come in the order of `items`. Remote hosts run in parallel, each host's items one after the
 * other in the order given by `rank`. The hub's own items run after all remote hosts finished, because switching plugins
 * off on the hub stops this plugin. A host failure marks that host's remaining items and never touches other hosts.
 * Items that need confirmation but lack it, and items that are malformed, are rejected without contacting a host.
 */
export function applyItems(origin: OriginSession, home: string, policy: BrokerPolicy, items: ApplyItem[], timeoutMs = APPLY_TIMEOUT_MS): Promise<ApplyResult[]> {
  const slots: (ApplyOutcome | undefined)[] = items.map(() => undefined);
  const entries = items.map((item, index) => ({ index, planned: plan(item) }));
  const results = (): ApplyResult[] =>
    items.map((item, index) => ({ id: item.id, host: item.host, op: item.op, outcome: slots[index] ?? failed(hostFailure("host_error")) }));

  return withHostList(
    origin,
    home,
    policy,
    async (client, hosts) => {
      const known = hosts.filter((host) => entries.some((entry) => entry.planned.item.host === host.id));
      for (const entry of entries) {
        if (!hosts.some((host) => host.id === entry.planned.item.host)) slots[entry.index] = failed(hostFailure("host_error", "unknown_host"));
      }
      const apply = (host: HostEntry) =>
        applyHost(client, host, policy, timeoutMs, entries.filter((entry) => entry.planned.item.host === host.id), slots);
      await Promise.all(known.filter((host) => !host.isHub).map(apply));
      await Promise.all(known.filter((host) => host.isHub).map(apply));
      return results();
    },
    (_hubId, failure) => {
      for (const entry of entries) slots[entry.index] = failed(failure.error);
      return results();
    },
  );
}
