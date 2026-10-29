import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { connectOriginClient, connectRoutedClient } from "../../server/broker/daemon-client";
import type { DaemonClient, RoutedClient } from "../../server/broker/daemon-client";
import { paseoHome, readHubAddress, readLocalCredential } from "../../server/broker/origin";

export const PLUGIN_ID = "paseo-multi-host-manager";
export const enabled = process.env.MHM_TESTENV === "1";

const root = path.resolve(__dirname, "../..");
const envDir = path.join(root, ".testenv");
const WSL_HOME = "~/mhm-testenv/home";

interface State {
  hubHosts: { key: string; label: string; serverId: string | null; registrationId: string }[];
  windows: { home: string; exe: string };
}

export function readState(): State {
  return JSON.parse(fs.readFileSync(path.join(envDir, "state.json"), "utf8"));
}

export function readSecrets(): { windows: string; wsl: string } {
  return JSON.parse(fs.readFileSync(path.join(envDir, "secrets.json"), "utf8"));
}

/** Script goes through stdin: wsl.exe re-parses argv through a shell. */
export function wsl(script: string): string {
  const r = spawnSync("wsl", ["-d", "Debian", "--", "bash", "-s"], { encoding: "utf8", input: `${script}\n`, windowsHide: true });
  if (r.status !== 0) throw new Error(`wsl failed (${r.status}): ${r.stderr.slice(0, 300)}`);
  return r.stdout;
}

export function relayPairing(): { endpoint: string; key: string } {
  const exe = readState().windows.exe;
  const r = spawnSync("cmd", ["/c", exe, "daemon", "pair", "--home", readState().windows.home, "--relay", "--json"], { encoding: "utf8", windowsHide: true });
  const uri = new URL(JSON.parse(r.stdout).connectionUri);
  return { endpoint: uri.host, key: uri.searchParams.get("key") ?? "" };
}

export function hubHome(): string {
  return paseoHome();
}

export async function connectHub(): Promise<DaemonClient> {
  const home = hubHome();
  const address = readHubAddress(home);
  if (!address) throw new Error("hub paseo.pid not found");
  return connectOriginClient(address.listen, () => readLocalCredential(home));
}

export function routeTo(hub: DaemonClient, key: "W" | "L"): Promise<RoutedClient> {
  const serverId = readState().hubHosts.find((h) => h.key === key)?.serverId;
  if (!serverId) throw new Error(`host ${key} has no serverId`);
  return connectRoutedClient(hub, serverId);
}

/** Connects to W's own daemon with its local credential, bypassing the hub: the way back after a test cut the hub's relay link to W. */
export async function connectDirectW(): Promise<DaemonClient> {
  const home = readState().windows.home;
  const address = readHubAddress(home);
  if (!address) throw new Error("W paseo.pid not found");
  return connectOriginClient(address.listen, () => readLocalCredential(home));
}

/** Reads and writes files below a host's $PASEO_HOME directly, bypassing the hub (test setup only). */
export interface HostFiles {
  read(relative: string): string | null;
  write(relative: string, content: string): void;
  exists(relative: string): boolean;
  remove(relative: string): void;
  /** Octal permission bits as a string (e.g. "600"); null on Windows. */
  mode(relative: string): string | null;
}

function winFiles(): HostFiles {
  const abs = (relative: string) => path.join(readState().windows.home, relative);
  return {
    read: (relative) => (fs.existsSync(abs(relative)) ? fs.readFileSync(abs(relative), "utf8") : null),
    write: (relative, content) => {
      fs.mkdirSync(path.dirname(abs(relative)), { recursive: true });
      fs.writeFileSync(abs(relative), content);
    },
    exists: (relative) => fs.existsSync(abs(relative)),
    remove: (relative) => fs.rmSync(abs(relative), { force: true }),
    mode: () => null,
  };
}

function linuxFiles(): HostFiles {
  const abs = (relative: string) => `${WSL_HOME}/${relative}`;
  return {
    read: (relative) => {
      const out = wsl(`if [ -f ${abs(relative)} ]; then echo present; base64 -w0 ${abs(relative)}; fi`);
      const [flag, body] = out.trim().split("\n");
      return flag === "present" ? Buffer.from(body ?? "", "base64").toString("utf8") : null;
    },
    write: (relative, content) => {
      wsl(`mkdir -p $(dirname ${abs(relative)}) && echo ${Buffer.from(content).toString("base64")} | base64 -d > ${abs(relative)}`);
    },
    exists: (relative) => wsl(`[ -e ${abs(relative)} ] && echo yes || echo no`).trim() === "yes",
    remove: (relative) => void wsl(`rm -f ${abs(relative)}`),
    mode: (relative) => wsl(`stat -c %a ${abs(relative)}`).trim(),
  };
}

export const hostFiles: Record<"W" | "L", HostFiles> = { W: winFiles(), L: linuxFiles() };

export const COMPANION_SETTINGS = `plugin-settings/${PLUGIN_ID}/companion.json`;

export function setConsent(files: HostFiles, allowPluginSettingsWrites: boolean): void {
  files.write(COMPANION_SETTINGS, JSON.stringify({ version: 1, values: { allowPluginSettingsWrites } }));
}
