// Writes the user's own daemon's saved hosts and plugin list (read only, no connection strings) to the given file,
// for a before/after comparison by hand.
import fs from "node:fs";
import { ownerHubSnapshot } from "./common.mjs";

const snapshot = await ownerHubSnapshot();
if (snapshot === null) {
  console.log("the user's daemon is not running");
  process.exit(1);
}
fs.writeFileSync(process.argv[2], snapshot);
console.log(`hosts=${JSON.parse(snapshot).hosts.length}`);
process.exit(0);
