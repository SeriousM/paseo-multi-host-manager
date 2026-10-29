import { setTimeout as sleep } from "node:timers/promises";
import { unencryptedLink } from "../../shared/connection";
import type { HostAddResult, hostAddRpc } from "../../shared/contracts";
import type { z } from "zod";
import { parseHostTarget } from "./daemon-client";
import { failureFromError, hostFailure } from "./failures";
import { withHostList } from "./host-list";
import { classifyLink, hostEntries } from "./hosts";
import type { OriginSession } from "./origin-session";

/** How long the call waits for the hub's first connect to the new host before it reports `connecting`. */
export const ADD_SETTLE_MS = 10_000;
const POLL_MS = 500;

/**
 * Saves a host in the hub daemon's directory (the `addHost` call `paseo host add` makes) and waits until the hub's
 * first connect settled. The connection goes to the daemon and nowhere else: it is not logged, not kept, and no
 * result or failure carries it (failures are fixed texts plus a code).
 */
export async function addHost(origin: OriginSession, home: string, input: z.output<typeof hostAddRpc.input>, settleMs = ADD_SETTLE_MS): Promise<HostAddResult> {
  let description: string;
  try {
    description = parseHostTarget(input.connection).description;
  } catch {
    return { ok: false, error: hostFailure("invalid_connection") };
  }
  if (unencryptedLink(classifyLink(description)) && !input.allowUnencrypted) return { ok: false, error: hostFailure("insecure_link", "unencrypted_link") };

  return withHostList(
    origin,
    home,
    input,
    async (client): Promise<HostAddResult> => {
      let registrationId: string;
      try {
        registrationId = (await client.addHost({ connection: input.connection, ...(input.label ? { label: input.label } : null) })).registrationId;
      } catch (error) {
        const failure = failureFromError(error, "host_error");
        return { ok: false, error: failure.detail === "invalid_connection" ? hostFailure("invalid_connection") : failure };
      }
      const deadline = Date.now() + settleMs;
      for (;;) {
        const directory = await client.listHosts().catch(() => null);
        const summary = directory?.hosts.find((host) => host.registrationId === registrationId);
        const entry = directory ? hostEntries(directory).find((host) => host.registrationId === registrationId) : undefined;
        if (summary && entry && (summary.status !== "connecting" || Date.now() >= deadline)) {
          return {
            ok: true,
            host: { id: entry.id, registrationId, serverId: summary.serverId, label: entry.label, link: entry.link, status: summary.status, failure: entry.unavailable },
          };
        }
        // Saved, but the hub's directory did not answer for it in time: report it as still connecting.
        if (Date.now() >= deadline) {
          return { ok: true, host: { id: registrationId, registrationId, serverId: null, label: input.label || registrationId, link: classifyLink(description), status: "connecting", failure: null } };
        }
        await sleep(POLL_MS);
      }
    },
    (_hubId, failure) => ({ ok: false, error: failure.error }),
  );
}
