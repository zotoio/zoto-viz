/** Bad pack: sdk-shaped traversal into web/src (must fail bundle + lint). */
import { pluginModuleUrl } from "../../../sdk/../../../web/src/plugins/host";

export function probe(): string {
  return String(pluginModuleUrl);
}
