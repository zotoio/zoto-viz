/** Session + tool policy helpers (no @cursor/sdk) for Python tests and lightweight imports. */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

export function toolPolicy(control) {
  if (control) {
    return { tools: ["mcp", "read", "grep", "glob", "ls", "semSearch", "webSearch", "webFetch"] };
  }
  return {
    tools: ["mcp", "read", "grep", "glob", "ls"],
    disallowedTools: ["edit", "delete", "shell", "applyAgentDiff"],
  };
}

export function turnText({ system, prompt, resumed }) {
  const body = String(prompt || "").trim();
  const ident = String(system || "").trim();
  if (!resumed && ident) return `${ident}\n\n${body}`;
  return body;
}
