import type { GridPlugin, PluginSource } from "../../shared/contracts";
import { hasUrlCredentials } from "../../shared/mask";
import type { PluginListItem } from "../broker/daemon-client";

const DEFAULT_REGISTRY_HOST = "plugins.paseo.sh";

function withPath(source: string, pluginPath: string): string {
  return pluginPath === "." ? source : `${source}:${pluginPath}`;
}

/**
 * Portable identity of a plugin, in the form `installPluginSource` takes, pinned to this host's version where the source
 * allows it (npm `<pkg>@<version>`, git `ref` = installed commit). Never a local path, never a remote with credentials.
 */
export function pluginSource(item: PluginListItem): PluginSource {
  const identity = item.installation?.identity;
  const unpinned = { ref: null, pinned: false };
  if (identity?.kind === "npm" || identity?.kind === "git") {
    if (identity.registry) {
      const host = new URL(identity.registry.url).host;
      return { kind: "registry", installSource: host === DEFAULT_REGISTRY_HOST ? identity.registry.id : `${host}/${identity.registry.id}`, ...unpinned };
    }
    if (identity.kind === "npm") {
      const version = item.npm?.version ?? item.installation?.currentRevision;
      const spec = version ? `${identity.packageName}@${version}` : identity.packageName;
      return { kind: "npm", installSource: withPath(`npm:${spec}`, identity.pluginPath), ref: null, pinned: Boolean(version) };
    }
    if (hasUrlCredentials(identity.remote)) return { kind: "git", installSource: null, ...unpinned };
    const commit = item.installation?.currentRevision ?? item.commit ?? null;
    return { kind: "git", installSource: withPath(`git:${identity.remote}`, identity.pluginPath), ref: commit, pinned: commit !== null };
  }
  if (!identity && item.npm) return { kind: "npm", installSource: `npm:${item.npm.packageName}@${item.npm.version}`, ref: null, pinned: true };
  return { kind: item.source === "git" ? "git" : "directory", installSource: null, ...unpinned };
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
