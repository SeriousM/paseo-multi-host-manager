import type { PluginServerContext } from "@getpaseo/plugin/server";
import { applyPollRpc, applyStartRpc, docReadRpc, gridLoadRpc, hostAddRpc, hostsOverviewRpc, pingRpc } from "./shared/contracts";
import { addHost } from "./server/broker/host-add";
import { paseoHome } from "./server/broker/origin";
import { connectHubOrigin, OriginSession } from "./server/broker/origin-session";
import { hostsOverview } from "./server/broker/overview";
import { registerCompanion } from "./server/companion";
import { applyItems } from "./server/rpc/apply";
import { ApplyJobs } from "./server/rpc/apply-jobs";
import { readDoc } from "./server/rpc/doc";
import { loadGrid } from "./server/rpc/grid";
import { brokerSettings } from "./shared/policy";

export default function contribute(server: PluginServerContext) {
  const home = paseoHome();
  const origin = new OriginSession(() => connectHubOrigin(home));
  server.handle(pingRpc, () => ({ ok: true as const }));
  server.handle(hostsOverviewRpc, async (policy) => ({ hosts: await hostsOverview(origin, home, policy) }));
  server.handle(gridLoadRpc, async (policy) => ({ hosts: await loadGrid(origin, home, policy) }));
  // A direct action, not staged: saving a host changes only the hub's directory, and the user confirms it in its dialog.
  server.handle(hostAddRpc, (input) => addHost(origin, home, input));
  // The UI applies through a job: a plugin RPC has 30 s on the daemon, one host's install can take longer. There is no
  // synchronous apply handler, so nothing can bypass the job's one-at-a-time guard.
  const jobs = new ApplyJobs();
  server.handle(applyStartRpc, ({ items, ...policy }) => jobs.start(items, (onSettle) => applyItems(origin, home, policy, items, undefined, onSettle)));
  server.handle(applyPollRpc, ({ jobId }) => jobs.poll(jobId));
  server.handle(docReadRpc, ({ host, pluginId, settingsId, ...policy }) => readDoc(origin, home, policy, { host, pluginId, settingsId }));
  // Registered so the client can read and save it with useSettings; the server takes the policy from each call.
  server.registerSettings(brokerSettings);
  registerCompanion(server);
  return () => origin.close();
}
