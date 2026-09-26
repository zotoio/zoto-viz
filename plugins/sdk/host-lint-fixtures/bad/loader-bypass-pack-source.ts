/** Must fail: looks like module.js loader path but resolves to pack SOURCE, not /api bundle. */
export async function loadPackSourceDisguisedAsBundle(): Promise<unknown> {
  return import("../../../plugins/src/marble-run/frontend/module.js");
}

export async function loadViaTraversalApiUrl(): Promise<unknown> {
  return import("/api/plugins/marble-run/../../../plugins/src/marble-run/frontend/config");
}
