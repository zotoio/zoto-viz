import { describe, expect, it } from "vitest";
import { afterSendCue, afterWatchword, agentHeaderCopy, agentPhase, aiCyclePrefOn, aiMosaicLayoutOn, CYCLE_KEY, MOSAIC_LAYOUT_KEY, displayText, extractAgentLook, extractMemory, extractSettings, extractYaml, needsAgentReply, parseOllamaChat, parseOllamaLine, spokenText, splitThinkTags } from "./agent";

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

describe("afterSendCue", () => {
  it("submits only on a trailing send", () => {
    expect(afterSendCue("what's on the lan send")).toEqual({ body: "what s on the lan", send: true });
    expect(afterSendCue("please send")).toEqual({ body: "", send: true });
    expect(afterSendCue("send")).toEqual({ body: "", send: true });
    expect(afterSendCue("list hosts")).toEqual({ body: "list hosts", send: false });
    expect(afterSendCue("send the logs")).toEqual({ body: "send the logs", send: false });
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

describe("extractAgentLook", () => {
  it("reads shader, photo URLs, svg, and clear", () => {
    const look = extractAgentLook(`ok
\`\`\`shader
vec3 color(vec3 dir, float t) { return uAccent; }
\`\`\`
\`\`\`photo
https://example.com/a.png
\`\`\`
\`\`\`svg
<svg viewBox="0 0 1 1"></svg>
\`\`\`
\`\`\`deco
{"clear":true}
\`\`\`
`);
    expect(look?.shader).toContain("color");
    expect(look?.photos?.[0]?.url).toBe("https://example.com/a.png");
    expect(look?.svg).toContain("<svg");
    expect(look?.clear).toBe(true);
    expect(extractAgentLook("nope")).toBeNull();
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
    expect(agentPhase({ busy: false, speaking: false, wakeOn: true, heard: false, recOn: false })).toBe("listen");
    expect(agentPhase({ busy: false, speaking: false, wakeOn: false, heard: false })).toBe("idle");
  });
});

describe("aiCyclePrefOn", () => {
  it("defaults on and only an explicit 0 is off", () => {
    expect(aiCyclePrefOn({ getItem: () => null })).toBe(true);
    expect(aiCyclePrefOn({ getItem: () => "1" })).toBe(true);
    expect(aiCyclePrefOn({ getItem: () => "0" })).toBe(false);
    expect(CYCLE_KEY).toBe("zoto-viz.aiCycle");
  });
});

describe("aiMosaicLayoutOn", () => {
  it("defaults on so the model may rearrange until the operator turns it off", () => {
    expect(aiMosaicLayoutOn({ getItem: () => null })).toBe(true);
    expect(aiMosaicLayoutOn({ getItem: () => "1" })).toBe(true);
    expect(aiMosaicLayoutOn({ getItem: () => "0" })).toBe(false);
    expect(MOSAIC_LAYOUT_KEY).toBe("zoto-viz.ai.mosaicLayout");
  });
});

describe("agentHeaderCopy", () => {
  it("labels think vs idle so the chip is not a silent ellipsis", () => {
    expect(agentHeaderCopy("think").text).toBe("AI · think");
    expect(agentHeaderCopy("idle").text).toBe("AI");
    expect(agentHeaderCopy("listen").text).toBe("AI");
    expect(agentHeaderCopy("heard").text).toBe("AI · listen");
    expect(agentHeaderCopy("heard").title).toMatch(/send/i);
    expect(agentHeaderCopy("listen", "zoto").title).toContain("zoto");
    expect(agentHeaderCopy("idle", "zoto", true).title).toMatch(/AI Control is on/);
    expect(agentHeaderCopy("idle", "zoto", false, true).title).toMatch(/Ollama model/i);
    expect(agentHeaderCopy("idle", "zoto", false, true).title).toMatch(/Dynamic/i);
  });
});

describe("needsAgentReply", () => {
  it("polls when the model only thought, or left a fence open", () => {
    expect(needsAgentReply("planning the lan", "")).toBe(true);
    expect(needsAgentReply("", "the nest is loud.")).toBe(false);
    expect(needsAgentReply("", "```yaml\nid: x\n")).toBe(true);
    expect(needsAgentReply("", "")).toBe(false);
  });
});

describe("spokenText", () => {
  it("strips fences so TTS does not read yaml", () => {
    expect(spokenText("Hello.\n```yaml\nid: x\n```\nMore.")).toBe("Hello. More.");
  });
});
