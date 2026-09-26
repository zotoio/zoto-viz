import type { PluginField } from "../core/modes";
import type { PackWallScope } from "../plugins/instances";
import type { PluginLook, PluginView } from "../plugins/plugin";
import type { SdmDevice } from "../plugins/nest-cams-look";
import { drawerKeyForModeId, type DrawerKey } from "../graph/mosaic-tile-id";

/** Nest SDM device row (drawer context uses the platform name Device). */
export type Device = SdmDevice;

type DrawerContextBase = {
  key: DrawerKey;
  fields: PluginField[];
  look: PluginLook | null;
  extras: readonly HTMLElement[];
  wallScope: PackWallScope;
  draftValues?: Record<string, string>;
};

export type NestCamsDrawerContext = DrawerContextBase & {
  spec: PluginView & { id: "nest-cams" };
  devices: readonly Device[];
};

export type GenericDrawerContext = DrawerContextBase & {
  spec: PluginView;
};

export type DrawerContext = NestCamsDrawerContext | GenericDrawerContext;

export function isNestCamsDrawerContext(ctx: DrawerContext): ctx is NestCamsDrawerContext {
  return ctx.spec.id === "nest-cams";
}

/** Same inputs as drawer keying: mode id + view bind payload + nest device list. */
export function buildDrawerContext(args: {
  modeId: string;
  spec: PluginView;
  fields?: PluginField[];
  look?: PluginLook | null;
  extras?: HTMLElement[];
  wallScope: PackWallScope;
  nestDevices: readonly Device[];
  draftValues?: Record<string, string>;
}): DrawerContext {
  const modeForKey = args.modeId.trim() || args.spec.id;
  const key = drawerKeyForModeId(modeForKey);
  const base: DrawerContextBase = {
    key,
    fields: args.fields ?? args.spec.config ?? [],
    look: args.look ?? args.spec.look ?? null,
    extras: (args.extras?.filter(Boolean) ?? []) as readonly HTMLElement[],
    wallScope: args.wallScope,
    draftValues: args.draftValues,
  };
  if (args.spec.id === "nest-cams") {
    return {
      ...base,
      spec: args.spec as PluginView & { id: "nest-cams" },
      devices: args.nestDevices,
    };
  }
  return { ...base, spec: args.spec };
}
