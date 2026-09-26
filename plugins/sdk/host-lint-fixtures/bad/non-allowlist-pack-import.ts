/** Host must not import pack source outside the debt allowlist (cypher-cic). */
import { parseCicLook } from "../../../plugins/src/cypher-cic/frontend/pack";

export function run(): void {
  parseCicLook({});
}
