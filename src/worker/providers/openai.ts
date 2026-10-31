import type { CatalogModel } from "../catalog";
import type { Env } from "../env";
import { ApiError } from "../errors";
import { emptyUsage, fromOpenAIChatUsage, fromOpenAIResponsesUsage } from "../pricing";
import { parseSse } from "../sse";
import { type ChatChunk, type ChatStream, upstreamFailure, UpstreamError } from "./types";

const BASE = "https://api.openai.com/v1";

export function openaiHeaders(env: Env) {
  if (!env.OPENAI_API_KEY) throw new ApiError(503, "OpenAI is not configured on this instance");
  return { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" };
}

export async function openaiFetch(env: Env, path: string, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: "POST", headers: openaiHeaders(env), body: JSON.stringify(body), signal });
  } catch (e) {
    throw new UpstreamError(502, `OpenAI: network error (${(e as Error).message})`, true, { provider_name: "OpenAI" });
  }
  if (!res.ok) throw await upstreamFailure(res, "OpenAI");
  return res;
}

/** Sampling/feature parameters that are only forwarded when the model lists them as supported. */
const GATED = [
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "logit_bias",
  "logprobs",
  "top_logprobs",
  "stop",
  "response_format",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "verbosity",
  "web_search_options",
];
/**
 * Always forwarded when present. Deliberately excluded: `service_tier` (priority tier costs more than the
 * catalog price) and `modalities`/`audio` (audio output tokens are priced differently).
 */
const PASSTHROUGH = ["user", "metadata", "prediction", "prompt_cache_key", "safety_identifier"];

function reasoningEffort(body: any, m: CatalogModel): string | undefined {
  const supported = m.supported_parameters.includes("reasoning") || m.supported_parameters.includes("reasoning_effort");
  if (!supported) return undefined;
  const r = body.reasoning;
  if (r && typeof r === "object") {
    if (r.enabled === false) return undefined;
    if (typeof r.effort === "string") return r.effort === "max" ? "xhigh" : r.effort;
    if (typeof r.max_tokens === "number") return r.max_tokens >= 32000 ? "high" : r.max_tokens >= 8000 ? "medium" : "low";
  }
  if (typeof body.reasoning_effort === "string") return body.reasoning_effort;
  return undefined;
}

/** Chat Completions request → OpenAI chat request. */
export function toOpenAIChat(body: any, m: CatalogModel) {
  const supported = new Set(m.supported_parameters);
  const out: any = { model: m._upstream_id, messages: sanitizeMessages(body.messages), stream: true, stream_options: { include_usage: true } };
  for (const k of GATED) if (body[k] !== undefined && supported.has(k)) out[k] = body[k];
  for (const k of PASSTHROUGH) if (body[k] !== undefined) out[k] = body[k];
  const max = body.max_completion_tokens ?? body.max_tokens;
  if (max != null && (supported.has("max_tokens") || supported.has("max_completion_tokens"))) out.max_completion_tokens = max;
  const effort = reasoningEffort(body, m);
  if (effort) out.reasoning_effort = effort;
  if (out.response_format?.type === "json_schema" && body.structured_outputs === false) out.response_format = { type: "json_object" };
  return out;
}

/** Remove OpenRouter-only message fields that OpenAI rejects. */
function sanitizeMessages(messages: any[]) {
  if (!Array.isArray(messages)) throw new ApiError(400, "messages must be an array");
  return messages.map((msg) => {
    const { reasoning, reasoning_details, ...rest } = msg ?? {};
    if (Array.isArray(rest.content)) {
      rest.content = rest.content.map((p: any) => {
        if (p?.cache_control) {
          const { cache_control, ...q } = p;
          return q;
        }
        return p;
      });
    }
    return rest;
  });
}

export async function openaiChatStream(env: Env, m: CatalogModel, body: any, signal?: AbortSignal): Promise<ChatStream> {
  if (m._api === "responses") return openaiResponsesAsChat(env, m, body, signal);
  const res = await openaiFetch(env, "/chat/completions", toOpenAIChat(body, m), signal);
  return (async function* () {
    let upstreamId: string | undefined;
    for await (const ev of parseSse(res.body!)) {
      if (ev.data === "[DONE]") break;
      let j: any;
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      if (j.error) {
        yield { error: { code: 502, message: `OpenAI: ${j.error.message ?? "stream error"}` } };
        return;
      }
      upstreamId ??= j.id;
      const choice = j.choices?.[0];
      const chunk: ChatChunk = { upstream_id: j.id, system_fingerprint: j.system_fingerprint ?? null };
      if (choice) {
        chunk.delta = choice.delta ?? {};
        if (choice.finish_reason) {
          chunk.finish_reason = choice.finish_reason;
          chunk.native_finish_reason = choice.finish_reason;
        }
        if (choice.logprobs) chunk.logprobs = choice.logprobs;
      }
      if (j.usage) chunk.usage = fromOpenAIChatUsage(j.usage);
      if (chunk.delta || chunk.finish_reason || chunk.usage) yield chunk;
    }
  })();
}

// ---------------------------------------------------------------------------
// Responses-only models (o*-pro, *-codex, ...) served behind the Chat API.
// ---------------------------------------------------------------------------

