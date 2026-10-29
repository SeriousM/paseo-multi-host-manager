import { createHostClient } from "@getpaseo/client/node";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const envDir = path.join(root, ".testenv");
export const statePath = path.join(envDir, "state.json");
export const secretsPath = path.join(envDir, "secrets.json");
// W's home stays outside the repo: plugins installed into it would otherwise resolve modules from the repo's
// node_modules and hide a missing dependency (a Git install on W passed while the same install on L failed).
export const winDir = path.join(os.homedir(), "mhm-testenv");
export const winHome = path.join(winDir, "home-w");
export const wslDir = "~/mhm-testenv";
export const wslHome = `${wslDir}/home`;
// Default Windows CLI is the desktop app's. `up.mjs --paseo <version>` installs @getpaseo/cli into toolsDir and records its path in state.windows.exe.
export const desktopExe = path.join(process.env.LOCALAPPDATA, "Programs", "Paseo", "resources", "bin", "paseo.cmd");
export const toolsDir = path.join(envDir, "tools");
export const winCliDir = path.join(toolsDir, "cli");
export const winCliExe = path.join(winCliDir, "node_modules", ".bin", "paseo.cmd");
// The testenv's hub is its own throwaway daemon in .testenv, never the user's: up.mjs starts it, down.mjs stops it and
// deletes its home. The user's daemon is only ever read, for the before/after snapshot (`ownerHubSnapshot`).
export const hubHome = path.join(envDir, "home-hub");
export const HUB_PORT = 6770;
export const hubAddress = `127.0.0.1:${HUB_PORT}`;
const ownerHome = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
const ownerAddress = "127.0.0.1:6767";
export const wslPaseo = `PATH=${wslDir}/tools/node/bin:$PATH ${wslDir}/tools/cli/node_modules/.bin/paseo`;

export function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

export function run(cmd, args, input, cwd, env) {
  const r = spawnSync(cmd, args, { encoding: "utf8", input, cwd, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export const winPaseo = (...args) => run("cmd", ["/c", readJson(statePath)?.windows?.exe ?? desktopExe, ...args]);
// Script goes through stdin: wsl.exe re-parses argv through a shell, which mangles $PATH and quotes.
export const wsl = (script) => run("wsl", ["-d", "Debian", "--", "bash", "-s"], script + "\n");

function connect(address, home, clientId) {
  const client = createHostClient(address, {
    clientId,
    reconnect: { enabled: false },
    localCredential: () => fs.readFileSync(path.join(home, "local-credential"), "utf8").trim(),
  });
  return client.connect().then(() => client);
}

/** The testenv's own hub (127.0.0.1:6770, home .testenv/home-hub). */
export function hubClient() {
  return connect(hubAddress, hubHome, "mhm-testenv");
}

/** `config.json` of the testenv hub: loopback only, no password, no relay of its own (it reaches W and L over theirs). */
export function hubConfig() {
  return JSON.stringify({ version: 1, daemon: { listen: hubAddress, relay: { enabled: false } }, pluginsEnabled: true }, null, 2);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The user's own daemon, read only: its saved hosts and plugin list (no connection strings, no volatile status
 * fields), so the matrix can show the harness left it alone. Null when that daemon is not running.
 */
export async function ownerHubSnapshot() {
  if (!fs.existsSync(path.join(ownerHome, "local-credential"))) return null;
  let client;
  try {
    client = await connect(ownerAddress, ownerHome, "mhm-testenv-snapshot");
  } catch {
    return null;
  }
  try {
    const hosts = (await client.listHosts()).hosts.map((h) => ({ registrationId: h.registrationId, serverId: h.serverId, label: h.label, enabled: h.enabled, target: h.targetDescription }));
    const plugins = await client.listPlugins();
    return JSON.stringify({ hosts, plugins }, (k, v) => (k === "status" || k === "lastOnlineAt" || k === "nextRetryAt" || k === "error" ? undefined : v), 2);
  } finally {
    await client.close();
  }
}
