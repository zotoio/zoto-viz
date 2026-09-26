/**
 * Compile-time guard: present stamps use {@link FrameTs}, not arbitrary {@link MonoMs}.
 * Revert row widens {@link markFrame} to `MonoMs` → tsc reports unused @ts-expect-error.
 */
import { markFrame } from "./fps";
import type { MonoMs } from "./time-ms";

// @ts-expect-error present stamps require host rAF FrameTs, not a bare MonoMs cast
markFrame(performance.now() as MonoMs);
