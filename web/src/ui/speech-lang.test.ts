/** Speech language reaches recognition and survives a reload. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { armSpeechRecognition, loadSpeechLang, saveSpeechLang, SPEECH_LANG_KEY, speechRecognitionLang } from "./speech-lang";

describe("speech language", () => {
  afterEach(() => {
    localStorage.clear();
    saveSpeechLang("");
  });

  it("Match browser uses navigator.language, and a chosen language is stored", () => {
    expect(speechRecognitionLang("en-AU")).toBe("en-AU");
    saveSpeechLang("de-DE");
    expect(loadSpeechLang()).toBe("de-DE");
    expect(speechRecognitionLang("en-AU")).toBe("de-DE");
    expect(localStorage.getItem(SPEECH_LANG_KEY)).toBe("de-DE");
  });

  it("a rejected language falls back and announces once, on both recognition sites", () => {
    saveSpeechLang("de-DE");
    const lines: string[] = [];
    const rec = { lang: "", onerror: null as ((e: { error: string }) => void) | null };
    armSpeechRecognition(rec, (line) => lines.push(line), "en-AU");
    expect(rec.lang).toBe("de-DE");
    rec.onerror?.({ error: "language-not-supported" });
    expect(lines).toEqual(["Deutsch isn't available for speech here. Using English (Australia)."]);
    expect(rec.lang).toBe("en-AU");
    expect(speechRecognitionLang("en-AU")).toBe("en-AU");
    rec.onerror?.({ error: "language-not-supported" });
    expect(lines).toHaveLength(1);

    const src = readFileSync(resolve(import.meta.dirname, "./agent.ts"), "utf8");
    const wake = src.slice(src.indexOf("private attachWakeRec"), src.indexOf("private stopWake"));
    const hold = src.slice(src.indexOf("private async armHold"), src.indexOf("private stopHold"));
    expect(wake).toContain("this.armSpeechLang(");
    expect(hold).toContain("this.armSpeechLang(");
  });
});
