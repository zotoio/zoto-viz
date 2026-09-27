import { defineConfig } from "vitepress";

const base = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITEPRESS_BASE || "/";

export default defineConfig({
  title: "zoto-viz",
  description: "Live LAN visualisation, catalog plugins, and a local Gemma 4 operator",
  base,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: "Install", link: "/install" },
      { text: "Plugins", link: "/plugins" },
      { text: "Agent", link: "/agent" },
    ],
    sidebar: [
      { text: "Install", link: "/install" },
      { text: "Live monitor", link: "/live" },
      { text: "Views and motion", link: "/motion" },
      { text: "Camera and privacy", link: "/camera" },
      { text: "Data sources", link: "/sources" },
      { text: "Nest cameras (SDM)", link: "/sdm" },
      { text: "Plugins", link: "/plugins" },
      { text: "TypeScript plugins", link: "/plugins-ts" },
      { text: "HTTP / WebSocket API", link: "/api" },
      { text: "Ollama agent", link: "/agent" },
      { text: "systemd and Wi-Fi hopper", link: "/systemd" },
      { text: "Batch CLI", link: "/batch" },
      { text: "Contributing", link: "/contributing" },
      { text: "Revert-proofs archive", link: "/revert-proofs-archive" },
    ],
  },
});
