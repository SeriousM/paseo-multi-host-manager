import type { ApplyItem, ApplyOutcome, ApplyResult, BrokerPolicy, HostFailure } from "../../shared/contracts";
import { OWN_PLUGIN_ID, settingsRestoreRpc, settingsWriteRpc } from "../../shared/companion-contracts";
import type { CompanionFailure } from "../../shared/companion-contracts";
import { callHost } from "../broker/call";
import { callCompanion, companionBlocker } from "../broker/companion-call";
import { patchConfigVerified } from "../broker/config-patch";
import type { DaemonClient, MutableDaemonConfigPatch, PluginListItem } from "../broker/daemon-client";
import { failureFromError, hostFailure } from "../broker/failures";
import { withHostList } from "../broker/host-list";
import { isHost } from "../broker/hosts";
import type { HostEntry } from "../broker/hosts";
import type { OriginSession } from "../broker/origin-session";
import { hasUrlCredentials } from "../../shared/mask";
import { ROW_BY_ID } from "../../shared/rows";
import { gridPlugin } from "../rows/plugins";
import { existingProvidersOnly, rowPatch } from "../rows/patch";

/** Per host, all of its items together, plus APPLY_PACKAGE_TIMEOUT_MS per install or update item. */
export const APPLY_BASE_TIMEOUT_MS = 60_000;
/** An install or update may run a package manager on the host. */
export const APPLY_PACKAGE_TIMEOUT_MS = 60_000;

/** Same shape the protocol uses to tell a local path from a managed source. A directory exists only on the host that has it. */
const DIRECTORY_SOURCE = /^(\.\.?(?:[/\\]|$)|\/|~|[A-Za-z]:[/\\]|\\\\)/;

interface Planned {
  item: ApplyItem;
  /** Set when the item is rejected before any host is contacted. */
  rejected: ApplyOutcome | null;
  patch?: MutableDaemonConfigPatch;
  /** Relay off on a host the hub reaches over a relay link: the item ends its own connection. */
  dropsLink?: boolean;
}

function failed(error: HostFailure, currentRevision?: string): ApplyOutcome {
  return currentRevision === undefined ? { status: "failed", error } : { status: "failed", error, currentRevision };
}

/** Checks that need no daemon call: validity, self-targeting and the confirmation rule of `applyItemSchema`. */
function plan(item: ApplyItem, host: HostEntry): Planned {
  const reject = (error: HostFailure): Planned => ({ item, rejected: failed(error) });
  const ownPluginDown = (item.op === "removePlugin" || (item.op === "setPluginEnabled" && !item.enabled)) && item.pluginId === OWN_PLUGIN_ID;
  // The hub's own copy runs this very apply and serves the UI; there is no way back from the grid.
  if (ownPluginDown && host.isHub) return reject(hostFailure("invalid_item", "self_target"));
  if (item.op === "installPlugin" && DIRECTORY_SOURCE.test(item.source)) return reject(hostFailure("invalid_item", "directory_source"));
  if (item.op === "installPlugin" && hasUrlCredentials(item.source)) return reject(hostFailure("invalid_item", "credentials_in_source"));
  let patch: MutableDaemonConfigPatch | undefined;
  if (item.op === "setRow") {
    const built = rowPatch(item.rowId, item.value);
    if ("invalid" in built) return reject(hostFailure("invalid_item", built.invalid));
    patch = built.patch;
  }
  const dropsLink = item.op === "setRow" && item.rowId === "relay" && item.value === false && host.link === "relay";
  const cutsOff = ownPluginDown || dropsLink || (item.op === "setRow" && item.rowId === "pen" && item.value === false);
  if (cutsOff && item.confirmed !== true) return reject(hostFailure("lockout_confirmation_required"));
  if ((item.op === "installPlugin" || item.op === "removePlugin") && item.confirmed !== true) return reject(hostFailure("confirmation_required"));
  return { item, rejected: null, patch, dropsLink };
}

/**
 * Execution order within a host: `pluginsEnabled` and `relay` first when they are switched on (plugin calls and the
 * relay need them), last when switched off: `pluginsEnabled` off takes our own plugin down, and `relay` off, the very
 * last item, can take down the connection the call runs on. Everything else keeps its staged order.
 */
function rank(item: ApplyItem): number {
  if (item.op !== "setRow" || typeof item.value !== "boolean" || (item.rowId !== "pen" && item.rowId !== "relay")) return 1;
  if (item.value) return 0;
  return item.rowId === "pen" ? 2 : 3;
}

