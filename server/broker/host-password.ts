import type { HostAddResult, hostSetPasswordRpc } from "../../shared/contracts";
import type { z } from "zod";
import { hostFailure } from "./failures";
import { ADD_SETTLE_MS, prepareConnection, savedHostFailure, settleHost } from "./host-add";
import { withHostList } from "./host-list";
import type { OriginSession } from "./origin-session";

/**
 * Replaces a saved host's connection with the given link plus daemon password (the `updateHost` call
 * `paseo host update --connection` makes) and waits for the hub's reconnect. Only the connection changes: label,
 * metadata and the pinned identity stay, so the daemon refuses a link that reaches another daemon. Link and password go
 * to the daemon and nowhere else.
 */
export async function setHostPassword(origin: OriginSession, home: string, input: z.output<typeof hostSetPasswordRpc.input>, settleMs = ADD_SETTLE_MS): Promise<HostAddResult> {
  const prepared = prepareConnection(input);
  if ("code" in prepared) return { ok: false, error: prepared };

  return withHostList(
    origin,
    home,
    input,
    async (client, hosts): Promise<HostAddResult> => {
      const host = hosts.find((candidate) => candidate.registrationId === input.registrationId || candidate.id === input.registrationId);
      if (host?.isHub) return { ok: false, error: hostFailure("invalid_item", "self_target") };
      if (!host?.registrationId) return { ok: false, error: hostFailure("invalid_item", "unknown_host") };
      try {
        await client.updateHost(host.registrationId, { connection: prepared.connection });
      } catch (error) {
        return { ok: false, error: savedHostFailure(error) };
      }
      return { ok: true, host: await settleHost(client, host.registrationId, { label: host.label, link: prepared.link }, settleMs) };
    },
    (_hubId, failure) => ({ ok: false, error: failure.error }),
  );
}
