import { fileURLToPath } from "node:url";
import { lintProductionTree, formatViolation } from "./lint-brand-casts-core.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const violations = lintProductionTree(webRoot);
if (violations.length > 0) {
  for (const v of violations) {
    console.error(formatViolation(v));
  }
  process.exit(1);
}
