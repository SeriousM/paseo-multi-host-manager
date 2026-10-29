import type { PluginRpcContract } from "@getpaseo/plugin";
import type { ZodType, input as ZodInput, output as ZodOutput } from "zod";
import { OWN_PLUGIN_ID } from "../../shared/companion-contracts";
import type { DaemonClient } from "./daemon-client";

/** Calls an RPC of our own plugin on the host behind `client` and parses the answer with the contract's schema. */
export async function callCompanion<Input extends ZodType, Output extends ZodType>(
  client: DaemonClient,
  rpc: PluginRpcContract<Input, Output>,
  input: ZodInput<Input>,
): Promise<ZodOutput<Output>> {
  return rpc.output.parse(await client.invokePluginRpc(OWN_PLUGIN_ID, rpc.name, input));
}
