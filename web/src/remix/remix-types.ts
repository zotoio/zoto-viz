export type DataSourceOutputShape = "vizFrame" | "headlines" | "json";

export interface DataSourceEntry {
  id: string;
  hosts: string[];
  refreshSec: number;
  apiKeyRequired: boolean;
  outputShape: DataSourceOutputShape;
  demoSnapshot: string;
}

export interface DataSourceBlock {
  sources: DataSourceEntry[];
}

export interface RemixPairing {
  dataPluginId: string;
  sourceId: string;
  visualPackId: string;
}

export interface DemoSnapshotPayload {
  demo: true;
  label?: string;
  vizFrame?: Record<string, unknown>;
}
