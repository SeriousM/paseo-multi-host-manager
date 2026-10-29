// Demo mode for listing screenshots (`node testenv/up.mjs --demo`): everything throwaway, nothing on the user's hub.
// - hub `workstation`: a Windows daemon on 127.0.0.1:6770 (home .testenv/home-hub, no password, loopback only)
// - `laptop`: Windows daemon :6768 behind a password, reached over the relay
// - `build-linux`: WSL Debian daemon :6769 on an older Paseo, reached over the relay
// - `old-server`: the laptop's link with a wrong password (shows a failing host)
// Daemons report neutral host names (demo-hostname.cjs). Our plugin runs on all three, installed from a local bare Git
// repository of the checkout the way `paseo plugin add git:...` installs it, so its row shows a commit instead of "dir".
// A few public plugins, settings and a settings document with a secret make the grid differ. `node testenv/down.mjs`
// removes all of it.
import { createHostClient } from "@getpaseo/client/node";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { envDir, root, run, secretsPath, sleep, statePath, winCliDir, winCliExe, winHome, wsl, wslDir, wslHome, wslPaseo } from "./common.mjs";
import { PLUGIN_ID, waitRunning } from "./plugin.mjs";

const NODE_VERSION = "22.19.0";
const WINDOWS_VERSION = "0.14.0";
const LINUX_VERSION = "0.13.2";
export const DEMO_HUB_PORT = 6770;
const hubHome = path.join(envDir, "home-hub");
const preload = path.join(path.dirname(fileURLToPath(import.meta.url)), "demo-hostname.cjs");

const must = (r, what) => {
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${(r.err || r.out).slice(0, 500)}`);
  return r.out;
};

/** The npm CLI on plain Node: the desktop app's Electron runtime ignores NODE_OPTIONS, which carries the host name. */
function windowsPaseo(hostname, ...args) {
  const env = { ...process.env, MHM_DEMO_HOSTNAME: hostname, NODE_OPTIONS: `--require=${preload}` };
  return run("cmd", ["/c", winCliExe, ...args], undefined, undefined, env);
}

const config = (port, password, relay) =>
  JSON.stringify({ version: 1, daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: relay }, ...(password ? { auth: { password: bcrypt.hashSync(password, 10) } } : {}) }, pluginsEnabled: true }, null, 2);
const pairUri = (out) => JSON.parse(out).connectionUri;
const withPassword = (uri, password) => {
  const url = new URL(uri);
  url.searchParams.set("password", password);
  return url.toString();
};

export function demoHubClient() {
  const client = createHostClient(`127.0.0.1:${DEMO_HUB_PORT}`, {
    clientId: "mhm-testenv-demo",
    reconnect: { enabled: false },
    localCredential: () => fs.readFileSync(path.join(hubHome, "local-credential"), "utf8").trim(),
  });
  return client.connect().then(() => client);
}

/** A bare repository whose main branch holds the checkout's tracked files as they are now, uncommitted edits included. */
function publishCheckout() {
  const bare = path.join(envDir, "demo-git", `${PLUGIN_ID}.git`);
  const git = (...args) => must(run("git", args, undefined, root), `git ${args[0]}`).trim();
  fs.rmSync(bare, { recursive: true, force: true });
  git("init", "-q", "--bare", "--initial-branch=main", bare);
  const commit = git("stash", "create") || git("rev-parse", "HEAD");
  git("push", "-q", bare, `${commit}:refs/heads/main`);
  return {
    windows: pathToFileURL(bare).href,
    linux: `file://${bare.replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/")}`,
  };
}

