/** #268: speech language reaches recognition and survives a reload. */
import { afterEach, describe, expect, it } from "vitest";
import { loadSpeechLang, saveSpeechLang, SPEECH_LANG_KEY, speechLangRejectedLine, speechRecognitionLang } from "./speech-lang";

describe("#268 speech language", () => {
  afterEach(() => localStorage.clear());

  it("Match browser uses navigator.language, and a chosen language is stored", () => {
    expect(speechRecognitionLang("en-AU")).toBe("en-AU");
    saveSpeechLang("de-DE");
    expect(loadSpeechLang()).toBe("de-DE");
    expect(speechRecognitionLang("en-AU")).toBe("de-DE");
    expect(localStorage.getItem(SPEECH_LANG_KEY)).toBe("de-DE");
  });

  it("a rejected language announces once", () => {
    expect(speechLangRejectedLine("de-DE", "en-AU")).toBe("Deutsch isn't available for speech here. Using English (Australia).");
  });
});
