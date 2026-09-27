/** Vite `?url` must not expose pack asset URLs from host code. */
import fragmentUrl from "../../../plugins/src/marble-run/sky/fragment.glsl?url";

export function run(): string {
  return fragmentUrl;
}
