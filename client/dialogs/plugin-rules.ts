import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import { hasUrlCredentials } from "../../shared/mask";
import { hasFeature, pluginsOn } from "../state/clipboard";
import { formatPlugin, hostData } from "../state/grid-model";
import type { GridHost, MhmState } from "../state/types";

/** Same shape the server uses to tell a local path from a managed source (server/rpc/apply.ts). */
const DIRECTORY_SOURCE = /^(\.\.?(?:[/\\]|$)|\/|~|[A-Za-z]:[/\\]|\\\\)/;
const REGISTRY_ID = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+){1,2}$/i;

export type ParsedSource = { ok: true; source: string; kind: "registry" | "npm" | "git" } | { ok: false; empty: boolean; reason: string };

/**
 * Checks an install source the user typed: a registry id (`owner/name`), `npm:<package>[@version]` or `git:<url>`.
 * Credentials in a URL and local directories are refused with the server's own rules (`credentials_in_source`, `directory_source`).
 */
export function parseInstallSource(text: string): ParsedSource {
  const source = text.trim();
  const refuse = (reason: string): ParsedSource => ({ ok: false, empty: false, reason });
  if (source === "") return { ok: false, empty: true, reason: "Enter a source." };
  if (/\s/.test(source)) return refuse("A source has no spaces.");
  if (hasUrlCredentials(source)) return refuse("The source has credentials in its URL. Remove them: this plugin never copies credentials.");
  if (DIRECTORY_SOURCE.test(source)) return refuse("A local directory exists only on its own host. Use a registry id, npm: or git:.");
  if (source.startsWith("npm:")) return source.length > 4 ? { ok: true, source, kind: "npm" } : refuse("Add a package name after npm:.");
  if (source.startsWith("git:")) return source.length > 4 ? { ok: true, source, kind: "git" } : refuse("Add a repository URL after git:.");
  if (REGISTRY_ID.test(source)) return { ok: true, source, kind: "registry" };
  return refuse("Use a registry id (owner/name), npm:package@version or git:https://host/owner/repo.");
}

function plugin(host: GridHost, pluginId: string) {
  return hostData(host)?.plugins.find((candidate) => candidate.id === pluginId);
}

/** Why a plugin cannot be installed on a host, or null. `pluginId` is empty when installing from a typed source. */
export function installBlocker(state: Pick<MhmState, "staged">, host: GridHost, pluginId: string): string | null {
  if (!host.result.ok) return host.result.error.message;
  const installed = pluginId === "" ? undefined : plugin(host, pluginId);
  if (installed) return `already installed (${formatPlugin(installed)})`;
  if (!hasFeature(host, "pluginManagement") || !hasFeature(host, "pluginSourceInstallation")) return "host lacks pluginSourceInstallation";
  if (!pluginsOn(state, host)) return 'plugins are switched off on this host (stage "Plugins enabled" first)';
  return null;
}

/** Why a plugin cannot be removed from a host, or null. */
export function removeBlocker(host: GridHost, pluginId: string): string | null {
  if (!host.result.ok) return host.result.error.message;
  const installed = plugin(host, pluginId);
  if (!installed) return "not installed";
  if (host.isHub && pluginId === OWN_PLUGIN_ID) return "runs this view on the hub";
  return null;
}

export interface PluginMenuRules {
  /** This plugin on the hub: cannot be disabled or removed from here, so the menu does not offer it. */
  selfOnHub: boolean;
  /** Why enable/disable, reload and remove are unavailable (the host lacks plugin management), or null. */
  manage: string | null;
  /** Why update and check are unavailable, or null. */
  update: string | null;
  /** Settings documents the editor can open; empty with `editor` saying why. */
  documents: string[];
  editor: string | null;
}

export function pluginMenuRules(host: GridHost, pluginId: string): PluginMenuRules {
  const data = hostData(host);
  const installed = plugin(host, pluginId);
  const documents = data?.companion.state === "ok" ? data.companion.settingsDocuments.filter((doc) => doc.pluginId === pluginId).map((doc) => doc.settingsId) : [];
  let editor: string | null = null;
  if (data?.companion.state !== "ok") editor = "needs multi-host-manager running on this host";
  else if (documents.length === 0) editor = "no settings document on this host";
  let update: string | null = null;
  if (installed?.source.kind === "directory") update = "local plugins have no update source";
  else if (!hasFeature(host, "pluginSourceUpdates")) update = "host lacks pluginSourceUpdates";
  return {
    selfOnHub: host.isHub && pluginId === OWN_PLUGIN_ID,
    manage: hasFeature(host, "pluginManagement") ? null : "host lacks pluginManagement",
    update,
    documents,
    editor,
  };
}
