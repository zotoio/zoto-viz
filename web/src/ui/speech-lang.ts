/** #268: speech recognition language. Stored globally, not in a profile. */
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

export function saveSpeechLang(id: string): void {
  try {
    if (!id) localStorage.removeItem(SPEECH_LANG_KEY);
    else localStorage.setItem(SPEECH_LANG_KEY, id);
  } catch { /* private mode */ }
}

/** Match browser uses navigator.language. A stored tag is used as-is. */
export function speechRecognitionLang(navigatorLanguage = typeof navigator !== "undefined" ? navigator.language : "en-US"): string {
  const saved = loadSpeechLang();
  if (!saved || saved === "match") return navigatorLanguage || "en-US";
  return saved;
}

export function speechLangRejectedLine(language: string, fallback: string): string {
  const name = SPEECH_LANGUAGES.find((l) => l.id === language)?.label || language;
  const fb = SPEECH_LANGUAGES.find((l) => l.id === fallback)?.label || fallback;
  return `${name} isn't available for speech here. Using ${fb}.`;
}
