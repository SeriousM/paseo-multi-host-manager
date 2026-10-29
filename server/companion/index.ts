import * as os from "node:os";
import * as path from "node:path";
import type { z } from "zod";
import { defineSettings } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  configReadRpc,
  configWriteKeysRpc,
  consentSchema,
  hostInfoRpc,
  settingsListRpc,
  settingsReadRpc,
  settingsRestoreRpc,
  settingsWriteRpc,
  type Consent,
} from "../../shared/companion-contracts";
import { readConfig, writeConfigKeys } from "./config";
import type { CompanionContext } from "./files";
import { listSettings, readSettings, restoreSettings, writeSettings } from "./plugin-settings";

export const companionSettings = defineSettings({ id: "companion", scope: "host", version: 1, schema: consentSchema });

export type HostInfo = z.output<typeof hostInfoRpc.output>;

const NO_CONSENT: Consent = { allowConfigWrites: false, allowPluginSettingsWrites: false };

export function hostInfo(home: string, consent: Consent): HostInfo {
  const relative = path.relative(os.homedir(), home);
  const underHome = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    nodeVersion: process.version,
    paseoHome: underHome ? `~/${relative.split(path.sep).join("/")}` : null,
    consent,
  };
}

export function registerCompanion(server: PluginServerContext): void {
  const settings = server.registerSettings(companionSettings);
  const consent = async (): Promise<Consent> => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : NO_CONSENT;
  };
  // $PASEO_HOME, falling back to ~/.paseo, resolved per call.
  const context = (): CompanionContext => ({ home: process.env.PASEO_HOME ?? path.join(os.homedir(), ".paseo"), consent });

  server.handle(hostInfoRpc, async () => hostInfo(context().home, await consent()));
  server.handle(configReadRpc, () => readConfig(context()));
  server.handle(configWriteKeysRpc, (input) => writeConfigKeys(context(), input));
  server.handle(settingsListRpc, () => listSettings(context()));
  server.handle(settingsReadRpc, (input) => readSettings(context(), input));
  server.handle(settingsWriteRpc, (input) => writeSettings(context(), input));
  server.handle(settingsRestoreRpc, (input) => restoreSettings(context(), input));
}
