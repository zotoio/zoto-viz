/** HTTPS URLs must not load pack source (only /api/plugins/<id>/module.js is allowed). */
export async function run(): Promise<unknown> {
  return import("https://cdn.example/plugins/src/marble-run/frontend/index.ts");
}
