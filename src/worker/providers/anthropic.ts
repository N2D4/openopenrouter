import type { CatalogModel } from "../catalog";
import type { Env } from "../env";
import { ApiError } from "../errors";
import { emptyUsage, fromAnthropicUsage, type NormalizedUsage } from "../pricing";
import { parseSse } from "../sse";
import { type ChatStream, upstreamFailure, UpstreamError } from "./types";

const BASE = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";

export function anthropicHeaders(env: Env, extra: Record<string, string> = {}) {
  if (!env.ANTHROPIC_API_KEY) throw new ApiError(503, "Anthropic is not configured on this instance");
  return { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": VERSION, "content-type": "application/json", ...extra };
}

export async function anthropicFetch(env: Env, body: unknown, extraHeaders: Record<string, string> = {}, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/messages`, { method: "POST", headers: anthropicHeaders(env, extraHeaders), body: JSON.stringify(body), signal });
  } catch (e) {
    throw new UpstreamError(502, `Anthropic: network error (${(e as Error).message})`, true, { provider_name: "Anthropic" });
  }
  if (!res.ok) throw await upstreamFailure(res, "Anthropic");
  return res;
}

// ---------------------------------------------------------------------------
// Chat Completions → Messages
// ---------------------------------------------------------------------------

function dataUrlSource(url: string) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (m) return { type: "base64", media_type: m[1], data: m[2] };
  return { type: "url", url };
}

function convertPart(p: any): any {
  const cc = p.cache_control ? { cache_control: p.cache_control } : {};
  switch (p.type) {
    case "text":
      return { type: "text", text: p.text, ...cc };
    case "image_url": {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
      return { type: "image", source: dataUrlSource(url), ...cc };
    }
    case "file": {
      const data: string | undefined = p.file?.file_data ?? p.file?.fileData;
      if (!data) throw new ApiError(400, "file parts need file.file_data");
      const src = dataUrlSource(data);
      if (src.type === "base64" && src.media_type?.startsWith("text/")) {
        return { type: "document", source: { type: "text", media_type: "text/plain", data: atob(src.data!) }, title: p.file?.filename, ...cc };
      }
      return { type: "document", source: src, title: p.file?.filename, ...cc };
    }
    case "input_audio":
      throw new ApiError(400, "Audio input is not supported by Anthropic models");
    default:
      return null;
  }
}

function toBlocks(content: any): any[] {
  if (content == null) return [];
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
  return content.map(convertPart).filter(Boolean);
}

/** reasoning_details from a previous turn → thinking blocks (required for multi-turn tool use with thinking). */
function thinkingBlocks(details: any[] | undefined): any[] {
  if (!Array.isArray(details)) return [];
  const byIndex = new Map<number, any>();
  const out: any[] = [];
  for (const d of details) {
    if (d?.format && d.format !== "anthropic-claude-v1" && d.format !== "unknown") continue;
    if (d?.type === "reasoning.encrypted" && d.data) out.push({ type: "redacted_thinking", data: d.data });
    else if (d?.type === "reasoning.text") {
      const idx = d.index ?? 0;
      const cur = byIndex.get(idx) ?? { type: "thinking", thinking: "", signature: "" };
      cur.thinking += d.text ?? "";
      if (d.signature) cur.signature = d.signature;
      if (!byIndex.has(idx)) {
        byIndex.set(idx, cur);
        out.push(cur);
      }
    }
  }
  return out.filter((b) => b.type !== "thinking" || b.signature);
}

export function toAnthropicRequest(body: any, m: CatalogModel, stream: boolean) {
  const system: any[] = [];
  const messages: any[] = [];
  const push = (role: "user" | "assistant", blocks: any[]) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const msg of body.messages ?? []) {
    switch (msg.role) {
      case "system":
      case "developer":
        system.push(...toBlocks(msg.content).filter((b) => b.type === "text"));
        break;
      case "user":
        push("user", toBlocks(msg.content));
        break;
      case "assistant": {
        const blocks = [...thinkingBlocks(msg.reasoning_details), ...toBlocks(msg.content)];
        for (const tc of msg.tool_calls ?? []) {
          let input: unknown = {};
          try {
            input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          } catch {
            input = {};
          }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input });
        }
        push("assistant", blocks);
        break;
      }
      case "tool": {
        const content = typeof msg.content === "string" ? msg.content : toBlocks(msg.content);
        push("user", [{ type: "tool_result", tool_use_id: msg.tool_call_id, content }]);
        break;
      }
      default:
        throw new ApiError(400, `Unsupported message role: ${msg.role}`);
    }
  }
  if (!messages.length) throw new ApiError(400, "At least one user or assistant message is required");

  const supported = new Set(m.supported_parameters);
  const maxOut = m.top_provider.max_completion_tokens ?? 64000;
  const requested = body.max_completion_tokens ?? body.max_tokens;
  const out: any = {
    model: m._upstream_id,
    messages,
    max_tokens: Math.min(requested ?? (stream ? 64000 : 16000), maxOut),
    stream: true,
  };
  if (system.length) out.system = system;
  for (const k of ["temperature", "top_p", "top_k"]) if (body[k] != null && supported.has(k)) out[k] = body[k];
  if (body.stop != null && supported.has("stop")) out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (body.user) out.metadata = { user_id: String(body.user).slice(0, 256) };

  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools
      .filter((t: any) => t.type === "function" || t.function)
      .map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
        ...(t.function.strict ? { strict: true } : {}),
        ...(t.cache_control ? { cache_control: t.cache_control } : {}),
      }));
    const tc = body.tool_choice;
    if (tc === "none") out.tool_choice = { type: "none" };
    else if (tc === "required") out.tool_choice = { type: "any" };
    else if (tc && typeof tc === "object") out.tool_choice = { type: "tool", name: tc.function?.name };
    else out.tool_choice = { type: "auto" };
    if (body.parallel_tool_calls === false) out.tool_choice.disable_parallel_tool_use = true;
  }

  // Reasoning. Newer Claude models use adaptive thinking + output_config.effort;
  // older ones (4.5 generation) take an explicit thinking budget.
  const r = body.reasoning ?? {};
  const effortRaw: string | undefined = r.effort ?? body.reasoning_effort;
  const wantsReasoning = r.enabled === true || effortRaw != null || r.max_tokens != null || body.include_reasoning === true;
  const efforts = m.reasoning?.supported_efforts ?? [];
  const adaptive = m.reasoning?.mandatory || efforts.includes("xhigh") || efforts.includes("max") || /claude-(opus|sonnet)-4-6/.test(m._upstream_id);
  const outputConfig: any = {};
  if (supported.has("reasoning") && r.enabled !== false) {
    if (adaptive) {
      if (m.reasoning?.mandatory || wantsReasoning) out.thinking = { type: "adaptive", display: r.exclude ? "omitted" : "summarized" };
      const effort = effortRaw === "minimal" || effortRaw === "none" ? "low" : effortRaw;
      if (effort && (efforts.length === 0 || efforts.includes(effort))) outputConfig.effort = effort;
    } else if (wantsReasoning) {
      const budget = r.max_tokens ?? ({ minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 32000, max: 32000 } as Record<string, number>)[effortRaw ?? "medium"] ?? 8192;
      const b = Math.max(1024, Math.min(budget, out.max_tokens - 1024));
      if (out.max_tokens <= 1024) out.max_tokens = Math.min(maxOut, b + 4096);
      out.thinking = { type: "enabled", budget_tokens: b };
      delete out.temperature;
      delete out.top_p;
      delete out.top_k;
    }
  }
  if (body.verbosity && supported.has("verbosity")) {
    // Anthropic has no verbosity knob; map to effort only when none was requested.
    if (!outputConfig.effort && adaptive) outputConfig.effort = body.verbosity === "low" ? "low" : body.verbosity === "high" ? "high" : undefined;
    if (!outputConfig.effort) delete outputConfig.effort;
  }
  const rf = body.response_format;
  if (rf?.type === "json_schema" && rf.json_schema?.schema) outputConfig.format = { type: "json_schema", schema: rf.json_schema.schema };
  else if (rf?.type === "json_object") {
    out.system = [...(out.system ?? []), { type: "text", text: "Respond only with a single valid JSON object." }];
  }
  if (Object.keys(outputConfig).length) out.output_config = outputConfig;
  return out;
}

const STOP_MAP: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
  pause_turn: "stop",
  model_context_window_exceeded: "length",
};

/** Run a chat request against Anthropic, yielding OpenRouter chat deltas. */
export async function anthropicChatStream(env: Env, m: CatalogModel, body: any, signal?: AbortSignal): Promise<ChatStream> {
  const req = toAnthropicRequest(body, m, body.stream === true);
  let res: Response;
  try {
    res = await anthropicFetch(env, req, {}, signal);
  } catch (e) {
    // Newer models reject forced tool choice; retry with "auto" like OpenRouter does.
    if (e instanceof UpstreamError && e.status === 400 && req.tool_choice && /tool_choice/i.test(e.message)) {
      req.tool_choice = { type: "auto", ...(req.tool_choice.disable_parallel_tool_use ? { disable_parallel_tool_use: true } : {}) };
      res = await anthropicFetch(env, req, {}, signal);
    } else throw e;
  }
  return (async function* () {
    let usage: NormalizedUsage = emptyUsage();
    let rawUsage: any = {};
    let upstreamId: string | undefined;
    let stopReason: string | null = null;
    const blockKinds = new Map<number, { kind: string; tool?: number }>();
    let toolCount = 0;
    for await (const ev of parseSse(res.body!)) {
      let j: any;
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      switch (j.type) {
        case "message_start":
          upstreamId = j.message?.id;
          rawUsage = { ...(j.message?.usage ?? {}) };
          yield { delta: { role: "assistant", content: "" }, upstream_id: upstreamId, partialUsage: fromAnthropicUsage(rawUsage) };
          break;
        case "content_block_start": {
          const b = j.content_block ?? {};
          if (b.type === "tool_use" || b.type === "server_tool_use") {
            const idx = toolCount++;
            blockKinds.set(j.index, { kind: "tool", tool: idx });
            yield { delta: { tool_calls: [{ index: idx, id: b.id, type: "function", function: { name: b.name, arguments: "" } }] } };
          } else if (b.type === "redacted_thinking") {
            blockKinds.set(j.index, { kind: "redacted" });
            yield { delta: { reasoning_details: [{ type: "reasoning.encrypted", data: b.data, format: "anthropic-claude-v1", index: j.index }] } };
          } else {
            blockKinds.set(j.index, { kind: b.type });
            if (b.type === "text" && b.text) yield { delta: { content: b.text } };
          }
          break;
        }
        case "content_block_delta": {
          const d = j.delta ?? {};
          if (d.type === "text_delta") yield { delta: { content: d.text } };
          else if (d.type === "thinking_delta") {
            yield { delta: { reasoning: d.thinking, reasoning_details: [{ type: "reasoning.text", text: d.thinking, format: "anthropic-claude-v1", index: j.index }] } };
          } else if (d.type === "signature_delta") {
            yield { delta: { reasoning_details: [{ type: "reasoning.text", text: "", signature: d.signature, format: "anthropic-claude-v1", index: j.index }] } };
          } else if (d.type === "input_json_delta") {
            const k = blockKinds.get(j.index);
            if (k?.tool != null) yield { delta: { tool_calls: [{ index: k.tool, function: { arguments: d.partial_json } }] } };
          }
          break;
        }
        case "message_delta":
          if (j.delta?.stop_reason) stopReason = j.delta.stop_reason;
          if (j.usage) rawUsage = { ...rawUsage, ...Object.fromEntries(Object.entries(j.usage).filter(([, v]) => v != null)) };
          break;
        case "message_stop":
          usage = fromAnthropicUsage(rawUsage);
          yield { finish_reason: STOP_MAP[stopReason ?? "end_turn"] ?? "stop", native_finish_reason: stopReason, usage, upstream_id: upstreamId };
          return;
        case "error":
          yield { error: { code: j.error?.type === "overloaded_error" ? 502 : 500, message: `Anthropic: ${j.error?.message ?? "stream error"}` }, usage: fromAnthropicUsage(rawUsage) };
          return;
      }
    }
    // Stream ended without message_stop (e.g. client abort): still bill what was used.
    yield { finish_reason: null, usage: fromAnthropicUsage(rawUsage), upstream_id: upstreamId };
  })();
}
