import type { NestCamsDrawerContext } from "./drawer-context";

declare const withoutDevices: Omit<NestCamsDrawerContext, "devices">;

// @ts-expect-error nest cams drawer context requires devices
export const nestCamsContextMissingDevices: NestCamsDrawerContext = { ...withoutDevices };
