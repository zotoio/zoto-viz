export async function run(): Promise<unknown> {
  return import("https://example.com/vendor/lib.js");
}
