import { defineSettings } from "@getpaseo/plugin";
import { brokerPolicySchema } from "../../shared/contracts";
import type { BrokerPolicy } from "../../shared/contracts";

/**
 * The user's broker policy, sent with every grid load, apply and document read. Paseo has only host-scoped settings,
 * so it lives on the host the screen talks to, which is the hub: the same daemon that enforces it. index.server.ts
 * registers it; it sits in client/ only because shared/ is owned by the server work package.
 */
export const brokerSettings = defineSettings({ id: "broker", scope: "host", version: 1, schema: brokerPolicySchema });

export const DEFAULT_POLICY: BrokerPolicy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };

/** Adds or removes one saved host from the insecure-link allow list; order is kept stable for clean diffs. */
export function withInsecureLink(policy: BrokerPolicy, registrationId: string, allowed: boolean): BrokerPolicy {
  const others = policy.insecureLinkRegistrationIds.filter((id) => id !== registrationId);
  return { ...policy, insecureLinkRegistrationIds: allowed ? [...others, registrationId].sort() : others };
}
