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
  // A malformed item: unknown or read-only row, wrong value type, masked placeholder, directory source.
  "invalid_item",
  // Any other daemon or call failure; the daemon's own code goes into `detail`.
  "host_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
