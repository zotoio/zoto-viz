/** Vite dev server /@fs/ absolute path into pack source. */
export async function run(): Promise<unknown> {
  return import("/@fs/__REPO_ROOT__/plugins/src/marble-run/frontend/config.ts");
}
