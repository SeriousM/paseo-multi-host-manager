// Prints each test host as the hub sees it.
import { hubClient, readJson, statePath } from "./common.mjs";

const state = readJson(statePath);
if (!state) {
  console.log("testenv is down (no .testenv/state.json)");
  process.exit(0);
}
const hub = await hubClient();
const listed = (await hub.listHosts()).hosts;
for (const h of state.hubHosts) {
  const x = listed.find((l) => l.registrationId === h.registrationId);
  console.log(`${h.label}: ${x ? `${x.status}${x.error ? ` ${x.error.code}` : ""}` : "missing on hub"} serverId=${x?.serverId ?? h.serverId}`);
}
await hub.close();
process.exit(0);
