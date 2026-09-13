import { describe, expect, it } from "vitest";
import { afterWatchword, extractSettings, extractYaml, spokenText } from "./agent";

describe("extractYaml", () => {
  it("reads a yaml fence", () => {
    expect(extractYaml("```yaml\nid: pulse\nname: Pulse\n```")).toContain("id: pulse");
    expect(extractYaml("```yml\nid: pulse\n```")).toContain("id: pulse");
    expect(extractYaml("```\nid: pulse\nname: Pulse\n```")).toContain("id: pulse");
    expect(extractYaml("```settings\n{\"theme\":\"matrix\"}\n```")).toBeNull();
    expect(extractYaml("plain")).toBeNull();
  });
});

describe("extractSettings", () => {
  it("parses a settings fence", () => {
    expect(extractSettings("```settings\n{\"theme\":\"matrix\",\"dream\":true}\n```")).toEqual({
      theme: "matrix",
      dream: true,
    });
    expect(extractSettings("```settings\n[]\n```")).toBeNull();
    expect(extractSettings("```settings\nnope\n```")).toBeNull();
    expect(extractSettings("no fence")).toBeNull();
  });
});

describe("afterWatchword", () => {
  it("returns the remainder after zoto / hey zoto", () => {
    expect(afterWatchword("hey zoto what's on the lan", "zoto")).toBe("what s on the lan");
    expect(afterWatchword("Zoto, who is talking?", "zoto")).toBe("who is talking");
    expect(afterWatchword("zoto", "zoto")).toBe("");
    expect(afterWatchword("what's on the lan", "zoto")).toBeNull();
    expect(afterWatchword("azoto hello", "zoto")).toBeNull();
  });
});

describe("spokenText", () => {
  it("strips fences so TTS does not read yaml", () => {
    expect(spokenText("Hello.\n```yaml\nid: x\n```\nMore.")).toBe("Hello. More.");
  });
});
