export async function loadPackConfig(): Promise<unknown> {
  return import("../../../plugins/src/marble-run/frontend/config");
}
