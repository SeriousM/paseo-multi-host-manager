import * as os from "node:os";
import * as path from "node:path";
import type { z } from "zod";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  configReadRpc,
  hostInfoRpc,
  settingsListRpc,
  settingsReadRpc,
  settingsRestoreRpc,
  settingsWriteRpc,
} from "../../shared/companion-contracts";
import { readConfig } from "./config";
import type { CompanionContext } from "./files";
import { listSettings, readSettings, restoreSettings, writeSettings } from "./plugin-settings";

export type HostInfo = z.output<typeof hostInfoRpc.output>;

export function hostInfo(home: string): HostInfo {
  const relative = path.relative(os.homedir(), home);
  const underHome = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return {
    platform: process.platform,
    arch: process.arch,
    paseoHome: underHome ? `~/${relative.split(path.sep).join("/")}` : null,
  };
}

export function registerCompanion(server: PluginServerContext): void {
  // $PASEO_HOME, falling back to ~/.paseo, resolved per call. A companion.json left by the removed write opt-in is ignored.
  const context = (): CompanionContext => ({ home: process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo") });

  server.handle(hostInfoRpc, () => hostInfo(context().home));
  server.handle(configReadRpc, () => readConfig(context()));
  server.handle(settingsListRpc, () => listSettings(context()));
  server.handle(settingsReadRpc, (input) => readSettings(context(), input));
  server.handle(settingsWriteRpc, (input) => writeSettings(context(), input));
  server.handle(settingsRestoreRpc, (input) => restoreSettings(context(), input));
}
