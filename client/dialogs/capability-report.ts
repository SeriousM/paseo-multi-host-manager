import type { LinkKind } from "../../shared/contracts";
import type { Severity } from "../grid/palette";
import { MINIMUM_PASEO, TESTED_VERSION, hostSummary } from "../state/grid-model";
import type { GridHost } from "../state/types";

/** `server_info.features` flags this plugin uses, what each one allows and the release that added it (docs/design/CAPABILITIES.md). */
export const FEATURE_INFO: { flag: string; allows: string; since: string }[] = [
  { flag: "hostMultiplexing", allows: "Managing this host through the hub", since: "0.13.0" },
  { flag: "connectedHosts", allows: "The hub routing to its saved hosts", since: "0.13.0" },
  { flag: "pluginManagement", allows: "Listing, enabling, disabling, reloading and removing plugins", since: "0.8.0" },
  { flag: "pluginSourceInstallation", allows: "Installing plugins, and pasting a plugin onto this host", since: "0.9.0" },
  { flag: "pluginSourceUpdates", allows: "Checking for and applying plugin updates", since: "0.9.0" },
  { flag: "pluginSettings", allows: "Plugin settings documents: editing and pasting", since: "0.8.0" },
  { flag: "relayConfig", allows: "Writing the Relay enabled setting", since: "0.8.0" },
  { flag: "daemonConfigReload", allows: "Applying config changes without a restart", since: "0.8.0" },
];

export const LINK_INFO: Record<LinkKind, { label: string; severity: Severity; text: string }> = {
  relay: { label: "relay", severity: "ok", text: "Through the Paseo relay, end-to-end encrypted. The saved host carries its own relay." },
  ssh: { label: "SSH tunnel", severity: "ok", text: "Through an SSH tunnel." },
  loopback: { label: "loopback", severity: "ok", text: "On this machine." },
  tls: { label: "TLS", severity: "ok", text: "Over TLS." },
  "tcp-plain": { label: "tcp, unencrypted", severity: "warn", text: "Direct TCP. A password protects access but does not encrypt traffic. Blocked unless you allow it for this host." },
  unknown: { label: "unknown link", severity: "warn", text: "The hub could not tell how this host is reached. Blocked unless you allow it for this host." },
};

export type VersionTier = "tested" | "untested" | "prerelease" | "below_minimum" | "unknown";

const TIER_TEXT: Record<VersionTier, string> = {
  tested: `Within the tested range: Paseo ${MINIMUM_PASEO} to ${TESTED_VERSION}.`,
  untested: `Newer than ${TESTED_VERSION}, the newest version this plugin was tested with. It may still work.`,
  prerelease: "Pre-release: the plugin API is not frozen. Blocked unless pre-release hosts are allowed.",
  below_minimum: `Older than ${MINIMUM_PASEO}: a hub cannot reach this host.`,
  unknown: "The version is not known.",
};

const TIER_SEVERITY: Record<VersionTier, Severity> = { tested: "ok", untested: "warn", prerelease: "bad", below_minimum: "bad", unknown: "muted" };

export interface CapabilityReport {
  version: string | null;
  tier: VersionTier;
  tierText: string;
  tierSeverity: Severity;
  /** Known flags with whether the host reports them; empty without a snapshot. */
  features: { flag: string; allows: string; since: string; present: boolean }[];
  missing: number;
  hasSnapshot: boolean;
}

export function capabilityReport(host: GridHost): CapabilityReport {
  const summary = hostSummary(host);
  const snapshot = host.result.snapshot;
  const failureCode = summary.failure?.code;
  let tier: VersionTier = "unknown";
  if (failureCode === "below_minimum") tier = "below_minimum";
  else if (summary.versionTag) tier = summary.versionTag;
  else if (summary.version) tier = "tested";
  const features = snapshot ? FEATURE_INFO.map((info) => ({ ...info, present: snapshot.features.includes(info.flag) })) : [];
  return {
    version: summary.version,
    tier,
    tierText: TIER_TEXT[tier],
    tierSeverity: TIER_SEVERITY[tier],
    features,
    missing: features.filter((feature) => !feature.present).length,
    hasSnapshot: snapshot !== undefined,
  };
}
