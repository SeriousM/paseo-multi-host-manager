import type { BrokerPolicy } from "../../shared/contracts";
import { callHost } from "./call";
import { hubOnlyRow, withHostList } from "./host-list";
import type { HostRow } from "./host-list";
import type { OriginSession } from "./origin-session";

export const OVERVIEW_TIMEOUT_MS = 10_000;

export type HostOverview = HostRow<null>;

/** Hub plus every saved host with its capability snapshot or failure. One routed connection per host, all hosts in parallel. */
export function hostsOverview(origin: OriginSession, home: string, policy: BrokerPolicy, timeoutMs = OVERVIEW_TIMEOUT_MS): Promise<HostOverview[]> {
  return withHostList(
    origin,
    home,
    policy,
    (client, hosts) =>
      Promise.all(
        hosts.map(async (host): Promise<HostOverview> => ({
          id: host.id,
          registrationId: host.registrationId,
          label: host.label,
          link: host.link,
          isHub: host.isHub,
          result: await callHost(client, host, { policy, requiredFeatures: [], timeoutMs, run: async () => null }),
        })),
      ),
    (hubId, failure) => [hubOnlyRow(hubId, failure)],
  );
}