/** Writes a plugin-settings document (`{version, values}`) into a daemon home. */
function writeDoc(home, pluginId, settingsId, values) {
  const dir = path.join(home, "plugin-settings", pluginId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${settingsId}.json`), JSON.stringify({ version: 1, values }, null, 2));
}

export async function demoUp() {
  if (fs.existsSync(statePath)) throw new Error("testenv already up (or half-up). Run down.mjs first.");
  fs.mkdirSync(winHome, { recursive: true });
  fs.mkdirSync(hubHome, { recursive: true });
  const state = {
    paseo: "demo",
    demo: { hubHome, hubPort: DEMO_HUB_PORT },
    hubHosts: [],
    windows: { port: 6768, home: winHome, exe: winCliExe },
    wsl: { distro: "Debian", port: 6769, home: wslHome },
  };
  const secrets = { windows: randomBytes(12).toString("hex"), wsl: randomBytes(12).toString("hex") };
  const save = () => {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
  };
  save();

  fs.mkdirSync(winCliDir, { recursive: true });
  must(run("cmd", ["/c", "npm", "install", "--prefix", winCliDir, "--no-audit", "--no-fund", "--ignore-scripts", `@getpaseo/cli@${WINDOWS_VERSION}`]), "install the Windows CLI");

  fs.writeFileSync(path.join(hubHome, "config.json"), config(DEMO_HUB_PORT, null, false));
  must(windowsPaseo("workstation", "daemon", "start", "--home", hubHome), "start hub");
  fs.writeFileSync(path.join(winHome, "config.json"), config(6768, secrets.windows, true));
  must(windowsPaseo("laptop", "daemon", "start", "--home", winHome), "start laptop");
  const laptop = pairUri(must(windowsPaseo("laptop", "daemon", "pair", "--home", winHome, "--relay", "--json"), "pair laptop"));

  must(wsl(`mkdir -p ${wslHome} && cd ${wslDir} && if [ ! -x tools/node/bin/node ]; then mkdir -p tools/node tools/cli && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | tar -xJ -C tools/node --strip-components=1 && cd tools/cli && PATH=${wslDir}/tools/node/bin:$PATH npm i --no-audit --no-fund @getpaseo/cli@${LINUX_VERSION} >/dev/null; fi`), "install WSL tooling");
  must(wsl(`echo ${Buffer.from(fs.readFileSync(preload)).toString("base64")} | base64 -d > ${wslDir}/demo-hostname.cjs`), "copy the host name preload");
  must(wsl(`echo ${Buffer.from(config(6769, secrets.wsl, true)).toString("base64")} | base64 -d > ${wslHome}/config.json`), "write build-linux config");
  const linuxEnv = `MHM_DEMO_HOSTNAME=build-linux NODE_OPTIONS=--require=$HOME/mhm-testenv/demo-hostname.cjs`;
  must(wsl(`${linuxEnv} ${wslPaseo} daemon start --home ${wslHome}`), "start build-linux");
  const linux = pairUri(must(wsl(`${wslPaseo} daemon pair --home ${wslHome} --relay --json`), "pair build-linux"));

  const hub = await demoHubClient();
  try {
    for (const [label, connection] of [
      ["laptop", withPassword(laptop, secrets.windows)],
      ["build-linux", withPassword(linux, secrets.wsl)],
      ["old-server", withPassword(laptop, "wrong-password")],
    ]) {
      const added = await hub.addHost({ connection, label });
      state.demo[label] = added.registrationId;
      save();
    }

    const source = publishCheckout();
    // The companion on the hub may write other plugins' documents (opt-in on that host); it is the editor's demo host.
    writeDoc(hubHome, PLUGIN_ID, "companion", { allowPluginSettingsWrites: true });
    writeDoc(hubHome, "keep-awake", "display", { mode: "display", preventSleep: true, notifyAfterMinutes: 30, webhookToken: "sk-demo-0000000000000000" });
    await hub.installPluginSource({ source: source.windows });
    must(windowsPaseo("laptop", "plugin", "add", source.windows, "--home", winHome), "install on laptop");
    must(wsl(`${wslPaseo} plugin add ${source.linux} --home ${wslHome}`), "install on build-linux");
    await waitRunning(() => hub.listPlugins());
    await sleep(8000);

    // Public plugins and settings through the plugin's own apply, like a user would.
    const policy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
    const hubId = (await hub.listHosts()).self.serverId;
    const install = (host, source, pluginId) => ({ id: `${host}-${pluginId}`, host, op: "installPlugin", source, pluginId, confirmed: true });
    const items = [
      install(hubId, "hichamboushaba/keep-awake", "keep-awake"),
      install(hubId, "stv1024/auto-pin", "auto-pin"),
      install(hubId, "kingsleydon/recap", "paseo-recap"),
      install(state.demo.laptop, "hichamboushaba/keep-awake", "keep-awake"),
      install(state.demo["build-linux"], "stv1024/auto-pin", "auto-pin"),
      { id: "linux-auto-pin-off", host: state.demo["build-linux"], op: "setPluginEnabled", pluginId: "auto-pin", enabled: false },
      { id: "hub-sys", host: hubId, op: "setRow", rowId: "sys", value: "Prefer small commits." },
      { id: "laptop-sys", host: state.demo.laptop, op: "setRow", rowId: "sys", value: "Prefer small commits." },
      // New daemons default to off: switch some on so hosts differ.
      { id: "hub-mcp", host: hubId, op: "setRow", rowId: "mcp", value: true },
      { id: "hub-hooks", host: hubId, op: "setRow", rowId: "hooks", value: true },
      { id: "hub-autoarch", host: hubId, op: "setRow", rowId: "autoarch", value: true },
      { id: "laptop-hooks", host: state.demo.laptop, op: "setRow", rowId: "hooks", value: true },
      { id: "linux-sys", host: state.demo["build-linux"], op: "setRow", rowId: "sys", value: "Be concise." },
    ];
    const started = await hub.invokePluginRpc(PLUGIN_ID, "mhm.apply.start", { ...policy, items });
    if (!started.ok) throw new Error("apply refused");
    for (;;) {
      await sleep(1000);
      const job = await hub.invokePluginRpc(PLUGIN_ID, "mhm.apply.poll", { jobId: started.jobId });
      if (job.state === "running") continue;
      const failed = job.results.filter((result) => result.outcome.status !== "ok");
      if (failed.length > 0) console.error("demo items not applied:", failed.map((result) => `${result.id}: ${JSON.stringify(result.outcome)}`).join("; "));
      break;
    }
  } finally {
    await hub.close();
  }
  console.log(`demo up: hub workstation on 127.0.0.1:${DEMO_HUB_PORT} (no password), hosts laptop, build-linux, old-server.`);
}

/** Stops the demo hub; its home is under .testenv and goes with it. */
export function demoDown(state) {
  if (state?.demo?.hubHome && fs.existsSync(state.demo.hubHome) && fs.existsSync(winCliExe)) windowsPaseo("workstation", "daemon", "stop", "--home", state.demo.hubHome, "--force");
}
