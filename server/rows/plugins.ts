import type { GridPlugin, PluginSource } from "../../shared/contracts";
import { maskJson } from "../../shared/mask";
import type { PluginListItem } from "../broker/daemon-client";

const DEFAULT_REGISTRY_HOST = "plugins.paseo.sh";

function withPath(source: string, pluginPath: string): string {
  return pluginPath === "." ? source : `${source}:${pluginPath}`;
}

/** Portable identity of a plugin, in the form `installPluginSource` takes. Never a local path, never a remote with credentials. */
export function pluginSource(item: PluginListItem): PluginSource {
  const identity = item.installation?.identity;
  if (identity?.kind === "npm" || identity?.kind === "git") {
    if (identity.registry) {
      const host = new URL(identity.registry.url).host;
      return { kind: "registry", installSource: host === DEFAULT_REGISTRY_HOST ? identity.registry.id : `${host}/${identity.registry.id}` };
    }
    if (identity.kind === "npm") return { kind: "npm", installSource: withPath(`npm:${identity.packageName}`, identity.pluginPath) };
    const hasCredentials = maskJson(identity.remote).maskedPaths.length > 0;
    return { kind: "git", installSource: hasCredentials ? null : withPath(`git:${identity.remote}`, identity.pluginPath) };
  }
  if (!identity && item.npm) return { kind: "npm", installSource: `npm:${item.npm.packageName}` };
  return { kind: item.source === "git" ? "git" : "directory", installSource: null };
}

export function gridPlugin(item: PluginListItem): GridPlugin {
  return {
    id: item.id,
    name: item.name ?? null,
    version: item.npm?.version ?? item.installation?.currentRevision ?? item.commit ?? null,
    enabled: item.enabled,
    status: item.status,
    source: pluginSource(item),
  };
}
