// Stops the testenv's hub, W and L, and deletes their homes and .testenv. Idempotent. Never contacts the user's own
// daemon: the hosts and plugins the testenv saved live in its own hub's home, which goes with .testenv.
import fs from "node:fs";
import { desktopExe, envDir, hubHome, readJson, run, statePath, winDir, winHome, winPaseo, wsl, wslDir, wslHome, wslPaseo } from "./common.mjs";

const state = readJson(statePath);
if (fs.existsSync(hubHome)) run("cmd", ["/c", state?.hub?.exe ?? desktopExe, "daemon", "stop", "--home", hubHome, "--force"]);
if (fs.existsSync(winHome)) winPaseo("daemon", "stop", "--home", winHome, "--force");
wsl(`if [ -x ${wslDir}/tools/cli/node_modules/.bin/paseo ] && [ -d ${wslHome} ]; then ${wslPaseo} daemon stop --home ${wslHome} --force; fi; rm -rf ${wslDir}`);
// The daemon starts a speech-model download whose tar.exe can outlive it and lock the home; kill anything still referencing it.
for (const dir of [envDir, winDir]) {
  run("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${dir.replaceAll("'", "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 500 }); // the daemon may still hold model download dirs briefly
}
console.log("testenv down.");
process.exit(0);
