#!/usr/bin/env node
/** Local Cursor SDK sidecar. stdin JSON for chat; stdout is Ollama-shaped NDJSON. */
import { Agent, Cursor } from "@cursor/sdk";

const DEFAULT_MODEL = "grok-4.5";

function write(row) {
  process.stdout.write(`${JSON.stringify(row)}\n`);
}

function mcpUrl() {
  return process.env.ZOTO_VIZ_MCP || "http://127.0.0.1:7020/mcp";
}

function repoRoot() {
  return process.env.ZOTO_VIZ_REPO_ROOT || process.cwd();
}

function pickDefault(ids) {
  const grok = ids.find((id) => /^grok/i.test(id));
  return grok || (ids.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : ids[0] || DEFAULT_MODEL);
}

function systemFor(control) {
  return [
    "You are the zoto-viz operator running through the Cursor SDK on this machine.",
    "Read the LAN snapshot and Screen HUD in the user prompt. Never invent packet contents.",
    "When you invent a visualisation, BUILD it: emit every file as a path-tagged fence",
    "(```yaml plugin.yml, ```yaml visualisation.yml, ```ts frontend/index.ts, ```glsl sky/fragment.glsl)",
    "AND call the zoto-viz MCP tool publish_local_plugin with that files tree so the view goes live.",
    "Use a catalog-unique id. Do not git add or commit.",
    control
      ? "AI Control is on: you may call set_settings, set_view, publish_local_plugin, and set_agent."
      : "AI Control is off: do not change settings or install plugins; describe the draft and ask them to enable Control.",
  ].join(" ");
}

async function listModels() {
  const models = await Cursor.models.list({ apiKey: process.env.CURSOR_API_KEY });
  const rows = (models || []).map((m) => ({
    id: m.id,
    label: m.displayName || m.id,
    hint: m.description || "",
  }));
  write({ ok: true, models: rows, default: pickDefault(rows.map((r) => r.id)) });
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function textOf(event) {
  const msg = event?.message;
  const blocks = msg?.content;
  if (!Array.isArray(blocks)) {
    if (typeof msg?.text === "string") return msg.text;
    if (typeof event?.text === "string") return event.text;
    return "";
  }
  return blocks.map((b) => (b && b.type === "text" ? b.text : "")).join("");
}

async function chat() {
  const body = await readStdin();
  const model = String(body.model || process.argv[process.argv.indexOf("--model") + 1] || DEFAULT_MODEL);
  const control = body.control === true || process.env.ZOTO_VIZ_AI_CONTROL === "1";
  const system = String(body.system || systemFor(control));
  const prompt = String(body.prompt || "").trim();
  if (!prompt) {
    write({ error: "prompt required", done: true });
    process.exit(1);
  }
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: model },
    local: { cwd: repoRoot(), settingSources: [] },
    mcpServers: {
      "zoto-viz": { type: "http", url: mcpUrl() },
    },
  });
  try {
    const run = await agent.send({
      text: `${system}\n\n${prompt}`,
    });
    for await (const event of run.stream()) {
      const type = event?.type || "";
      if (type === "assistant" || type === "assistant_delta") {
        const text = textOf(event);
        if (text) write({ message: { content: text } });
        continue;
      }
      if (type === "thinking" || type === "reasoning") {
        const text = textOf(event) || event?.text || "";
        if (text) write({ message: { thinking: String(text) } });
        continue;
      }
      if (type === "tool_call" || type === "tool-call" || type === "action") {
        const name = event?.toolName || event?.name || event?.data?.toolName || "tool";
        write({ message: { thinking: `[${name}] ` } });
      }
    }
    const result = await run.wait();
    if (result?.status === "error") {
      write({ error: result.id ? `run failed: ${result.id}` : "run failed", done: true });
      process.exitCode = 2;
      return;
    }
    write({ done: true });
  } finally {
    const dispose = agent[Symbol.asyncDispose];
    if (typeof dispose === "function") await dispose.call(agent);
    else if (typeof agent.close === "function") await agent.close();
  }
}

async function still() {
  const body = await readStdin();
  const title = String(body.title || body.prompt || "").trim();
  const model = String(body.model || "composer-2.5");
  if (!title) {
    write({ error: "title required", done: true });
    process.exit(1);
  }
  const result = await Agent.prompt(
    [
      "Illustrate this Hacker News headline as one self-contained SVG.",
      "Output ONLY an <svg>...</svg> document. No markdown, no explanation.",
      "Landscape like a NASA image of the day: viewBox 0 0 1600 900 (16:9). Do not draw a square.",
      "Bold shapes, limited palette (orange #ff6600, black, cream). Fill the wide frame; no letterbox bars.",
      `Headline: ${title}`,
    ].join(" "),
    {
      apiKey: process.env.CURSOR_API_KEY,
      model: { id: model },
      local: { cwd: repoRoot(), settingSources: [] },
    },
  );
  const text = typeof result?.result === "string"
    ? result.result
    : (result?.result && typeof result.result === "object" && "text" in result.result)
      ? String(result.result.text)
      : JSON.stringify(result?.result ?? "");
  write({ ok: result?.status === "finished", svg: text, status: result?.status, done: true });
}

const cmd = process.argv[2] || "list";
try {
  if (cmd === "list") await listModels();
  else if (cmd === "chat") await chat();
  else if (cmd === "still") await still();
  else {
    write({ error: `unknown command ${cmd}` });
    process.exit(1);
  }
} catch (err) {
  write({ error: err instanceof Error ? err.message : String(err), done: true });
  process.exit(1);
}
