export type StarterOptions = {
  displayName: string;
};

export const DEFAULT_OPTIONS: StarterOptions = {
  displayName: "Starter",
};

export function parseStarterOptions(cfg?: Record<string, string> | null): StarterOptions {
  const name = cfg?.displayName?.trim();
  return {
    displayName: name && name.length > 0 ? name : DEFAULT_OPTIONS.displayName,
  };
}
