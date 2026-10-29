// Checks the npm tarball contents with `npm pack --dry-run`: dev-only directories must stay out, the runtime files must be in.
//
// Usage: npm run pack:check
import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", shell: process.platform === "win32" });
if (result.status !== 0) {
  console.error(result.stderr);
  process.exit(1);
}
const files = JSON.parse(result.stdout)[0].files.map((file) => file.path);

const forbiddenPrefixes = ["testenv/", "tools/", "docs/", "test/", ".local/", ".github/", ".testenv/", "node_modules/"];
const required = ["package.json", "paseo-plugin.json", "OVERVIEW.md", "LICENSE", "README.md", "npm-shrinkwrap.json", "index.server.ts", "index.client.tsx"];
const requiredPrefixes = ["client/", "server/", "shared/"];

const problems = [
  ...files.filter((file) => forbiddenPrefixes.some((prefix) => file.startsWith(prefix))).map((file) => `must not be packed: ${file}`),
  ...required.filter((file) => !files.includes(file)).map((file) => `missing from the package: ${file}`),
  ...requiredPrefixes.filter((prefix) => !files.some((file) => file.startsWith(prefix))).map((prefix) => `no files under ${prefix}`),
];

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`${files.length} files in the package; contents OK`);
