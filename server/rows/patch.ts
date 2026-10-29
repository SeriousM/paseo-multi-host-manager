import { MASK_PLACEHOLDER } from "../../shared/mask";
import { PROVIDER_EXCLUDED_KEYS, ROW_BY_ID } from "../../shared/rows";
import type { MutableDaemonConfigPatch } from "../broker/daemon-client";

type ProvidersPatch = NonNullable<MutableDaemonConfigPatch["providers"]>;

function containsPlaceholder(value: unknown): boolean {
  if (value === MASK_PLACEHOLDER) return true;
  if (Array.isArray(value)) return value.some(containsPlaceholder);
  return typeof value === "object" && value !== null && Object.values(value).some(containsPlaceholder);
}

/** A non-empty record of provider entries without the keys that are never copied. The daemon validates the entries themselves. */
function isProvidersPatch(value: unknown): value is ProvidersPatch {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return (
    entries.length > 0 &&
    entries.every((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry) && PROVIDER_EXCLUDED_KEYS.every((key) => !Object.hasOwn(entry, key)))
  );
}

/**
 * `config.patch` body for a row, or the reason it cannot be written: unknown, read-only or protected row,
 * a value of the wrong type, or a masked placeholder (a placeholder stands for a value this host never saw).
 */
export function rowPatch(rowId: string, value: unknown): { patch: MutableDaemonConfigPatch } | { invalid: string } {
  const row = ROW_BY_ID[rowId];
  if (!row) return { invalid: "unknown_row" };
  if (row.write !== "live") return { invalid: row.write === "never" ? "protected_row" : "read_only_row" };
  if (containsPlaceholder(value)) return { invalid: "masked_value" };
  const wrongType = { invalid: "wrong_value_type" };
  switch (row.id) {
    case "relay":
      return typeof value === "boolean" ? { patch: { relay: { enabled: value } } } : wrongType;
    case "mcp":
      return typeof value === "boolean" ? { patch: { mcp: { injectIntoAgents: value } } } : wrongType;
    case "browser":
      return typeof value === "boolean" ? { patch: { browserTools: { enabled: value } } } : wrongType;
    case "hooks":
      return typeof value === "boolean" ? { patch: { enableTerminalAgentHooks: value } } : wrongType;
    case "autoarch":
      return typeof value === "boolean" ? { patch: { autoArchiveAfterMerge: value } } : wrongType;
    case "pen":
      return typeof value === "boolean" ? { patch: { pluginsEnabled: value } } : wrongType;
    case "sys":
      return typeof value === "string" ? { patch: { appendSystemPrompt: value } } : wrongType;
    case "prov":
      return isProvidersPatch(value) ? { patch: { providers: value } } : wrongType;
    default:
      return { invalid: "read_only_row" };
  }
}
