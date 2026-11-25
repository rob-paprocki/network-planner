// Print the JavaScript checker's findings for a plan file, for tests/run.sh to compare with ipplan.
// Usage: node site/scripts/check-cli.mjs PLAN.json
import { readFileSync } from "node:fs";
import { check } from "../public/ipplan.js";

process.stdout.write(JSON.stringify(check(JSON.parse(readFileSync(process.argv[2], "utf8")))) + "\n");
