import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

interface NpmTree {
  version?: string;
  dependencies?: Record<string, NpmTree>;
}

function protocolVersions(tree: NpmTree): string[] {
  return Object.entries(tree.dependencies ?? {}).flatMap(([name, child]) => [
    ...(name === "@getpaseo/protocol" && child.version ? [child.version] : []),
    ...protocolVersions(child),
  ]);
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}

// @getpaseo/protocol only provides types; at runtime the copy that @getpaseo/client depends on is used.
describe("@getpaseo/protocol", () => {
  it("is an exact, type-only dev dependency", () => {
    const manifest = readJson("package.json");
    expect(manifest.dependencies["@getpaseo/protocol"]).toBeUndefined();
    expect(manifest.devDependencies["@getpaseo/protocol"]).toMatch(/^\d+\.\d+\.\d+$/);
    const files = ["index.server.ts", "index.client.tsx", ...sourceFiles("server"), ...sourceFiles("shared"), ...sourceFiles("client")];
    const valueImports = files.flatMap((file) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .filter((line) => /from "@getpaseo\/protocol/.test(line) && !/^import type /.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );
    expect(valueImports).toEqual([]);
  });

  it("resolves to one version, the one @getpaseo/client depends on", () => {
    // `npm` is a .cmd shim on Windows, which needs a shell; the arguments are fixed.
    const result = spawnSync("npm", ["ls", "@getpaseo/protocol", "--json", "--all"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
    expect(result.status, result.stderr).toBe(0);
    const versions = new Set(protocolVersions(JSON.parse(result.stdout)));
    const clientWants = readJson("node_modules/@getpaseo/client/package.json").dependencies["@getpaseo/protocol"];
    expect([...versions]).toEqual([clientWants]);
    expect(readJson("package.json").devDependencies["@getpaseo/protocol"]).toBe(clientWants);
  });
});
