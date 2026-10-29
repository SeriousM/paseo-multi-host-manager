import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pingRpc } from "../../shared/contracts";
import type { DaemonClient, RoutedClient } from "../../server/broker/daemon-client";
import { connectHub, enabled, routeTo } from "./env";

// A Git install runs only the manifest `build` before Paseo bundles the checkout, unlike the directory installs of
// the testenv, which run npm ci themselves. This installs the plugin the way `paseo plugin add git:...` does.
const GIT_ID = "mhm-git-check";
const root = path.resolve(__dirname, "../..");
const bare = path.join(root, ".testenv", "git-src.git");

function git(...args: string[]): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.slice(0, 300)}`);
  return r.stdout.trim();
}

/** A bare repository whose main branch holds the tracked files as they are now, uncommitted edits included. */
function publishWorkingTree(): void {
  fs.rmSync(bare, { recursive: true, force: true });
  git("init", "-q", "--bare", "--initial-branch=main", bare);
  const commit = git("stash", "create") || git("rev-parse", "HEAD");
  git("push", "-q", bare, `${commit}:refs/heads/main`);
}

const sources = {
  W: pathToFileURL(bare).href,
  L: `file://${bare.replace(/^([A-Za-z]):\\/, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/")}`,
};

describe.each(["W", "L"] as const)("git install on %s through the hub", (key) => {
  if (!enabled) return it.skip("needs MHM_TESTENV=1");

  let hub: DaemonClient;
  let routed: RoutedClient;
  let host: DaemonClient;
  const installed = async () => (await host.listPlugins()).find((plugin) => plugin.id === GIT_ID);

  beforeAll(async () => {
    if (key === "W") publishWorkingTree();
    hub = await connectHub();
    routed = await routeTo(hub, key);
    host = routed.client;
    if (await installed()) await host.removePlugin(GIT_ID);
  });
  afterAll(async () => {
    if (host && (await installed().catch(() => undefined))) await host.removePlugin(GIT_ID).catch(() => undefined);
    await routed?.close();
    await hub?.close();
  });

  it("installs from a Git source, runs and answers mhm.ping, then removes", { timeout: 180_000 }, async () => {
    await host.installPluginSource({ source: sources[key], id: GIT_ID });
    // The daemon starts the plugin after the install returns; poll its list rather than guess a delay.
    await vi.waitFor(
      async () => {
        const plugin = await installed();
        expect(plugin?.error ?? null).toBeNull();
        expect(plugin?.status).toBe("running");
      },
      { timeout: 30_000, interval: 500 },
    );
    expect(pingRpc.output.parse(await host.invokePluginRpc(GIT_ID, pingRpc.name, {}))).toEqual({ ok: true });
    await host.removePlugin(GIT_ID);
    expect(await installed()).toBeUndefined();
  });
});
