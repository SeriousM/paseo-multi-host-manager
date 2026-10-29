import type { BrokerPolicy, HostResult, LinkKind } from "../../shared/contracts";
import { callHost } from "./call";
import { connectOriginClient } from "./daemon-client";
import type { DaemonClient } from "./daemon-client";
import { failureFromError, hostFailure } from "./failures";
import { hostEntries } from "./hosts";
import type { HostEntry } from "./hosts";
import { readHubAddress, readLocalCredential } from "./origin";

export const OVERVIEW_TIMEOUT_MS = 10_000;

export interface HostOverview {
  id: string;
  registrationId: string | null;
  label: string;
  link: LinkKind;
  isHub: boolean;
  result: HostResult<null>;
}

function hubOnly(id: string | null, result: HostResult<null>): HostOverview[] {
  return [{ id: id ?? "hub", registrationId: null, label: "Hub", link: "loopback", isHub: true, result }];
}

async function overviewViaOrigin(origin: DaemonClient, policy: BrokerPolicy, timeoutMs: number): Promise<HostOverview[]> {
  // The hub's internal API carries every other call, so the hub must pass the gates first.
  const hubSelf: HostEntry = { id: origin.getLastServerInfoMessage()?.serverId ?? "hub", registrationId: null, label: "Hub", link: "loopback", isHub: true, unavailable: null };
  const request = { policy, requiredFeatures: ["connectedHosts" as const], timeoutMs, run: async () => null };
  const hubResult = await callHost(origin, hubSelf, request);
  if (!hubResult.ok) return hubOnly(hubSelf.id, hubResult);
  let hosts: HostEntry[];
  try {
    hosts = hostEntries(await origin.listHosts());
  } catch (error) {
    return hubOnly(hubSelf.id, { ok: false, error: failureFromError(error, "host_error"), snapshot: hubResult.snapshot });
  }
  return Promise.all(
    hosts.map(async (host) => {
      const result = host.isHub ? hubResult : await callHost(origin, host, { ...request, requiredFeatures: [] });
      return { id: host.id, registrationId: host.registrationId, label: host.label, link: host.link, isHub: host.isHub, result };
    }),
  );
}

/** Hub plus every saved host with its capability snapshot or failure. One routed connection per host, all hosts in parallel. */
export async function hostsOverview(home: string, policy: BrokerPolicy, timeoutMs = OVERVIEW_TIMEOUT_MS): Promise<HostOverview[]> {
  const address = readHubAddress(home);
  if (!address) return hubOnly(null, { ok: false, error: hostFailure("host_offline", "no_pid_file") });
  let origin: DaemonClient;
  try {
    origin = await connectOriginClient(address.listen, () => readLocalCredential(home));
  } catch (error) {
    return hubOnly(address.serverId, { ok: false, error: failureFromError(error, "host_offline") });
  }
  try {
    return await overviewViaOrigin(origin, policy, timeoutMs);
  } finally {
    await origin.close().catch(() => undefined);
  }
}
