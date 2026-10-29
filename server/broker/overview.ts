import type { BrokerPolicy, HostResult, LinkKind } from "../../shared/contracts";
import { callHost } from "./call";
import type { DaemonClient } from "./daemon-client";
import { failureFromError } from "./failures";
import { hostEntries } from "./hosts";
import type { HostEntry } from "./hosts";
import { readHubAddress } from "./origin";
import type { OriginSession } from "./origin-session";

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
export async function hostsOverview(origin: OriginSession, home: string, policy: BrokerPolicy, timeoutMs = OVERVIEW_TIMEOUT_MS): Promise<HostOverview[]> {
  try {
    return await origin.use((client) => overviewViaOrigin(client, policy, timeoutMs));
  } catch (error) {
    // Only the hub connect throws (overviewViaOrigin reports per host); `home` names the hub without a connection.
    return hubOnly(readHubAddress(home)?.serverId ?? null, { ok: false, error: failureFromError(error, "host_offline") });
  }
}
