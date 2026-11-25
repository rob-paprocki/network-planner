// Print the JavaScript summary for a plan file, for tests/run.sh to compare with `ipplan summary`.
// Usage: node site/scripts/summary-cli.mjs PLAN.json
import { readFileSync } from "node:fs";
import { summary } from "../public/ipplan.js";

process.stdout.write(summary(JSON.parse(readFileSync(process.argv[2], "utf8"))) + "\n");
