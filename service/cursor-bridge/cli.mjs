#!/usr/bin/env node
/** Local Cursor SDK sidecar. stdin JSON for chat; stdout is Ollama-shaped NDJSON. */
import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";
import {
  appendStats,
  pickAccount,
  pickBilled,
  pickCost,
  pickUsage,
} from "./stats.mjs";
import {
  openAgent,
  readSession,
  toolLabel,
  turnText,
  writeSession,
} from "./harness.mjs";

const DEFAULT_MODEL = "grok-4.6";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function accountMeta() {
  try {
    const me = await Cursor.me({ apiKey: process.env.CURSOR_API_KEY });
    return pickAccount(me);
  } catch {
    return undefined;
  }
}

async function fetchBilled(agent) {
  let last;
  for (let i = 0; i < 4; i += 1) {
    try {
      last = await agent.getUsage();
      if (last?.cost || (last?.usage && last.usage.totalTokens > 0)) return last;
    } catch (err) {
      last = { error: err instanceof Error ? err.message : String(err) };
      break;
    }
    await sleep(350);
  }
  return last;
}

function skipped(op) {
  return String(process.env.ZOTO_VIZ_CURSOR_STATS_SKIP || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .includes(String(op || ""));
}

function recordStats(partial) {
  if (skipped(partial?.op)) return undefined;
  try {
    return appendStats(partial);
  } catch (err) {
    return {
      ...partial,
      t: Date.now() / 1000,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function systemFor(control) {
  return [
    "You are the zoto-viz operator running through the Cursor SDK on this machine.",
    "Read the LAN snapshot, Screen HUD, Facts, and Recent chat. Never invent packet contents.",
    "Discuss what the operator wants, then GENERATE new capabilities — plugins, skies, datasources, visualisation methods.",
    "Do not only cycle the existing catalog. When the ask is clear, ACT in the same turn: invent and BUILD.",
    "When you invent a visualisation, BUILD it: emit every file as a path-tagged fence",
    "(```yaml plugin.yml, ```yaml visualisation.yml, ```ts frontend/index.ts, ```glsl sky/fragment.glsl)",
    "AND call the zoto-viz MCP tool publish_local_plugin with that files tree so the view goes live.",
    "New host sources: MCP set_source. Unique mosaic skies: invent a plugin sky per colliding pane and set anim.mosaicUniqueSkies / mosaicSkies.",
    "Use a catalog-unique id. Do not git add or commit.",
    control
      ? "AI Control is on: you may call set_settings, set_view, publish_local_plugin, set_source, and set_agent."
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
  const stats = recordStats({
    op: "list",
    ok: true,
    models: rows.length,
    account: await accountMeta(),
  });
  write({
    ok: true,
    models: rows,
    default: pickDefault(rows.map((r) => r.id)),
    ...(stats ? { stats } : {}),
  });
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
  const reset = body.reset === true;
  if (!prompt) {
    write({ error: "prompt required", done: true });
    process.exit(1);
  }
  const prior = readSession();
  const resumeId = (!reset && prior && (!prior.model || prior.model === model))
    ? prior.agentId
    : "";
  let agent;
  let resumed = false;
  try {
    ({ agent, resumed } = await openAgent({
      apiKey: process.env.CURSOR_API_KEY,
      model,
      control,
      agentId: resumeId,
      reset,
    }));
  } catch (err) {
    const msg = err instanceof CursorAgentError
      ? `startup failed: ${err.message}`
      : (err instanceof Error ? err.message : String(err));
    write({ error: msg, done: true });
    process.exit(1);
  }
  write({ session: { agentId: agent.agentId, resumed, model } });
  let streamUsage;
  const tools = [];
  try {
    const run = await agent.send({ text: turnText({ system, prompt, resumed }) });
    write({ session: { agentId: agent.agentId, runId: run.id } });
    for await (const event of run.stream()) {
      const type = event?.type || "";
      if (type === "usage" && event?.usage) streamUsage = event.usage;
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
        const name = toolLabel(event) || "tool";
        const status = event?.status || "running";
        tools.push({ name, status });
        write({ message: { thinking: `[${name}] ` }, tool: { name, status } });
      }
    }
    if (!run.supports("wait")) {
      write({ error: run.unsupportedReason?.("wait") || "wait unsupported", done: true });
      process.exitCode = 2;
      return;
    }
    const result = await run.wait();
    const billed = await fetchBilled(agent);
    writeSession({ agentId: agent.agentId, model });
    const stats = recordStats({
      op: "chat",
      model,
      status: result?.status,
      runId: result?.id || run.id,
      agentId: agent.agentId,
      resumed,
      tools,
      durationMs: result?.durationMs,
      usage: pickUsage(result?.usage || run.usage || streamUsage),
      cost: pickCost(billed?.cost),
      billed: pickBilled(billed),
      account: await accountMeta(),
      error: result?.status === "error"
        ? (result?.error?.message || (result.id ? `run failed: ${result.id}` : "run failed"))
        : undefined,
    });
    if (result?.status === "error") {
      write({ error: stats?.error || "run failed", stats, done: true });
      process.exitCode = 2;
      return;
    }
    write({ stats, done: true });
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
  let billed;
  const agentId = result?.agentId || result?.agent_id;
  if (typeof agentId === "string" && agentId) {
    try {
      billed = await Agent.getUsage(agentId, { apiKey: process.env.CURSOR_API_KEY });
    } catch (err) {
      billed = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  const stats = recordStats({
    op: "still",
    model,
    status: result?.status,
    runId: result?.id,
    agentId: typeof agentId === "string" ? agentId : undefined,
    durationMs: result?.durationMs,
    usage: pickUsage(result?.usage),
    cost: pickCost(billed?.cost || result?.cost),
    billed: pickBilled(billed),
    account: await accountMeta(),
  });
  write({ ok: result?.status === "finished", svg: text, status: result?.status, stats, done: true });
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
  const stats = recordStats({
    op: cmd,
    error: err instanceof Error ? err.message : String(err),
  });
  write({ error: err instanceof Error ? err.message : String(err), stats, done: true });
  process.exit(1);
}
