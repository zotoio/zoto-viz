/** Speech recognition language. Stored globally, not in a profile. */
export const SPEECH_LANG_KEY = "zoto-viz.speechLang";

export const SPEECH_LANGUAGES: { id: string; label: string }[] = [
  { id: "match", label: "Match browser" },
  { id: "en-US", label: "English (United States)" },
  { id: "en-AU", label: "English (Australia)" },
  { id: "en-GB", label: "English (United Kingdom)" },
  { id: "de-DE", label: "Deutsch" },
  { id: "fr-FR", label: "Français" },
  { id: "es-ES", label: "Español" },
  { id: "ja-JP", label: "日本語" },
];

export function loadSpeechLang(): string {
  try {
    return localStorage.getItem(SPEECH_LANG_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The tag the browser refused. Recognition uses the browser language until the user picks again. */
let rejectedLang = "";

export function saveSpeechLang(id: string): void {
  rejectedLang = "";
  try {
    if (!id) localStorage.removeItem(SPEECH_LANG_KEY);
    else localStorage.setItem(SPEECH_LANG_KEY, id);
  } catch { /* private mode */ }
}

/** Match browser uses navigator.language. A stored tag is used until the browser refuses it. */
export function speechRecognitionLang(navigatorLanguage = typeof navigator !== "undefined" ? navigator.language : "en-US"): string {
  const saved = loadSpeechLang();
  const fallback = navigatorLanguage || "en-US";
  if (!saved || saved === "match" || saved === rejectedLang) return fallback;
  return saved;
}

export function speechLangRejectedLine(language: string, fallback: string): string {
  const name = SPEECH_LANGUAGES.find((l) => l.id === language)?.label || language;
  const fb = SPEECH_LANGUAGES.find((l) => l.id === fallback)?.label || fallback;
  return `${name} isn't available for speech here. Using ${fb}.`;
}

/** First refusal of this tag returns the line. The same refusal again is silent. */
export function noteSpeechLangRejected(rejected: string, navigatorLanguage: string): string | null {
  const fallback = navigatorLanguage || "en-US";
  if (!rejected || rejected === fallback || rejectedLang === rejected) return null;
  rejectedLang = rejected;
  return speechLangRejectedLine(rejected, fallback);
}

/** Sets `rec.lang`, and on `language-not-supported` falls back and announces once. */
export function armSpeechRecognition(
  rec: { lang: string; onerror: ((e: { error: string }) => void) | null },
  announce: (line: string) => void,
  navigatorLanguage: string,
): void {
  rec.lang = speechRecognitionLang(navigatorLanguage);
  const prior = rec.onerror;
  rec.onerror = (e) => {
    if (e.error === "language-not-supported") {
      const line = noteSpeechLangRejected(rec.lang, navigatorLanguage);
      rec.lang = speechRecognitionLang(navigatorLanguage);
      if (line) announce(line);
    }
    prior?.(e);
  };
}
