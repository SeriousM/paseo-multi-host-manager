import type { z } from "zod";
import { settingsReadRpc } from "../../shared/companion-contracts";
import type { BrokerPolicy, HostFailure, HostResult } from "../../shared/contracts";
import { callHost } from "../broker/call";
import { callCompanion, companionBlocker } from "../broker/companion-call";
import { hostFailure } from "../broker/failures";
import { withHostList } from "../broker/host-list";
import { isHost } from "../broker/hosts";
import type { OriginSession } from "../broker/origin-session";

export const DOC_TIMEOUT_MS = 15_000;

type DocRead = z.output<typeof settingsReadRpc.output>;

/**
 * Reads one settings document through the companion on `input.host` (server or registration id; secrets masked by the
 * companion). No feature gate: like apply, it checks that our plugin runs on the host (companionBlocker).
 */
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
      const host = hosts.find((entry) => isHost(entry, input.host));
      if (!host) return { ok: false, error: hostFailure("host_error", "unknown_host") };
      const result = await callHost(client, host, {
        policy,
        requiredFeatures: [],
        timeoutMs,
        run: async (hostClient): Promise<{ blocked: HostFailure } | { blocked: null; doc: DocRead }> => {
          const blocked = await companionBlocker(hostClient);
          return blocked ? { blocked } : { blocked: null, doc: await callCompanion(hostClient, settingsReadRpc, { pluginId: input.pluginId, settingsId: input.settingsId }) };
        },
      });
      if (!result.ok) return result;
      const read = result.value;
      return read.blocked ? { ok: false, error: read.blocked, snapshot: result.snapshot } : { ok: true, snapshot: result.snapshot, value: read.doc };
    },
    (_hubId, failure) => failure,
  );
}
