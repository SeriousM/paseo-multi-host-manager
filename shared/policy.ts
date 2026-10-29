import { defineSettings } from "@getpaseo/plugin";
import { brokerPolicySchema } from "./contracts";
import type { BrokerPolicy } from "./contracts";

/**
 * The user's broker policy, sent with every grid load, apply and document read. Paseo has only host-scoped settings,
 * so it lives on the host the screen talks to, which is the hub: the same daemon that enforces it. The server registers
 * it, the client reads and saves it.
 */
export const brokerSettings = defineSettings({ id: "broker", scope: "host", version: 1, schema: brokerPolicySchema });

export const DEFAULT_POLICY: BrokerPolicy = { allowPrerelease: false, insecureLinkRegistrationIds: [] };
