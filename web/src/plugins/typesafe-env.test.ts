import { describe, expect, it } from "vitest";
import { resolveTypeSafeApiKey } from "./typesafe-env";

describe("resolveTypeSafeApiKey", () => {
  it("prefers VITE_TYPESAFE_API_KEY over TYPESAFE_API_KEY", () => {
    expect(resolveTypeSafeApiKey({
      viteTypesafeApiKey: "vite-key",
      typesafeApiKey: "plain-key",
      processTypesafeApiKey: "proc-plain",
      processViteTypesafeApiKey: "proc-vite",
    })).toBe("vite-key");
  });

  it("falls back to import.meta TYPESAFE_API_KEY then process env", () => {
    expect(resolveTypeSafeApiKey({
      typesafeApiKey: "meta-plain",
      processTypesafeApiKey: "proc-plain",
    })).toBe("meta-plain");

    expect(resolveTypeSafeApiKey({
      processTypesafeApiKey: "proc-plain",
      processViteTypesafeApiKey: "proc-vite",
    })).toBe("proc-plain");

    expect(resolveTypeSafeApiKey({
      processViteTypesafeApiKey: "proc-vite",
    })).toBe("proc-vite");
  });

  it("returns undefined for blank values", () => {
    expect(resolveTypeSafeApiKey({
      viteTypesafeApiKey: "  ",
      typesafeApiKey: "",
    })).toBeUndefined();
  });
});
