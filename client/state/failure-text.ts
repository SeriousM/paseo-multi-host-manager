import type { HostFailure } from "../../shared/contracts";

const INVALID_ITEM_TEXT: Record<string, string> = {
  self_target: "multi-host-manager runs this view on the hub; it cannot be disabled or removed from here.",
  credentials_in_source: "The source has credentials in its URL. Use a source without them.",
  directory_source: "A local directory exists only on its own host. Use a registry id, an npm: or a git: source.",
  masked_value: "The value contains masked secrets and cannot be written.",
  wrong_value_type: "The value has the wrong type for this setting.",
  read_only_row: "This setting is read-only.",
  protected_row: "This setting is never read or written.",
  unknown_row: "The hub does not know this setting.",
  unknown_host: "The hub has no saved host with this id. Refresh the grid.",
};

const HOST_ERROR_TEXT: Record<string, string> = {
  conflict: "Changed on the host since it was read. Reload and retry.",
  not_allowed: "The host does not allow this change.",
  invalid_input: "The host rejected the values (a masked value has no stored value to keep).",
  invalid_document: "The stored settings document is not valid.",
  not_found: "Not found on the host.",
  update_preview_failed: "The host could not check for an update.",
  update_failed: "The host could not apply the update.",
  // Codes of the hub daemon's saved-host directory (Add host).
  resource_limit: "The hub already has the most saved hosts it allows (128). Remove one first.",
  source_conflict: "The hub already has this registration. Refresh the grid.",
  permission_denied: "The hub's daemon does not allow this plugin to change its saved hosts.",
  host_unknown: "The hub no longer has this saved host. Refresh the grid.",
};

const CAPABILITY_DISABLED_TEXT: Record<string, string> = {
  capability_disabled: "Settings writes are off on this host. Allow them in its multi-host-manager settings.",
  companion_disabled: "multi-host-manager is installed but not running on this host.",
};

/** Readable text for a failed item. `currentRevision` is set when a settings document write lost a race. */
export function failureText(error: HostFailure, currentRevision?: string): string {
  const detail = error.detail ?? "";
  switch (error.code) {
    case "unsupported_capability":
      if (detail === "companion_missing") return "multi-host-manager is not installed on this host.";
      return detail ? `This host's Paseo lacks ${detail}. Update Paseo on that host.` : error.message;
    case "capability_disabled":
      return CAPABILITY_DISABLED_TEXT[detail] ?? error.message;
    case "confirmation_required":
    case "lockout_confirmation_required":
      return "Needs your confirmation. Press Apply again to confirm.";
    case "invalid_item":
      return INVALID_ITEM_TEXT[detail] ?? (detail ? `${error.message} (${detail})` : error.message);
    case "host_error": {
      const text = HOST_ERROR_TEXT[detail] ?? (detail ? `${error.message} (${detail})` : error.message);
      return currentRevision ? `${text} Current revision: ${currentRevision}.` : text;
    }
    case "insecure_link":
      return "The link to this host is not known to be encrypted. Allow it in the host's capabilities.";
    default:
      return error.message;
  }
}
