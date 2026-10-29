// Writes the hub's saved hosts and plugin list (no connection strings) to the given file, for before/after comparison.
import fs from "node:fs";
import { hubSnapshot } from "./common.mjs";

const snapshot = await hubSnapshot();
fs.writeFileSync(process.argv[2], snapshot);
console.log(`hosts=${JSON.parse(snapshot).hosts.length}`);
process.exit(0);
