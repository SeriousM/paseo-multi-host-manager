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
export const paseoExe = path.join(process.env.LOCALAPPDATA, "Programs", "Paseo", "resources", "bin", "paseo.cmd");
export const hubHome = process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo");
export const hubAddress = "127.0.0.1:6767";
export const wslPaseo = `PATH=${wslDir}/tools/node/bin:$PATH ${wslDir}/tools/cli/node_modules/.bin/paseo`;

export function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

export function run(cmd, args, input, cwd) {
  const r = spawnSync(cmd, args, { encoding: "utf8", input, cwd, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export const winPaseo = (...args) => run("cmd", ["/c", paseoExe, ...args]);
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
