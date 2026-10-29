// Installs the packed plugin like a registry install (npm pack, extract, npm ci --omit=dev) on the hub, W and L, and removes it from the hub.
import fs from "node:fs";
import path from "node:path";
import { envDir, hubClient, root, run, sleep, winHome, winPaseo, wsl, wslDir, wslHome, wslPaseo } from "./common.mjs";

export const PLUGIN_ID = "paseo-multi-host-manager";
const packDir = path.join(envDir, "pack");
export const hubPluginDir = path.join(envDir, "plugin-hub");
export const winPluginDir = path.join(envDir, "plugin-w");
const wslPluginDir = `${wslDir}/plugin`;

function must(r, what) {
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${(r.err || r.out).slice(0, 500)}`);
  return r.out;
}

const toWslPath = (file) => file.replace(/^([A-Za-z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replaceAll("\\", "/");

export function packTarball() {
  fs.mkdirSync(packDir, { recursive: true });
  const out = must(run("cmd", ["/c", "npm", "pack", "--ignore-scripts", "--json", "--pack-destination", packDir, root]), "npm pack");
  return path.join(packDir, JSON.parse(out)[0].filename);
}

export function installWindowsPackage(tarball) {
  fs.mkdirSync(hubPluginDir, { recursive: true });
  must(run("tar", ["-xzf", path.basename(tarball), "-C", path.relative(packDir, hubPluginDir), "--strip-components=1"], undefined, packDir), "extract package");
  // Not below any node_modules: a directory plugin resolves modules from ancestors, which would hide a missing dependency.
  must(run("cmd", ["/c", "npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", hubPluginDir]), "npm ci (Windows)");
  fs.cpSync(hubPluginDir, winPluginDir, { recursive: true });
}

export function installLinuxPackage(tarball) {
  must(
    wsl(`set -e; rm -rf ${wslPluginDir}; mkdir -p ${wslPluginDir}; tar -xzf ${toWslPath(tarball)} -C ${wslPluginDir} --strip-components=1; cd ${wslPluginDir}; PATH=${wslDir}/tools/node/bin:$PATH npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null`),
    "install package (WSL)",
  );
}

export async function waitRunning(list) {
  for (let i = 0; i < 40; i++) {
    const plugin = (await list()).find((p) => p.id === PLUGIN_ID);
    if (plugin?.status === "running") return;
    if (plugin?.status === "error" || plugin?.error) throw new Error(`plugin failed: ${plugin.error ?? plugin.status}`);
    await sleep(500);
  }
  throw new Error("plugin did not reach running");
}


/** Idempotent: refuses to touch a hub that already has a plugin with this id and does not belong to us (state.hubPlugin). */
export async function installPlugin(state, save) {
  const hub = await hubClient();
  try {
    if ((await hub.listPlugins()).some((p) => p.id === PLUGIN_ID)) throw new Error(`hub already has plugin ${PLUGIN_ID}; refusing to touch it`);
    const tarball = packTarball();
    installWindowsPackage(tarball);
    installLinuxPackage(tarball);
    state.hubPlugin = PLUGIN_ID;
    save();
    await hub.installDirectoryPlugin(hubPluginDir);
    must(winPaseo("plugin", "add", winPluginDir, "--home", winHome), "install on W");
    must(wsl(`${wslPaseo} plugin add ${wslPluginDir} --home ${wslHome}`), "install on L");
    await waitRunning(() => hub.listPlugins());
    await waitRunning(async () => JSON.parse(must(winPaseo("plugin", "ls", "--json", "--home", winHome), "ls W")));
    await waitRunning(async () => JSON.parse(must(wsl(`${wslPaseo} plugin ls --json --home ${wslHome}`), "ls L")));
  } finally {
    await hub.close();
  }
}

/** Removes the plugin from the hub, only when state says this harness installed it. */
export async function removeHubPlugin(state) {
  if (state?.hubPlugin !== PLUGIN_ID) return;
  const hub = await hubClient();
  try {
    if ((await hub.listPlugins()).some((p) => p.id === PLUGIN_ID)) await hub.removePlugin(PLUGIN_ID);
  } finally {
    await hub.close();
  }
}
