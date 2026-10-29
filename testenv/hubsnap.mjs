// Writes the hub's saved hosts and plugin list (no connection strings) to the given file, for before/after comparison.
import fs from "node:fs";
import { hubClient } from "./common.mjs";

const client = await hubClient();
const hosts = (await client.listHosts()).hosts.map((h) => ({ registrationId: h.registrationId, serverId: h.serverId, label: h.label, enabled: h.enabled, target: h.targetDescription }));
const plugins = await client.listPlugins();
fs.writeFileSync(process.argv[2], JSON.stringify({ hosts, plugins }, (k, v) => (k === "status" || k === "lastOnlineAt" || k === "nextRetryAt" || k === "error" ? undefined : v), 2));
console.log(`hosts=${hosts.length}`);
await client.close();
process.exit(0);
