/** Models host settings UI importing a pack config-mutation module (see open PR #36). */
import { parseMarbleOptions } from "../../../plugins/src/marble-run/frontend/config";

export function run(): void {
  parseMarbleOptions({ preset: "classic" });
}
