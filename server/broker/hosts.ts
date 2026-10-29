import type { HostFailure, LinkKind } from "../../shared/contracts";
import type { HostDirectory, HostSummary } from "./daemon-client";
import { failureFromCode, hostFailure } from "./failures";

export interface HostEntry {
  /** Server id; the registration id while the hub has never reached the host. */
  id: string;
  label: string;
  link: LinkKind;
  isHub: boolean;
  /** Set when the hub's directory already reports the host as unusable. */
  unavailable: HostFailure | null;
}

const LOOPBACK_HOST = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Classifies the daemon's redacted `targetDescription` (see parseHostTarget in @getpaseo/protocol).
 * `tcp://` hides whether TLS is on, so a non-loopback tcp target counts as plain.
 */
export function classifyLink(targetDescription: string): LinkKind {
  const scheme = /^([a-z]+):\/\//.exec(targetDescription)?.[1];
  if (scheme === "relay") return "relay";
  if (scheme === "ssh") return "ssh";
  if (scheme === "unix" || scheme === "pipe") return "loopback";
  if (scheme !== "tcp" && scheme !== "ws") return "unknown";
  const authority = targetDescription.slice(scheme.length + 3).split("/")[0];
  const host = authority.replace(/:\d+$/, "");
  return LOOPBACK_HOST.test(host) ? "loopback" : "tcp-plain";
}

function unavailableReason(host: HostSummary): HostFailure | null {
  if (host.serverId === null && host.status === "online") return hostFailure("host_offline");
  switch (host.status) {
    case "online":
      return null;
    case "disabled":
      return hostFailure("host_offline", "host_disabled");
    case "error":
      return failureFromCode(host.error?.code, "host_error");
    default:
      return hostFailure("host_offline", host.status);
  }
}

/** Hub first, then the hub's saved hosts. Connection strings are dropped here and never leave this module. */
export function hostEntries(directory: HostDirectory): HostEntry[] {
  const hub: HostEntry = { id: directory.self.serverId, label: directory.self.label, link: "loopback", isHub: true, unavailable: null };
  return [
    hub,
    ...directory.hosts.map((host) => ({
      id: host.serverId ?? host.registrationId,
      label: host.label ?? host.serverId ?? host.registrationId,
      link: classifyLink(host.targetDescription),
      isHub: false,
      unavailable: unavailableReason(host),
    })),
  ];
}
