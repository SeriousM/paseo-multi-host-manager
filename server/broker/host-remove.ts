import type { hostRemoveRpc, HostRemoveResult } from "../../shared/contracts";
import type { z } from "zod";
import { failureFromError, hostFailure } from "./failures";
import { withHostList } from "./host-list";
import type { OriginSession } from "./origin-session";

/**
 * Removes one saved host from the hub daemon's directory (the `removeHost` call `paseo host rm` makes). Only the hub's
 * saved connection goes; the host is not contacted, so this works while it is unreachable. Refuses the hub itself and
 * ids that are not a saved host of this hub. Failures carry fixed texts and the daemon's code, never its message.
 */
export function removeHost(origin: OriginSession, home: string, input: z.output<typeof hostRemoveRpc.input>): Promise<HostRemoveResult> {
  return withHostList(
    origin,
    home,
    input,
    async (client, hosts): Promise<HostRemoveResult> => {
      const host = hosts.find((candidate) => candidate.registrationId === input.registrationId || candidate.id === input.registrationId);
      if (host?.isHub) return { ok: false, error: hostFailure("invalid_item", "self_target") };
      if (!host?.registrationId) return { ok: false, error: hostFailure("invalid_item", "unknown_host") };
      try {
        await client.removeHost(host.registrationId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: failureFromError(error, "host_error") };
      }
    },
    (_hubId, failure) => ({ ok: false, error: failure.error }),
  );
}
