import type { BrokerPolicy, CapabilitySnapshot, CompanionState, GridHostData } from "../../shared/contracts";
import { configReadRpc, hostInfoRpc, OWN_PLUGIN_ID, settingsListRpc } from "../../shared/companion-contracts";
import { callHost } from "../broker/call";
import { callCompanion } from "../broker/companion-call";
import type { DaemonClient, PluginListItem } from "../broker/daemon-client";
import { hubOnlyRow, withHostList } from "../broker/host-list";
import type { HostRow } from "../broker/host-list";
import type { HostEntry } from "../broker/hosts";
import type { OriginSession } from "../broker/origin-session";
import { gridPlugin } from "../rows/plugins";
import { buildRows } from "../rows/read";

export const GRID_TIMEOUT_MS = 15_000;

/** Our plugin's state on the host and, when it runs, the values only it can read. `pluginsEnabled=false` is `disabled`, not a failure. */
async function readCompanion(client: DaemonClient, plugins: PluginListItem[], pluginsEnabled: boolean | undefined) {
  const own = plugins.find((plugin) => plugin.id === OWN_PLUGIN_ID);
  if (!own) return { state: { state: "missing" } satisfies CompanionState, rows: null };
  if (pluginsEnabled === false || !own.enabled || own.status === "disabled") return { state: { state: "disabled" } satisfies CompanionState, rows: null };
  if (own.status === "failed") return { state: { state: "failed" } satisfies CompanionState, rows: null };
  try {
    const [info, config, documents] = await Promise.all([
      callCompanion(client, hostInfoRpc, {}),
      callCompanion(client, configReadRpc, {}),
      callCompanion(client, settingsListRpc, {}),
    ]);
    return {
      state: { state: "ok", platform: info.platform, arch: info.arch, consent: info.consent, settingsDocuments: documents.documents } satisfies CompanionState,
      rows: { platform: info.platform, configValues: config.ok ? config.values : ("unreadable" as const) },
    };
  } catch {
    return { state: { state: "failed" } satisfies CompanionState, rows: null };
  }
}

/** All reads for one host over one connection: config, plugins, status, then our plugin's reads. */
async function loadHost(client: DaemonClient, snapshot: CapabilitySnapshot, host: HostEntry): Promise<GridHostData> {
  const [{ config }, plugins, listen] = await Promise.all([
    client.getDaemonConfig(),
    client.listPlugins(),
    // The listen address is a convenience row: a failing status call must not fail the host.
    snapshot.features.includes("daemonStatusRpc") ? client.getDaemonStatus().then((status) => status.listen, () => undefined) : undefined,
  ]);
  const companion = await readCompanion(client, plugins, config.pluginsEnabled);
  return {
    rows: buildRows({ version: snapshot.version, listen, link: host.link, config, features: snapshot.features, companion: companion.rows }),
    plugins: plugins.map(gridPlugin),
    companion: companion.state,
  };
}

/** Rows, plugins and companion state for the hub and every saved host: one batched call per host, hosts in parallel. */
export function loadGrid(origin: OriginSession, home: string, policy: BrokerPolicy, timeoutMs = GRID_TIMEOUT_MS): Promise<HostRow<GridHostData>[]> {
  return withHostList(
    origin,
    home,
    policy,
    (client, hosts) =>
      Promise.all(
        hosts.map(async (host): Promise<HostRow<GridHostData>> => ({
          id: host.id,
          registrationId: host.registrationId,
          label: host.label,
          link: host.link,
          isHub: host.isHub,
          result: await callHost(client, host, {
            policy,
            requiredFeatures: [],
            timeoutMs,
            run: (hostClient, snapshot) => loadHost(hostClient, snapshot, host),
          }),
        })),
      ),
    (hubId, failure) => [hubOnlyRow(hubId, failure)],
  );
}
