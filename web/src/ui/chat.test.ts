import { afterEach, describe, expect, it } from "vitest";
import { ChatPanel, DEFAULT_CHAT } from "./chat";

const chats: ChatPanel[] = [];

function panel(): ChatPanel {
  const host = document.createElement("div");
  document.body.append(host);
  const chat = new ChatPanel(host);
  chats.push(chat);
  chat.setConfig({ ...DEFAULT_CHAT, on: true });
  return chat;
}

afterEach(() => {
  for (const c of chats) c.setConfig({ ...DEFAULT_CHAT, on: false });
  chats.length = 0;
  document.body.replaceChildren();
});

describe("chat panel", () => {
  it("keeps a turn's thinking in one row so paragraphs do not pile up", () => {
    const chat = panel();
    expect(chat.el.classList.contains("transcript")).toBe(true);
    expect(chat.el.classList.contains("chat-log")).toBe(true);
    chat.seedTranscript([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        thinking: "1. greet\n\n2. wait for a task",
        content: "hello — say what you want on the LAN",
      },
    ]);
    const rows = [...chat.el.querySelectorAll(".row")];
    expect(rows.map((r) => r.querySelector(".k")?.textContent)).toEqual(["you", "think", "agent"]);
    expect(rows[1]?.querySelector(".tx")?.textContent).toContain("greet");
    expect(rows[1]?.querySelector(".tx")?.textContent).toContain("wait for a task");
  });

  it("renders agent markdown as html", () => {
    const chat = panel();
    chat.seedTranscript([{ role: "assistant", content: "**nest** is loud" }]);
    expect(chat.el.querySelector(".row.agent .tx strong")?.textContent).toBe("nest");
    chat.pushChat("agent", "use `tcp/443`", true);
    chat.flushReveal();
    expect(chat.el.querySelector(".row.agent .tx code")?.textContent).toBe("tcp/443");
  });

  it("streams newlines into the same think line", () => {
    const chat = panel();
    chat.pushChat("think", "Analyze the user input:\n", true);
    chat.pushChat("think", "they said hi\nGoal: reply", true);
    chat.flushReveal();
    const think = [...chat.el.querySelectorAll(".row.think")];
    expect(think).toHaveLength(1);
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("Analyze the user input:");
    expect(think[0]?.querySelector(".tx")?.textContent).toContain("Goal: reply");
  });

  it("renders thought markdown as html", () => {
    const chat = panel();
    chat.pushChat("think", "1. **greet**\n2. wait", false);
    expect(chat.el.querySelector(".row.think .tx strong")?.textContent).toBe("greet");
    expect(chat.el.querySelector(".row.think .tx ol, .row.think .tx ul")).toBeTruthy();
  });

  it("shows a composer and submits it", () => {
    const chat = panel();
    const composer = chat.el.querySelector(".feed-composer") as HTMLDivElement;
    expect(composer.hidden).toBe(false);
    const sent: string[] = [];
    chat.onSend = (t) => { sent.push(t); };
    chat.ask.value = "who is loud";
    chat.el.querySelector<HTMLButtonElement>(".feed-send")!.click();
    expect(sent).toEqual(["who is loud"]);
    expect(chat.ask.value).toBe("");
    chat.setConfig({ ...DEFAULT_CHAT, on: false });
    expect(composer.hidden).toBe(true);
    chat.setConfig({ ...DEFAULT_CHAT, on: true });
    expect(composer.hidden).toBe(false);
    chat.ask.value = "queued";
    chat.onSend = () => false;
    chat.el.querySelector<HTMLButtonElement>(".feed-send")!.click();
    expect(chat.ask.value).toBe("queued");
  });

  it("shows a thinking row until the first token, then drops it if the model never thinks", () => {
    const chat = panel();
    chat.setThinking(true);
    expect(chat.el.classList.contains("thinking")).toBe(true);
    expect(chat.el.getAttribute("aria-busy")).toBe("true");
    expect(chat.el.querySelector(".feed-hint")?.textContent).toBe("thinking…");
    const pending = chat.el.querySelector(".row.think.pending .tx");
    expect(pending?.textContent?.trim()).toBe("thinking…");
    chat.pushChat("think", "checking talkers\n", true);
    chat.flushReveal();
    expect(chat.el.querySelector(".row.think.pending")).toBeNull();
    expect(chat.el.querySelector(".row.think .tx")?.textContent).toContain("checking talkers");
    chat.setThinking(false);
    expect(chat.el.classList.contains("thinking")).toBe(false);

    const quiet = panel();
    quiet.setThinking(true);
    quiet.pushChat("agent", "hi", true);
    quiet.flushReveal();
    expect(quiet.el.querySelector(".row.think")).toBeNull();
    expect(quiet.el.querySelector(".row.agent .tx")?.textContent?.trim()).toBe("hi");
    quiet.setThinking(false);
    expect(quiet.el.getAttribute("aria-busy")).toBe("false");
  });

  it("does not wipe live chat rows when history reseeds", () => {
    const chat = panel();
    chat.pushChat("you", "live ask");
    chat.pushChat("agent", "live reply");
    chat.seedTranscript([
      { role: "user", content: "stale" },
      { role: "assistant", content: "would replace" },
    ]);
    const texts = [...chat.el.querySelectorAll(".row .tx")].map((el) => el.textContent?.trim());
    expect(texts).toEqual(["live ask", "live reply"]);
  });

  it("marks listening and keeps following the ticker", () => {
    const chat = panel();
    chat.seedTranscript([{ role: "user", content: "hi" }]);
    chat.setListening(true);
    expect(chat.el.classList.contains("listening")).toBe(true);
    expect(chat.el.querySelector(".feed-hint")?.textContent).toMatch(/listening/i);
    expect(chat.ask.placeholder).toMatch(/send/i);
    chat.setListening(false);
    expect(chat.el.classList.contains("listening")).toBe(false);
  });

  it("buffers streamed agent text until the typewriter catches up", () => {
    const chat = panel();
    chat.pushChat("agent", "Hello there, friend. ", true);
    expect(chat.el.querySelector(".row.agent .tx")?.textContent).toBe("");
    chat.stepClock(0.05);
    const mid = chat.el.querySelector(".row.agent .tx")?.textContent || "";
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan("Hello there, friend. ".length);
    chat.flushReveal();
    expect(chat.el.querySelector(".row.agent .tx")?.textContent).toContain("Hello there");
  });

  it("notifies onDisplay as characters appear and when the stream locks", () => {
    const chat = panel();
    const seen: { shown: string; done: boolean }[] = [];
    chat.onDisplay = (info) => { if (info.role === "agent") seen.push({ shown: info.shown, done: info.done }); };
    chat.pushChat("agent", "Hello world.", true);
    chat.stepClock(1);
    chat.lockStream();
    expect(seen.some((s) => s.shown.includes("Hello") && !s.done)).toBe(true);
    expect(seen.at(-1)?.done).toBe(true);
    expect(seen.at(-1)?.shown).toBe("Hello world.");
  });
});
