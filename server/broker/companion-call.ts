import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import type { HostFailure } from "../../shared/contracts";
import type { DaemonClient } from "./daemon-client";
import { hostFailure } from "./failures";

/** Calls an RPC of our own plugin on the host behind `client` and parses the answer with the contract's schema. */
export async function callCompanion<Input extends ZodType, Output extends ZodType>(
  client: DaemonClient,
  rpc: PluginRpcContract<Input, Output>,
  input: ZodInput<Input>,
): Promise<ZodOutput<Output>> {
  return rpc.output.parse(await client.invokePluginRpc(OWN_PLUGIN_ID, rpc.name, input));
}

/** Our plugin must be running on the host before a companion RPC; a clear reason beats a transport error. */
export async function companionBlocker(client: DaemonClient): Promise<HostFailure | null> {
  const own = (await client.listPlugins()).find((plugin) => plugin.id === OWN_PLUGIN_ID);
  if (!own) return hostFailure("unsupported_capability", "companion_missing");
  return own.enabled && own.status === "running" ? null : hostFailure("capability_disabled", "companion_disabled");
}
