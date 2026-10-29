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
export const winHome = path.join(envDir, "home-w");
export const wslDir = "~/mhm-testenv";
export const wslHome = `${wslDir}/home`;
// Default Windows CLI is the desktop app's. `up.mjs --paseo <version>` installs @getpaseo/cli into toolsDir and records its path in state.windows.exe.
export const desktopExe = path.join(process.env.LOCALAPPDATA, "Programs", "Paseo", "resources", "bin", "paseo.cmd");
export const toolsDir = path.join(envDir, "tools");
export const winCliDir = path.join(toolsDir, "cli");
export const winCliExe = path.join(winCliDir, "node_modules", ".bin", "paseo.cmd");
export const hubHome = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
export const hubAddress = "127.0.0.1:6767";
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

export async function hubClient() {
  const client = createHostClient(hubAddress, {
    clientId: "mhm-testenv",
    reconnect: { enabled: false },
    localCredential: () => fs.readFileSync(path.join(hubHome, "local-credential"), "utf8").trim(),
  });
  await client.connect();
  return client;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The hub's saved hosts and plugin list (no connection strings, no volatile status fields), for before/after comparison. */
export async function hubSnapshot() {
  const client = await hubClient();
  try {
    const hosts = (await client.listHosts()).hosts.map((h) => ({ registrationId: h.registrationId, serverId: h.serverId, label: h.label, enabled: h.enabled, target: h.targetDescription }));
    const plugins = await client.listPlugins();
    return JSON.stringify({ hosts, plugins }, (k, v) => (k === "status" || k === "lastOnlineAt" || k === "nextRetryAt" || k === "error" ? undefined : v), 2);
  } finally {
    await client.close();
  }
}
