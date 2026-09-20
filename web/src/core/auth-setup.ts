/** Features that need a key or OAuth. Views stay out of dice until that credential is live. */

export type AuthKind = "sdm" | "guardian" | "apod" | "cursor" | "typesafe" | "elevenlabs";

export type AuthLink = { label: string; href: string };

export type AuthSetup = {
  id: AuthKind;
  title: string;
  summary: string;
  configure: string;
  links: AuthLink[];
  /** When true, bound views stay out of dice until `ready`. */
  blocksDice: boolean;
};

export type AuthSourceLive = {
  id?: string;
  ok?: boolean;
  pending?: boolean;
  url?: string;
  error?: string;
  items?: unknown[];
};

export type AuthCtx = {
  sdmLinked?: boolean;
  sdmPcmUrl?: string | null;
  sources?: Record<string, AuthSourceLive>;
  cursorConfigured?: boolean;
  typesafeConfigured?: boolean;
};

export const AUTH_SETUPS: Record<AuthKind, AuthSetup> = {
  sdm: {
    id: "sdm",
    title: "Nest cameras (Device Access)",
    summary: "Live Nest cams need a Google Device Access project and a Web OAuth client. Tokens stay on the host in ~/.zoto-viz/sdm.yml.",
    configure: "Create the Web client and Device Access project, then paste enterprise_id + client id/secret (and the PCM code) via Settings → Sources or MCP set_sdm.",
    links: [
      { label: "Device Access docs", href: "https://developers.google.com/nest/device-access" },
      { label: "Device Access console", href: "https://console.nest.google.com/device-access" },
      { label: "Google Cloud credentials", href: "https://console.cloud.google.com/apis/credentials" },
    ],
    blocksDice: true,
  },
  guardian: {
    id: "guardian",
    title: "Guardian Open Platform",
    summary: "The shipped guardian source uses api-key=test, which the API rejects (401). Views bound to it stay out of dice until you put a real key on the source URL.",
    configure: "Register for a key, then edit the guardian source URL in Settings → Sources and replace api-key=test.",
    links: [
      { label: "Get a Guardian API key", href: "https://open-platform.theguardian.com/access/" },
      { label: "Open Platform docs", href: "https://open-platform.theguardian.com/documentation/" },
    ],
    blocksDice: true,
  },
  apod: {
    id: "apod",
    title: "NASA APOD key",
    summary: "DEMO_KEY works for light use. A personal key raises the hourly cap if APOD starts 429ing.",
    configure: "Mint a key at api.nasa.gov, then replace DEMO_KEY on the apod source URL in Settings → Sources.",
    links: [
      { label: "Get a NASA API key", href: "https://api.nasa.gov/" },
      { label: "APOD API", href: "https://api.nasa.gov/#apod" },
    ],
    blocksDice: false,
  },
  cursor: {
    id: "cursor",
    title: "Cursor API key",
    summary: "Cursor SDK chat and HN Rain title stills need CURSOR_API_KEY (or a key pasted in Settings → Agent).",
    configure: "Create a user key on the Cursor dashboard, then paste it under Settings → Agent or export CURSOR_API_KEY and restart the monitor.",
    links: [
      { label: "Cursor API keys", href: "https://cursor.com/dashboard/api" },
      { label: "Cursor API docs", href: "https://cursor.com/docs/api" },
    ],
    blocksDice: false,
  },
  typesafe: {
    id: "typesafe",
    title: "TypeSafe Sense",
    summary: "Plugins with the typesafe capability call Sense through the monitor. The key never goes to the browser.",
    configure: "Set TYPESAFE_API_KEY in the monitor env (see .env.example) and restart.",
    links: [],
    blocksDice: true,
  },
  elevenlabs: {
    id: "elevenlabs",
    title: "ElevenLabs TTS",
    summary: "Cloud spoken replies use ElevenLabs when ELEVENLABS_API_KEY is set. Without it the monitor falls back to local Kokoro / Piper / espeak.",
    configure: "Create an API key, export ELEVENLABS_API_KEY on the monitor, optional ELEVENLABS_VOICE_ID, then restart.",
    links: [
      { label: "ElevenLabs API keys", href: "https://elevenlabs.io/app/settings/api-keys" },
      { label: "ElevenLabs docs", href: "https://elevenlabs.io/docs/api-reference/introduction" },
    ],
    blocksDice: false,
  },
};

