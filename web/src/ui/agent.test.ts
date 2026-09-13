import { describe, expect, it } from "vitest";
import { afterWatchword, agentHeaderCopy, agentPhase, displayText, extractMemory, extractSettings, extractYaml, parseOllamaChat, parseOllamaLine, spokenText, splitThinkTags } from "./agent";

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

  it("accepts STT aliases for zoto", () => {
    expect(afterWatchword("hey so to what's on the lan", "zoto")).toBe("what s on the lan");
    expect(afterWatchword("soto who is talking", "zoto")).toBe("who is talking");
    expect(afterWatchword("heyzoto hello", "zoto")).toBe("hello");
    expect(afterWatchword("okay soto list hosts", "zoto")).toBe("list hosts");
    expect(afterWatchword("zo to show the talkers", "zoto")).toBe("show the talkers");
    expect(afterWatchword("soto hello", "pulse")).toBeNull();
  });
});

describe("extractMemory", () => {
  it("reads a memory fence", () => {
    expect(extractMemory("```memory\nthe nest is in the kitchen\n```")).toBe("the nest is in the kitchen");
    expect(extractMemory("```memory\n{\"text\":\"guest ssid is the printer\"}\n```")).toBe("guest ssid is the printer");
    expect(extractMemory("```memory\n{nope}\n```")).toBe("{nope}");
    expect(extractMemory("no fence")).toBeNull();
  });
});

describe("displayText", () => {
  it("strips memory fences from the log", () => {
    expect(displayText("Noted.\n```memory\nnest is kitchen\n```")).toBe("Noted.");
    expect(displayText("```memory\nonly\n```")).toContain("memory");
  });
});

describe("parseOllamaChat", () => {
  it("joins thinking and content deltas", () => {
    expect(parseOllamaLine('{"message":{"thinking":"hmm"}}')).toEqual({ thinking: "hmm" });
    expect(parseOllamaChat('{"message":{"content":"hi","thinking":"plan"}}')).toEqual({
      thinking: "plan",
      content: "hi",
    });
    expect(parseOllamaChat('{"message":{"content":"<think>why</think>ok"}}')).toEqual({
      thinking: "why",
      content: "ok",
    });
    expect(splitThinkTags("a", "<think>b</think>c")).toEqual({ thinking: "a\nb", content: "c" });
  });
});

describe("agentPhase", () => {
  it("shows think while a turn is in flight, even if the mic is off", () => {
    expect(agentPhase({ busy: true, speaking: false, wakeOn: false, heard: false })).toBe("think");
    expect(agentPhase({ busy: true, speaking: false, wakeOn: true, heard: true })).toBe("think");
    expect(agentPhase({ busy: false, speaking: true, wakeOn: true, heard: false })).toBe("speak");
    expect(agentPhase({ busy: false, speaking: false, wakeOn: true, heard: true })).toBe("heard");
    expect(agentPhase({ busy: false, speaking: false, wakeOn: true, heard: false })).toBe("listen");
    expect(agentPhase({ busy: false, speaking: false, wakeOn: true, heard: false, recOn: false })).toBe("idle");
    expect(agentPhase({ busy: false, speaking: false, wakeOn: false, heard: false })).toBe("idle");
  });
});

describe("agentHeaderCopy", () => {
  it("labels think vs idle so the chip is not a silent ellipsis", () => {
    expect(agentHeaderCopy("think").text).toBe("AI · think");
    expect(agentHeaderCopy("idle").text).toBe("AI");
    expect(agentHeaderCopy("listen", "zoto").title).toContain("zoto");
  });
});

describe("spokenText", () => {
  it("strips fences so TTS does not read yaml", () => {
    expect(spokenText("Hello.\n```yaml\nid: x\n```\nMore.")).toBe("Hello. More.");
  });
});
