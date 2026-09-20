/** Conversational Cursor SDK harness: resume + MCP tools, Cursor's built-in tool protocol. */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Agent } from "@cursor/sdk";

export function sessionPath() {
  const env = String(process.env.ZOTO_VIZ_CURSOR_SESSION || "").trim();
  if (env) return env;
  return join(process.env.HOME || homedir(), ".zoto-viz", "agent", "cursor-session.json");
}

export function readSession() {
  try {
    const raw = JSON.parse(readFileSync(sessionPath(), "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const agentId = String(raw.agentId || "").trim();
    const model = String(raw.model || "").trim();
    if (!agentId) return null;
    return { agentId, model };
  } catch {
    return null;
  }
}

export function writeSession(partial) {
  const rec = {
    agentId: String(partial?.agentId || "").trim(),
    model: String(partial?.model || "").trim(),
    t: Date.now() / 1000,
  };
  if (!rec.agentId) return rec;
  const path = sessionPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(rec)}\n`, { encoding: "utf8" });
  return rec;
}

export function clearSession() {
  try {
    unlinkSync(sessionPath());
  } catch {
    /* missing is fine */
  }
}

/** Keep Cursor's harness prompt. Restrict writes unless AI Control is on. */
export function toolPolicy(control) {
  if (control) {
    return { tools: ["mcp", "read", "grep", "glob", "ls", "semSearch", "webSearch", "webFetch"] };
  }
  return {
    tools: ["mcp", "read", "grep", "glob", "ls"],
    disallowedTools: ["edit", "delete", "shell", "applyAgentDiff"],
  };
}

export function mcpServers() {
  return {
    "zoto-viz": {
      type: "http",
      url: process.env.ZOTO_VIZ_MCP || "http://127.0.0.1:7020/mcp",
    },
  };
}

export function agentOptions({ apiKey, model, control }) {
  return {
    apiKey,
    model: { id: model },
    local: {
      cwd: process.env.ZOTO_VIZ_REPO_ROOT || process.cwd(),
      settingSources: [],
    },
    mcpServers: mcpServers(),
    ...toolPolicy(control),
  };
}

export async function openAgent({ apiKey, model, control, agentId, reset }) {
  const opts = agentOptions({ apiKey, model, control });
  const want = !reset && agentId ? String(agentId) : "";
  if (want) {
    try {
      const agent = await Agent.resume(want, opts);
      return { agent, resumed: true };
    } catch {
      /* stale local id — start a new conversation */
    }
  }
  const agent = await Agent.create(opts);
  return { agent, resumed: false };
}

export function turnText({ system, prompt, resumed }) {
  const body = String(prompt || "").trim();
  const ident = String(system || "").trim();
  if (!resumed && ident) return `${ident}\n\n${body}`;
  return body;
}

export function toolLabel(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "tool_call") return String(event.name || event.toolName || "tool");
  const blocks = event.message?.content;
  if (!Array.isArray(blocks)) return String(event.toolName || event.name || "");
  const use = blocks.find((b) => b && b.type === "tool_use");
  return String(use?.name || event.toolName || event.name || "");
}
