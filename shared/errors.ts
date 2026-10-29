export const ERROR_CODES = [
  "host_offline",
  "authentication_failed",
  "unsupported_capability",
  "insecure_link",
  "below_minimum",
  "prerelease_blocked",
  "capability_disabled",
  // Any other daemon or call failure; the daemon's own code goes into `detail`.
  "host_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
