import type { BrokerPolicy, CapabilitySnapshot, HostFailure } from "../../shared/contracts";
import type { FeatureName, ServerInfoStatusPayload } from "./daemon-client";
import { hostFailure } from "./failures";

export const MINIMUM_VERSION = "0.13.0";

interface ParsedVersion {
  core: [number, number, number];
  prerelease: boolean;
}

function parseVersion(version: string | null): ParsedVersion | null {
  const match = version ? /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(version) : null;
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] !== undefined };
}

/** Compares stable cores only, like Paseo's own manifest requirement check. */
function coreBelow(actual: ParsedVersion, minimum: ParsedVersion): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual.core[i] !== minimum.core[i]) return actual.core[i] < minimum.core[i];
  }
  return false;
}

export function capabilitySnapshot(info: ServerInfoStatusPayload): CapabilitySnapshot {
  const version = info.version ?? null;
  const features = Object.entries(info.features ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
    .sort();
  return {
    serverId: info.serverId,
    version,
    protocolVersion: info.protocolVersion ?? null,
    prerelease: parseVersion(version)?.prerelease ?? false,
    features,
  };
}

/** First failing gate in order: minimum version, pre-release, required features. */
export function checkGates(snapshot: CapabilitySnapshot, policy: BrokerPolicy, requiredFeatures: readonly FeatureName[]): HostFailure | null {
  const parsed = parseVersion(snapshot.version);
  const minimum = parseVersion(MINIMUM_VERSION);
  if (!parsed || !minimum || coreBelow(parsed, minimum)) return hostFailure("below_minimum");
  if (parsed.prerelease && !policy.allowPrerelease) return hostFailure("prerelease_blocked");
  const missing = requiredFeatures.find((feature) => !snapshot.features.includes(feature));
  return missing ? hostFailure("unsupported_capability", missing) : null;
}
