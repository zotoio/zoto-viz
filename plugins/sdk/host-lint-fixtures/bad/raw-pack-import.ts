/** Vite `?raw` must not pull pack GLSL source into the host bundle. */
import fragmentSrc from "../../../plugins/src/marble-run/sky/fragment.glsl?raw";

export function run(): string {
  return fragmentSrc.slice(0, 32);
}
