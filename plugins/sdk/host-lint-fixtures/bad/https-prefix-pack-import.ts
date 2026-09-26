export async function run(): Promise<unknown> {
  return import("https://cdn.example/org/repo/main/plugins/src/marble-run/frontend/index.ts");
}
