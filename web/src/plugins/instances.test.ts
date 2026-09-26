import { describe, expect, it } from "vitest";
import {
  applyInstance,
  configStoreId,
  configStoreIdForMode,
  expandPluginInstances,
  mosaicTileViewId,
  parsePluginId,
  parsePluginInstance,
  pluginViewId,
} from "./instances";
import type { PluginView } from "./plugin";

const pack = (over: Partial<PluginView> = {}): PluginView => ({
  id: "carousel",
  name: "Carousel",
  version: 1,
  engine: "carousel",
  config: [
    { key: "source", label: "source", type: "text", default: "nasa" },
    { key: "filter", label: "filter", type: "select", values: [["has-image", "pictured"], ["all", "all"]], default: "has-image" },
  ],
  ...over,
});

describe("plugin instances", () => {
  it("parsePluginId ignores mosaic slot suffix", () => {
    expect(parsePluginId("plugin:carousel!2")).toBe("carousel");
  });

  it("strips mosaic duplicate-tile slot suffix for config store lookup", () => {
    expect(mosaicTileViewId("plugin:carousel!2")).toBe("plugin:carousel");
    expect(mosaicTileViewId("plugin:foo!bar")).toBe("plugin:foo!bar");
    expect(mosaicTileViewId("plugin:foo!2")).toBe("plugin:foo");
    expect(configStoreIdForMode("plugin:carousel:apod!1")).toBe("carousel:apod");
    expect(configStoreIdForMode("plugin:carousel!0")).toBe("carousel");
  });

  it("keeps the primary view id and namespaces extras", () => {
    expect(pluginViewId("carousel")).toBe("plugin:carousel");
    expect(pluginViewId("carousel", "carousel")).toBe("plugin:carousel");
    expect(pluginViewId("carousel", "apod")).toBe("plugin:carousel:apod");
    expect(parsePluginId("plugin:carousel:apod")).toBe("carousel");
    expect(parsePluginInstance("plugin:carousel:apod")).toBe("apod");
    expect(parsePluginInstance("plugin:carousel")).toBeNull();
    expect(configStoreId({ id: "carousel", instanceId: "apod" })).toBe("carousel:apod");
    expect(configStoreId({ id: "koi-pond", instanceId: "pond-1" })).toBe("koi-pond:pond-1");
  });

  it("expands one plugin tree into catalog rows with source defaults", () => {
    const rows = expandPluginInstances(pack({
      instances: [
        { id: "carousel", name: "NASA IOTD", source: "nasa" },
        { id: "apod", name: "APOD", source: "apod" },
      ],
    }));
    expect(rows).toHaveLength(2);
    expect(pluginViewId(rows[0]!.id, rows[0]!.instanceId)).toBe("plugin:carousel");
    expect(pluginViewId(rows[1]!.id, rows[1]!.instanceId)).toBe("plugin:carousel:apod");
    expect(rows[1]!.name).toBe("APOD");
    expect(rows[1]!.config?.find((f) => f.key === "source")?.default).toBe("apod");
  });

  it("patches bind defaults onto This view knobs", () => {
    const view = applyInstance(pack(), { id: "met", source: "met", filter: "has-image" });
    expect(view.instanceId).toBe("met");
    expect(view.config?.find((f) => f.key === "source")?.default).toBe("met");
  });
});
