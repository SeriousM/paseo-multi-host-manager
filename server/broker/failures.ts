import type { HostFailure } from "../../shared/contracts";
import type { ErrorCode } from "../../shared/errors";
import { DaemonAuthenticationError } from "./daemon-client";

// Fixed texts: daemon and transport messages can carry endpoints, so they are never passed through.
const MESSAGES: Record<ErrorCode, string> = {
  host_offline: "Host is offline or not reachable through the hub.",
  authentication_failed: "The hub could not authenticate to this host. Check the saved host's password.",
  unsupported_capability: "This host's Paseo version lacks a required capability.",
  insecure_link: "The hub reaches this host over an unencrypted connection. Allow it explicitly to continue.",
  below_minimum: "This host runs a Paseo version below the supported minimum.",
  prerelease_blocked: "This host runs a Paseo pre-release. Allow pre-releases to continue.",
  capability_disabled: "This capability is disabled on the host.",
  host_error: "The host operation failed.",
};

/** Daemon and transport codes that mean "not reachable right now". */
const OFFLINE_CODES: Record<string, true> = {
  host_offline: true,
  host_disabled: true,
  DAEMON_CONNECTION_LOST: true,
  DAEMON_REQUEST_TIMEOUT: true,
  ECONNREFUSED: true,
  ECONNRESET: true,
  ETIMEDOUT: true,
  EHOSTUNREACH: true,
  ENOTFOUND: true,
};

const SAFE_DETAIL = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function hostFailure(code: ErrorCode, detail?: string): HostFailure {
  return detail && SAFE_DETAIL.test(detail) ? { code, message: MESSAGES[code], detail } : { code, message: MESSAGES[code] };
}

/** Maps a daemon or transport code; unknown codes become `fallback` with the code kept as detail. */
export function failureFromCode(code: string | undefined, fallback: ErrorCode): HostFailure {
  if (code === "authentication_failed" || code === "unsupported_capability") return hostFailure(code);
  if (code && OFFLINE_CODES[code]) return hostFailure("host_offline", code);
  return hostFailure(fallback, code);
}

export function failureFromError(error: unknown, fallback: ErrorCode): HostFailure {
  if (error instanceof DaemonAuthenticationError) return hostFailure("authentication_failed", error.reason);
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return failureFromCode(code, fallback);
}
