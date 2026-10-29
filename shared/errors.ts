export const ERROR_CODES = [
  "host_offline",
  "authentication_failed",
  "unsupported_capability",
  "insecure_link",
  "below_minimum",
  "prerelease_blocked",
  "capability_disabled",
  // An item that needs the user's explicit confirmation (install, remove) arrived without it.
  "confirmation_required",
  // An item that can cut the hub off from a host (relay off over its relay link, pluginsEnabled off, removing or
  // disabling this plugin on a remote) arrived without confirmation.
  "lockout_confirmation_required",
  // A malformed item: unknown or read-only row, wrong value type, masked placeholder, directory source,
  // credentials in a source (`credentials_in_source`), this plugin removed or disabled on the hub (`self_target`).
  "invalid_item",
  // Any other daemon or call failure; the daemon's own code goes into `detail`.
  "host_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