const PLACEHOLDER: Record<string, string[]> = {
  "api-key": ["test"],
  api_key: ["DEMO_KEY"],
};

export function queryValue(url: string, key: string): string {
  if (!url) return "";
  try {
    return (new URL(url).searchParams.get(key) || "").trim();
  } catch {
    const m = url.match(new RegExp(`[?&]${key}=([^&#]*)`, "i"));
    if (!m?.[1]) return "";
    try {
      return decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    } catch {
      return m[1].trim();
    }
  }
}

export function sourceAuthKind(id: string, url = ""): AuthKind | null {
  const sid = (id || "").trim().toLowerCase();
  const href = url.toLowerCase();
  if (sid === "guardian" || href.includes("content.guardianapis.com")) return "guardian";
  if (sid === "apod" || href.includes("api.nasa.gov/planetary/apod")) return "apod";
  return null;
}

export function sourceAuthReady(kind: AuthKind, url: string, live?: AuthSourceLive): boolean {
  if (kind === "guardian") {
    if (live?.ok && (live.items?.length ?? 0) > 0) return true;
    const key = queryValue(url, "api-key");
    return !!key && !PLACEHOLDER["api-key"]!.includes(key);
  }
  if (kind === "apod") {
    if (live?.ok === false && /401|403|429/.test(String(live.error || ""))) {
      const key = queryValue(url, "api_key");
      return !!key && !PLACEHOLDER.api_key!.includes(key);
    }
    return true;
  }
  return true;
}

export function bindSourceOf(
  spec: { config?: Array<{ key?: string; value?: string }> | null } | null | undefined,
  fallback = "",
): string {
  const field = spec?.config?.find((f) => f.key === "source");
  return String(field?.value || fallback).trim();
}

export function viewAuthBlock(
  view: { id: string; pluginId?: string; source?: string; capabilities?: string[] },
  ctx: AuthCtx = {},
): AuthSetup | null {
  if (view.pluginId === "nest-cams" || view.id === "plugin:nest-cams") {
    return ctx.sdmLinked ? null : AUTH_SETUPS.sdm;
  }
  if (view.capabilities?.includes("typesafe") && !ctx.typesafeConfigured) {
    return AUTH_SETUPS.typesafe;
  }
  const sid = (view.source || "").trim();
  if (!sid) return null;
  const live = ctx.sources?.[sid];
  const kind = sourceAuthKind(sid, live?.url || "");
  if (!kind) return null;
  const setup = AUTH_SETUPS[kind];
  if (!setup.blocksDice) return null;
  return sourceAuthReady(kind, live?.url || "", live) ? null : setup;
}

export function renderAuthSetup(setup: AuthSetup, extra?: { pcmUrl?: string | null }): HTMLElement {
  const el = document.createElement("div");
  el.className = "auth-setup";
  el.dataset.auth = setup.id;
  const title = document.createElement("strong");
  title.textContent = setup.title;
  const summary = document.createElement("p");
  summary.textContent = setup.summary;
  const links = document.createElement("div");
  links.className = "auth-links";
  const items = [...setup.links];
  if (setup.id === "sdm" && extra?.pcmUrl) {
    items.unshift({ label: "Open Nest PCM link", href: extra.pcmUrl });
  }
  for (const item of items) {
    const a = document.createElement("a");
    a.href = item.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = item.label;
    links.appendChild(a);
  }
  const how = document.createElement("p");
  how.textContent = setup.configure;
  el.append(title, summary, links, how);
  return el;
}
