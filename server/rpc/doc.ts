import type { z } from "zod";
import { settingsReadRpc } from "../../shared/companion-contracts";
import type { BrokerPolicy, HostResult } from "../../shared/contracts";
import { callHost } from "../broker/call";
import { callCompanion } from "../broker/companion-call";
import { hostFailure } from "../broker/failures";
import { withHostList } from "../broker/host-list";
import type { OriginSession } from "../broker/origin-session";

export const DOC_TIMEOUT_MS = 15_000;

type DocRead = z.output<typeof settingsReadRpc.output>;

/** Reads one settings document through the companion on `input.host` (secrets masked by the companion). */
export function readDoc(
  origin: OriginSession,
  home: string,
  policy: BrokerPolicy,
  input: { host: string; pluginId: string; settingsId: string },
  timeoutMs = DOC_TIMEOUT_MS,
): Promise<HostResult<DocRead>> {
  return withHostList(
    origin,
    home,
    policy,
    async (client, hosts) => {
      const host = hosts.find((entry) => entry.id === input.host);
      if (!host) return { ok: false, error: hostFailure("host_error", "unknown_host") };
      return callHost(client, host, {
        policy,
        requiredFeatures: ["pluginSettings"],
        timeoutMs,
        run: (hostClient) => callCompanion(hostClient, settingsReadRpc, { pluginId: input.pluginId, settingsId: input.settingsId }),
      });
    },
    (_hubId, failure) => failure,
  );
}
