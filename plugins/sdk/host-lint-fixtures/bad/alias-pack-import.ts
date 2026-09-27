import { parseMarbleOptions } from "@lint-fixture-pack/marble-run/frontend/config";

export function run(): void {
  parseMarbleOptions({ preset: "classic" });
}
