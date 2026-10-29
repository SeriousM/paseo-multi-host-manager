// Creates two throwaway Paseo daemons (Windows :6768, WSL Debian :6769) and saves them on the hub plus a wrong-password entry.
// `--paseo <version|beta>` runs W and L on that daemon version (npm @getpaseo/cli); the default is the desktop app's CLI on W and 0.13.2 on L.
// `--demo` builds the listing-screenshot setup instead, with its own throwaway hub (see demo.mjs).
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { demoUp } from "./demo.mjs";
import { installPlugin } from "./plugin.mjs";
import { desktopExe, hubClient, run, secretsPath, sleep, statePath, winCliDir, winCliExe, winHome, winPaseo, wsl, wslDir, wslHome, wslPaseo } from "./common.mjs";

const NODE_VERSION = "22.19.0";
if (process.argv.includes("--demo")) {
  try {
    await demoUp();
    process.exit(0);
  } catch (error) {
    console.error(String(error?.stack ?? error).slice(0, 1500));
    console.error("demo setup failed; run down.mjs to clean up.");
    process.exit(1);
  }
}
const flag = process.argv.indexOf("--paseo");
const requested = flag === -1 ? null : process.argv[flag + 1];
if (flag !== -1 && !/^(beta|latest|\d+\.\d+\.\d+(-[\w.]+)?)$/.test(requested ?? "")) {
  console.error("--paseo expects a version (e.g. 0.13.0), beta or latest");
  process.exit(1);
}
if (fs.existsSync(statePath)) {
  console.error("testenv already up (or half-up). Run down.mjs first.");
  process.exit(1);
}
fs.mkdirSync(winHome, { recursive: true });
const state = { paseo: requested ?? "default", hubHosts: [], windows: { port: 6768, home: winHome, exe: requested ? winCliExe : desktopExe }, wsl: { distro: "Debian", port: 6769, home: wslHome } };
const secrets = { windows: randomBytes(12).toString("hex"), wsl: randomBytes(12).toString("hex") };
const save = () => {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
};
const must = (r, what) => {
  if (r.code !== 0) {
    console.error(`${what} failed (exit ${r.code}): ${r.err.slice(0, 500)}`);
    process.exit(1);
  }
  return r.out;
};
const config = (port, password) =>
  JSON.stringify({ version: 1, daemon: { listen: `127.0.0.1:${port}`, relay: { enabled: true }, auth: { password: bcrypt.hashSync(password, 10) } }, pluginsEnabled: true }, null, 2);
const pairUri = (out) => {
  const uri = JSON.parse(out).connectionUri;
  if (!uri) throw new Error("no connectionUri in pair output");
  return uri;
};

save();
// Host W
if (requested) {
  fs.mkdirSync(winCliDir, { recursive: true });
  must(run("cmd", ["/c", "npm", "install", "--prefix", winCliDir, "--no-audit", "--no-fund", "--ignore-scripts", `@getpaseo/cli@${requested}`]), `install @getpaseo/cli@${requested} (Windows)`);
}
state.windows.version = must(winPaseo("--version"), "W version").trim();
save();
fs.writeFileSync(path.join(winHome, "config.json"), config(6768, secrets.windows));
must(winPaseo("daemon", "start", "--home", winHome), "start W");
const connW = pairUri(must(winPaseo("daemon", "pair", "--home", winHome, "--relay", "--json"), "pair W"));

// Host L: Node + CLI are installed under the throwaway dir because the distro has none.
must(wsl(`mkdir -p ${wslHome} && cd ${wslDir} && if [ ! -x tools/node/bin/node ]; then mkdir -p tools/node tools/cli && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz | tar -xJ -C tools/node --strip-components=1 && cd tools/cli && PATH=${wslDir}/tools/node/bin:$PATH npm i --no-audit --no-fund @getpaseo/cli@${requested ?? "0.13.2"} >/dev/null; fi`), "install WSL tooling");
state.wsl.version = must(wsl(`${wslPaseo} --version`), "L version").trim();
save();
must(wsl(`echo ${Buffer.from(config(6769, secrets.wsl)).toString("base64")} | base64 -d > ${wslHome}/config.json`), "write L config");
must(wsl(`${wslPaseo} daemon start --home ${wslHome}`), "start L");
const connL = pairUri(must(wsl(`${wslPaseo} daemon pair --home ${wslHome} --relay --json`), "pair L"));

// Hub registration
const addUrl = (uri, password) => {
  const u = new URL(uri);
  if (password) u.searchParams.set("password", password);
  return u.toString();
};
const hub = await hubClient();
const entries = [
  ["W", "mhm-test-W", addUrl(connW, secrets.windows)],
  ["L", "mhm-test-L", addUrl(connL, secrets.wsl)],
  ["W-wrongpw", "mhm-test-W-wrongpw", addUrl(connW, "wrong-password")],
];
for (const [key, label, connection] of entries) {
  const r = await hub.addHost({ connection, label });
  state.hubHosts.push({ key, label, registrationId: r.registrationId, serverId: r.serverId ?? null });
  save();
}
await sleep(8000);
const listed = (await hub.listHosts()).hosts;
for (const h of state.hubHosts) h.serverId = listed.find((x) => x.registrationId === h.registrationId)?.serverId ?? h.serverId;
save();
await hub.close();
await installPlugin(state, save);
console.log("testenv up. Metadata in .testenv/state.json; run status.mjs.");
process.exit(0);
