// Preloaded into demo daemons (NODE_OPTIONS=--require=...): Paseo labels a hub with os.hostname(), and listing
// screenshots must not show the machine's real name. Without MHM_DEMO_HOSTNAME it changes nothing.
const os = require("node:os");
const name = process.env.MHM_DEMO_HOSTNAME;
if (name) {
  os.hostname = () => name;
  require("node:module").syncBuiltinESMExports();
}
