export async function loadRemote() {
  return import("https://example.com/plugins/src/marble-run/frontend/index.ts");
}
