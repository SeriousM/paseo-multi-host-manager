import type { BrokerPolicy } from "../../shared/contracts";

/** Adds or removes one saved host from the insecure-link allow list; order is kept stable for clean diffs. */
export function withInsecureLink(policy: BrokerPolicy, registrationId: string, allowed: boolean): BrokerPolicy {
  const others = policy.insecureLinkRegistrationIds.filter((id) => id !== registrationId);
  return { ...policy, insecureLinkRegistrationIds: allowed ? [...others, registrationId].sort() : others };
}