/** Time budget of one host: a base plus one step per install or update item. */
export function hostTimeoutMs(items: readonly ApplyItem[], baseMs = APPLY_BASE_TIMEOUT_MS): number {
  return baseMs + APPLY_PACKAGE_TIMEOUT_MS * items.filter((item) => item.op === "installPlugin" || item.op === "updatePlugin").length;
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

/**
 * A `providers` patch only updates providers the target already has (the others come back as ignored `providers.<id>`).
 * A patch that ends the connection (relay off) may fail the verifying re-read: that is `unverified`, not a failure.
 */
async function applyRow(client: DaemonClient, planned: MutableDaemonConfigPatch): Promise<ApplyOutcome> {
  let patch = planned;
  let missing: string[] = [];
  if (planned.providers) {
    const split = existingProvidersOnly(planned.providers, (await client.getDaemonConfig()).config.providers);
    missing = split.missing.map((id) => `providers.${id}`);
    if (Object.keys(split.providers).length === 0) return { status: "ignored", paths: missing };
    patch = { providers: split.providers };
  }
  const verified = await patchConfigVerified(client, patch);
  const ignored = [...verified.ignored, ...missing];
  if (ignored.length > 0) return { status: "ignored", paths: ignored };
  return verified.unverified ? { status: "ok", unverified: true } : { status: "ok" };
}

async function runOperation(client: DaemonClient, planned: Planned): Promise<ApplyOutcome> {
  const { item } = planned;
  switch (item.op) {
    case "setRow":
      return applyRow(client, planned.patch ?? {});
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
    const failure = failureFromError(error, "host_error");
    // The daemon switches the relay off before its answer is out, so the link drops under the call (seen on 0.13.2):
    // the patch took effect, only the answer is lost. `mhm.grid.load` shows the real state.
    if (planned.dropsLink && failure.code === "host_offline") return { status: "ok", unverified: true };
    return failed(failure);
  }
}

/**
 * Applies one host's items in rank order over one connection. Slots are filled as items finish, so that a timeout or a
 * lost connection keeps what already happened and marks only the rest.
 */
async function applyHost(client: DaemonClient, host: HostEntry, policy: BrokerPolicy, baseTimeoutMs: number, group: { index: number; planned: Planned }[], slots: (ApplyOutcome | undefined)[]) {
  const order = [...group].sort((a, b) => rank(a.planned.item) - rank(b.planned.item));
  const settle = (index: number, outcome: ApplyOutcome) => void (slots[index] ??= outcome);
  for (const entry of order) if (entry.planned.rejected) settle(entry.index, entry.planned.rejected);
  if (order.every((entry) => entry.planned.rejected)) return;

  let stopped = false;
  const result = await callHost(client, host, {
    policy,
    requiredFeatures: [],
    timeoutMs: hostTimeoutMs(group.map((entry) => entry.planned.item), baseTimeoutMs),
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
 * `baseTimeoutMs` is the per-host base of hostTimeoutMs.
 */
export function applyItems(origin: OriginSession, home: string, policy: BrokerPolicy, items: ApplyItem[], baseTimeoutMs = APPLY_BASE_TIMEOUT_MS): Promise<ApplyResult[]> {
  const slots: (ApplyOutcome | undefined)[] = items.map(() => undefined);
  const results = (): ApplyResult[] =>
    items.map((item, index) => ({ id: item.id, host: item.host, op: item.op, outcome: slots[index] ?? failed(hostFailure("host_error")) }));

  return withHostList(
    origin,
    home,
    policy,
    async (client, hosts) => {
      const owners = items.map((item) => hosts.find((host) => isHost(host, item.host)));
      owners.forEach((owner, index) => {
        if (!owner) slots[index] = failed(hostFailure("host_error", "unknown_host"));
      });
      const groups = hosts.map((host) => ({
        host,
        group: items.flatMap((item, index) => (owners[index] === host ? [{ index, planned: plan(item, host) }] : [])),
      }));
      const known = groups.filter(({ group }) => group.length > 0);
      const apply = ({ host, group }: (typeof groups)[number]) => applyHost(client, host, policy, baseTimeoutMs, group, slots);
      await Promise.all(known.filter(({ host }) => !host.isHub).map(apply));
      await Promise.all(known.filter(({ host }) => host.isHub).map(apply));
      return results();
    },
    (_hubId, failure) => {
      items.forEach((_item, index) => (slots[index] = failed(failure.error)));
      return results();
    },
  );
}
