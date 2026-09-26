import "./pack-local"

export async function boot() {
  return import("./pack-local");
}
