import { describe, expect, it } from "vitest";
import {
  applyInstance,
  configStoreId,
  expandPluginInstances,
  parsePluginId,
  parsePluginInstance,
  pluginSpecForStoreId,
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
  it("keeps the primary view id and namespaces extras", () => {
    expect(pluginViewId("carousel")).toBe("plugin:carousel");
    expect(pluginViewId("carousel", "carousel")).toBe("plugin:carousel");
    expect(pluginViewId("carousel", "apod")).toBe("plugin:carousel:apod");
    expect(parsePluginId("plugin:carousel:apod")).toBe("carousel");
    expect(parsePluginInstance("plugin:carousel:apod")).toBe("apod");
    expect(parsePluginInstance("plugin:carousel")).toBeNull();
    expect(configStoreId({ id: "carousel", instanceId: "apod" })).toBe("carousel:apod");
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

  it("resolves instance store ids against the catalog tree", () => {
    const catalog = pack({
      instances: [
        { id: "carousel", source: "nasa" },
        { id: "apod", source: "apod" },
      ],
    });
    const apod = pluginSpecForStoreId([catalog], "carousel:apod");
    expect(apod?.instanceId).toBe("apod");
    expect(pluginSpecForStoreId([catalog], "carousel")).toBeTruthy();
    expect(pluginSpecForStoreId([catalog], "carousel:missing")).toBeNull();
  });
});
