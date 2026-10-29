import type { BrokerPolicy, HostResult, LinkKind } from "../../shared/contracts";
import { callHost } from "./call";
import type { DaemonClient } from "./daemon-client";
import { failureFromError } from "./failures";
import { hostEntries } from "./hosts";
import type { HostEntry } from "./hosts";
import { readHubAddress } from "./origin";
import type { OriginSession } from "./origin-session";

export type HubFailure = Extract<HostResult<never>, { ok: false }>;

/** One host of the hub's directory with the result of a per-host operation. */
export interface HostRow<T> {
  id: string;
  registrationId: string | null;
  label: string;
  link: LinkKind;
  isHub: boolean;
  result: HostResult<T>;
}

/** Hub row for the case that the hub itself is unusable, so no saved host can be reached. */
export function hubOnlyRow(id: string | null, result: HubFailure): HostRow<never> {
  return { id: id ?? "hub", registrationId: null, label: "Hub", link: "loopback", isHub: true, result };
}

/**
 * Runs `work` with the hub's origin client and the directory of its saved hosts (hub first).
 * The hub must pass the gates first, because every other call goes through its internal API.
 * When the hub cannot be used, `onHubFailure` produces the result instead; this function does not throw
 * unless `work` does.
 */
export async function withHostList<R>(
  origin: OriginSession,
  home: string,
  policy: BrokerPolicy,
  work: (client: DaemonClient, hosts: HostEntry[]) => Promise<R>,
  onHubFailure: (hubId: string | null, failure: HubFailure) => R,
): Promise<R> {
  try {
    return await origin.use(async (client) => {
      const hubId = client.getLastServerInfoMessage()?.serverId ?? "hub";
      const hubSelf: HostEntry = { id: hubId, registrationId: null, label: "Hub", link: "loopback", isHub: true, unavailable: null };
      const gate = await callHost(client, hubSelf, { policy, requiredFeatures: ["connectedHosts"], timeoutMs: 1_000, run: async () => null });
      if (!gate.ok) return onHubFailure(hubId, gate);
      let hosts: HostEntry[];
      try {
        hosts = hostEntries(await client.listHosts());
      } catch (error) {
        return onHubFailure(hubId, { ok: false, error: failureFromError(error, "host_error"), snapshot: gate.snapshot });
      }
      return work(client, hosts);
    });
  } catch (error) {
    // Only the hub connect throws; `home` names the hub without a connection.
    return onHubFailure(readHubAddress(home)?.serverId ?? null, { ok: false, error: failureFromError(error, "host_offline") });
  }
}
