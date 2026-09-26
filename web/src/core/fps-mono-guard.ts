/**
 * Compile-time guard: present stamps use {@link MonoMs}, not {@link WallMs}.
 * Revert row widens {@link markFrame} to `number` → tsc reports unused @ts-expect-error.
 */
import { markFrame } from "./fps";
import { monoMs, wallMs } from "./time-ms";

markFrame(monoMs(0));
// @ts-expect-error present stamps require monotonic host time, not wall clock branding
markFrame(wallMs(0));
