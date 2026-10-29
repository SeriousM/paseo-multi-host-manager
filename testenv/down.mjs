// Removes only the hub hosts recorded in state.json, stops both daemons, deletes both homes and .testenv. Idempotent.
import fs from "node:fs";
import { removeHubPlugin } from "./plugin.mjs";
import { run, envDir, hubClient, readJson, statePath, winHome, winPaseo, wsl, wslDir, wslHome, wslPaseo } from "./common.mjs";

const state = readJson(statePath);
if (state?.hubHosts?.length) {
  try {
    const hub = await hubClient();
    const listed = new Set((await hub.listHosts()).hosts.map((h) => h.registrationId));
    for (const h of state.hubHosts) if (listed.has(h.registrationId)) await hub.removeHost(h.registrationId);
    await hub.close();
  } catch (e) {
    console.error("hub cleanup failed:", String(e).slice(0, 200));
  }
}
try {
  await removeHubPlugin(state);
} catch (e) {
  console.error("hub plugin removal failed:", String(e).slice(0, 200));
}
if (fs.existsSync(winHome)) winPaseo("daemon", "stop", "--home", winHome, "--force");
wsl(`if [ -x ${wslDir}/tools/cli/node_modules/.bin/paseo ] && [ -d ${wslHome} ]; then ${wslPaseo} daemon stop --home ${wslHome} --force; fi; rm -rf ${wslDir}`);
// The daemon starts a speech-model download whose tar.exe can outlive it and lock the home; kill anything still referencing it.
run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${envDir.replaceAll("'", "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
fs.rmSync(envDir, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 }); // the daemon may still hold model download dirs briefly
console.log("testenv down.");
process.exit(0);