function partsToResponsesContent(content: any, role: string) {
  if (typeof content === "string" || content == null) return content ?? "";
  const textType = role === "assistant" ? "output_text" : "input_text";
  return content
    .map((p: any) => {
      if (p.type === "text") return { type: textType, text: p.text };
      if (p.type === "image_url") return { type: "input_image", image_url: typeof p.image_url === "string" ? p.image_url : p.image_url?.url, detail: p.image_url?.detail ?? "auto" };
      if (p.type === "file") return { type: "input_file", filename: p.file?.filename, file_data: p.file?.file_data ?? p.file?.fileData };
      if (p.type === "input_audio") throw new ApiError(400, "Audio input is not supported for this model");
      return null;
    })
    .filter(Boolean);
}

export function chatToResponsesRequest(body: any, m: CatalogModel) {
  const input: any[] = [];
  for (const msg of body.messages ?? []) {
    if (msg.role === "tool") {
      input.push({ type: "function_call_output", call_id: msg.tool_call_id, output: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      continue;
    }
    const role = msg.role === "system" ? "developer" : msg.role;
    const hasContent = msg.content != null && !(Array.isArray(msg.content) && msg.content.length === 0) && msg.content !== "";
    if (hasContent) input.push({ role, content: partsToResponsesContent(msg.content, role) });
    for (const tc of msg.tool_calls ?? []) {
      input.push({ type: "function_call", call_id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments ?? "{}" });
    }
  }
  const out: any = { model: m._upstream_id, input, stream: true, store: false };
  const supported = new Set(m.supported_parameters);
  if (body.tools && supported.has("tools")) {
    out.tools = body.tools.map((t: any) => ({ type: "function", name: t.function?.name, description: t.function?.description, parameters: t.function?.parameters ?? {}, strict: t.function?.strict ?? false }));
  }
  if (body.tool_choice && supported.has("tool_choice")) {
    out.tool_choice = typeof body.tool_choice === "string" ? body.tool_choice : { type: "function", name: body.tool_choice.function?.name };
  }
  if (body.parallel_tool_calls != null) out.parallel_tool_calls = body.parallel_tool_calls;
  const max = body.max_completion_tokens ?? body.max_tokens;
  if (max != null) out.max_output_tokens = max;
  const effort = reasoningEffort(body, m);
  out.reasoning = { summary: "auto", ...(effort ? { effort } : {}) };
  const rf = body.response_format;
  if (rf?.type === "json_schema") out.text = { format: { type: "json_schema", name: rf.json_schema?.name ?? "response", schema: rf.json_schema?.schema, strict: rf.json_schema?.strict ?? false } };
  else if (rf?.type === "json_object") out.text = { format: { type: "json_object" } };
  if (body.verbosity) out.text = { ...(out.text ?? {}), verbosity: body.verbosity };
  for (const k of ["user", "metadata", "prompt_cache_key", "safety_identifier"]) if (body[k] !== undefined) out[k] = body[k];
  if (body.temperature != null && supported.has("temperature")) out.temperature = body.temperature;
  if (body.top_p != null && supported.has("top_p")) out.top_p = body.top_p;
  return out;
}

async function openaiResponsesAsChat(env: Env, m: CatalogModel, body: any, signal?: AbortSignal): Promise<ChatStream> {
  const res = await openaiFetch(env, "/responses", chatToResponsesRequest(body, m), signal);
  return (async function* () {
    const toolIndex = new Map<string, number>();
    let sawTool = false;
    let upstreamId: string | undefined;
    yield { delta: { role: "assistant", content: "" } };
    for await (const ev of parseSse(res.body!)) {
      let j: any;
      try {
        j = JSON.parse(ev.data);
      } catch {
        continue;
      }
      const type = j.type ?? ev.event;
      if (type === "response.created") upstreamId = j.response?.id;
      else if (type === "response.output_text.delta") yield { delta: { content: j.delta } };
      else if (type === "response.refusal.delta") yield { delta: { refusal: j.delta } };
      else if (type === "response.reasoning_summary_text.delta") {
        yield { delta: { reasoning: j.delta, reasoning_details: [{ type: "reasoning.summary", summary: j.delta, format: "openai-responses-v1", index: j.summary_index ?? 0 }] } };
      } else if (type === "response.output_item.added" && j.item?.type === "function_call") {
        const idx = toolIndex.size;
        toolIndex.set(j.item.id, idx);
        sawTool = true;
        yield { delta: { tool_calls: [{ index: idx, id: j.item.call_id, type: "function", function: { name: j.item.name, arguments: "" } }] } };
      } else if (type === "response.function_call_arguments.delta") {
        const idx = toolIndex.get(j.item_id) ?? 0;
        yield { delta: { tool_calls: [{ index: idx, function: { arguments: j.delta } }] } };
      } else if (type === "response.output_item.done" && j.item?.type === "reasoning" && j.item.encrypted_content) {
        yield { delta: { reasoning_details: [{ type: "reasoning.encrypted", data: j.item.encrypted_content, id: j.item.id, format: "openai-responses-v1", index: 0 }] } };
      } else if (type === "response.completed" || type === "response.incomplete") {
        const r = j.response ?? {};
        const incomplete = r.status === "incomplete";
        const reason = incomplete ? (r.incomplete_details?.reason === "max_output_tokens" ? "length" : "content_filter") : sawTool ? "tool_calls" : "stop";
        yield { finish_reason: reason, native_finish_reason: incomplete ? (r.incomplete_details?.reason ?? "incomplete") : "completed", usage: fromOpenAIResponsesUsage(r.usage), upstream_id: upstreamId };
        return;
      } else if (type === "response.failed" || type === "error") {
        const err = j.response?.error ?? j.error ?? j;
        yield { error: { code: 502, message: `OpenAI: ${err?.message ?? "response failed"}` }, usage: emptyUsage() };
        return;
      }
    }
  })();
}
