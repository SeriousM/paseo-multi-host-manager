// Release canary: testenv up -> integration suite -> testenv down, then a compact pass/fail table.
// Always runs down (also after a failure or Ctrl-C) and compares the hub snapshot before and after.
//
// Usage: npm run matrix [-- --paseo <version|beta>]
// Local only: needs the Paseo desktop app, a running hub on 127.0.0.1:6767 and WSL (Debian).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envDir, hubSnapshot, readJson, root, secretsPath, statePath, winDir } from "./common.mjs";

const flag = process.argv.indexOf("--paseo");
const paseo = flag === -1 ? null : process.argv[flag + 1];
if (flag !== -1 && !paseo) {
  console.error("--paseo expects a version (e.g. 0.14.0), beta or latest");
  process.exit(2);
}
if (fs.existsSync(statePath)) {
  console.error("A testenv already exists (.testenv/). Run `node testenv/down.mjs` first.");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsPath = path.join(envDir, "matrix-results.json");
let current = null;
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) return;
  interrupted = true;
  console.error("\ninterrupted: tearing the testenv down");
  if (current?.pid) spawnSync("taskkill", ["/pid", String(current.pid), "/t", "/f"], { windowsHide: true });
});

/** Runs a child process, capturing its output; resolves with the exit code. */
function stage(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, windowsHide: true });
    current = child;
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("close", (code) => {
      current = null;
      resolve({ code: code ?? 1, output });
    });
  });
}

let redactions = [];
const redact = (text) => redactions.reduce((t, secret) => t.split(secret).join("***"), text);
const tail = (text, lines = 15) => redact(text.trim().split("\n").slice(-lines).join("\n"));

const CATEGORIES = ["reach", "list", "RPC", "install/remove/update", "git install", "password", "relay", "idle row", "lockout guards"];

function classify(test) {
  const name = [...test.ancestorTitles, test.title].join(" > ");
  if (test.file.endsWith("git-install.test.ts")) return "git install";
  if (/wrong-password/.test(name)) return "password";
  if (/lockout confirmation/.test(name)) return "lockout guards";
  if (/plugin lifecycle/.test(name)) return "install/remove/update";
  if (/leaks no/.test(name)) return "list";
  if (/idle row/.test(name)) return "idle row";
  if (/relay/.test(name)) return "relay";
  if (/lists hub, W and L as ok|shows the hub and W and L/.test(name)) return "reach";
  if (test.file.endsWith("companion.test.ts")) return "RPC";
  return "list";
}

function summarize(report) {
  const rows = new Map(CATEGORIES.map((name) => [name, { passed: 0, failed: [], skipped: 0 }]));
  for (const suite of report.testResults) {
    for (const t of suite.assertionResults) {
      const row = rows.get(classify({ ...t, file: suite.name }));
      if (t.status === "passed") row.passed += 1;
      else if (t.status === "failed") row.failed.push({ name: [...t.ancestorTitles, t.title].join(" > "), message: (t.failureMessages ?? []).join("\n") });
      else row.skipped += 1;
    }
  }
  return rows;
}

const before = await hubSnapshot();
let state = null;
let testsOk = false;
let rows = null;
let failureNote = "";

try {
  const upArgs = [path.join(here, "up.mjs"), ...(paseo ? ["--paseo", paseo] : [])];
  console.log(`testenv up${paseo ? ` (--paseo ${paseo})` : ""} ...`);
  const up = await stage(upArgs);
  state = readJson(statePath);
  redactions = Object.values(readJson(secretsPath) ?? {}).filter((s) => typeof s === "string" && s.length > 0);
  if (up.code !== 0) {
    failureNote = `testenv up failed:\n${tail(up.output)}`;
  } else if (!interrupted) {
    console.log("integration suite ...");
    const vitest = path.join(root, "node_modules", "vitest", "vitest.mjs");
    const run = await stage([vitest, "run", "--config", "vitest.integration.config.ts", "--reporter=json", `--outputFile=${resultsPath}`], { MHM_TESTENV: "1" });
    const report = readJson(resultsPath);
    if (report) {
      rows = summarize(report);
      testsOk = run.code === 0 && report.numFailedTests === 0 && report.numTotalTests > 0;
    } else {
      failureNote = `vitest produced no report:\n${tail(run.output)}`;
    }
  }
} finally {
  console.log("testenv down ...");
  const down = await stage([path.join(here, "down.mjs")]);
  if (down.code !== 0) failureNote += `\ntestenv down failed:\n${tail(down.output)}`;
}

let hubOk = false;
try {
  hubOk = (await hubSnapshot()) === before;
} catch (e) {
  failureNote += `\nhub snapshot after failed: ${redact(String(e)).slice(0, 200)}`;
}
const gone = !fs.existsSync(envDir) && !fs.existsSync(winDir);

const pad = (text, width) => String(text).padEnd(width);
console.log(`\nPaseo ${paseo ?? "default"}: W ${state?.windows?.version ?? "?"}, L ${state?.wsl?.version ?? "?"}`);
if (rows) {
  console.log(`${pad("check", 24)}${pad("passed", 8)}${pad("failed", 8)}result`);
  for (const [name, row] of rows) {
    const result = row.failed.length > 0 ? "FAIL" : row.passed > 0 ? "PASS" : "n/a";
    console.log(`${pad(name, 24)}${pad(row.passed, 8)}${pad(row.failed.length, 8)}${result}${row.skipped ? ` (${row.skipped} skipped)` : ""}`);
  }
  for (const row of rows.values()) {
    for (const f of row.failed) console.log(`\nFAILED ${f.name}\n${redact(f.message.trim().split("\n").slice(0, 8).join("\n"))}`);
  }
}
console.log(`${pad("hub unchanged", 24)}${hubOk ? "PASS" : "FAIL"}`);
console.log(`${pad("testenv removed", 24)}${gone ? "PASS" : "FAIL"}`);
if (failureNote) console.log(`\n${failureNote.trim()}`);

const ok = testsOk && hubOk && gone && !interrupted && !failureNote;
console.log(`\nmatrix ${ok ? "PASSED" : "FAILED"}`);
process.exit(ok ? 0 : 1);
