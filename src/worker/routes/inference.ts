import type { Context } from "hono";
import { type ApiKeyAuth, authenticateApiKey } from "../auth";
import { preflight, recordGeneration } from "../billing";
import { type CatalogModel, PROVIDERS, resolveModel } from "../catalog";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { computeCost, emptyUsage, fromAnthropicUsage, fromOpenAIResponsesUsage, type NormalizedUsage, usageObject } from "../pricing";
import { anthropicFetch } from "../providers/anthropic";
import { openaiFetch } from "../providers/openai";
import type { ChatChunk } from "../providers/types";
import { UpstreamError } from "../providers/types";
import { candidateModels, excludeReasoning, GenerationTracker, MessageAccumulator, requestMeta, type StartedChat, startChat } from "../router";
import { SSE_HEADERS, SseWriter, parseSse } from "../sse";
import { generationId, jsonResponse } from "../util";

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export async function readJson(c: Context<AppEnv>): Promise<any> {
  const len = Number(c.req.header("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new ApiError(413, "Request body too large");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Request body must be a JSON object");
  return body;
}

export async function inferenceAuth(c: Context<AppEnv>): Promise<ApiKeyAuth> {
  const auth = await authenticateApiKey(c, { management: false });
  const { success } = await c.env.KEY_LIMITER.limit({ key: auth.key.hash });
  if (!success) throw new ApiError(429, "Rate limit exceeded for this API key. Slow down and retry shortly.");
  return auth;
}

const stripReasoning = (d: ChatChunk["delta"]) => {
  if (!d) return d;
  const { reasoning, reasoning_details, ...rest } = d;
  return rest;
};

const providerName = (m: CatalogModel) => PROVIDERS[m._provider].name;

function newTracker(body: any) {
  const t = new GenerationTracker();
  t.promptEstimate = Math.ceil(JSON.stringify(body?.messages ?? body?.input ?? body?.prompt ?? "").length / 4);
  return t;
}

// ---------------------------------------------------------------------------
// POST /api/v1/chat/completions
// ---------------------------------------------------------------------------

export async function chatCompletions(c: Context<AppEnv>) {
  const auth = await inferenceAuth(c);
  const body = await readJson(c);
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    if (typeof body.prompt === "string") body.messages = [{ role: "user", content: body.prompt }];
    else throw new ApiError(400, "messages is required and must be a non-empty array");
  }
  if (body.n != null && body.n !== 1) throw new ApiError(400, "n > 1 is not supported");
  const started = await startChat(c, auth, body, c.req.raw.signal);
  return renderChat(c, auth, body, started, "chat");
}

/** Render a started chat as either Chat Completions or legacy Completions output. */
async function renderChat(c: Context<AppEnv>, auth: ApiKeyAuth, body: any, started: StartedChat, format: "chat" | "text") {
  const tracker = newTracker(body);
  const m = started.model;
  const created = Math.floor(started.startedAt / 1000);
  const base = { id: started.id, provider: providerName(m), model: m.id, object: format === "chat" ? "chat.completion.chunk" : "text_completion", created };
  const exclude = excludeReasoning(body);

  if (body.stream === true) {
    const w = new SseWriter();
    const pump = async () => {
      let cancelled = false;
      try {
        for await (const chunk of started.stream) {
          tracker.observe(chunk);
          if (chunk.error) {
            await w.data({ ...base, error: chunk.error, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error", native_finish_reason: null }] });
            break;
          }
          if (chunk.delta || chunk.finish_reason) {
            const delta = (exclude ? stripReasoning(chunk.delta) : chunk.delta) ?? {};
            const hasDelta = Object.keys(delta).length > 0;
            if (!hasDelta && !chunk.finish_reason) continue;
            if (format === "chat") {
              await w.data({
                ...base,
                system_fingerprint: chunk.system_fingerprint ?? null,
                choices: [{ index: 0, delta, finish_reason: chunk.finish_reason ?? null, native_finish_reason: chunk.native_finish_reason ?? null, logprobs: chunk.logprobs ?? null }],
              });
            } else if (delta.content || chunk.finish_reason) {
              await w.data({ ...base, choices: [{ index: 0, text: delta.content ?? "", finish_reason: chunk.finish_reason ?? null, native_finish_reason: chunk.native_finish_reason ?? null, logprobs: null }] });
            }
          }
          if (w.isClosed) {
            cancelled = true;
            break;
          }
        }
        if (!cancelled) {
          await w.data({ ...base, choices: [], usage: usageObject(m, tracker.finalUsage()) });
          await w.data("[DONE]");
        }
      } catch (e) {
        cancelled = cancelled || w.isClosed || (e as Error)?.name === "AbortError";
        if (!cancelled) {
          tracker.error = (e as Error).message;
          tracker.status = 502;
          await w.data({ ...base, error: { code: 502, message: "Upstream stream failed" }, choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }] });
        }
      } finally {
        await w.close();
        await tracker.record(c, auth, started, { streamed: true, cancelled, body });
      }
    };
    c.executionCtx.waitUntil(pump());
    return new Response(w.readable, { headers: SSE_HEADERS });
  }

  const acc = new MessageAccumulator();
  try {
    for await (const chunk of started.stream) {
      tracker.observe(chunk);
      acc.add(chunk);
      if (chunk.error) break;
    }
  } catch (e) {
    tracker.error = (e as Error).message;
    tracker.status = 502;
  }
  c.executionCtx.waitUntil(tracker.record(c, auth, started, { streamed: false, cancelled: false, body }));
  if (tracker.error && !acc.content && !acc.toolCalls.length) throw new ApiError(tracker.status || 502, tracker.error);
  const usage = usageObject(m, tracker.finalUsage());
  if (format === "text") {
    return jsonResponse({ ...base, choices: [{ index: 0, text: acc.content, finish_reason: tracker.finishReason, native_finish_reason: tracker.nativeFinishReason, logprobs: null }], usage });
  }
  return jsonResponse({
    ...base,
    object: "chat.completion",
    system_fingerprint: acc.systemFingerprint,
    choices: [{ index: 0, logprobs: acc.logprobs, finish_reason: tracker.error ? "error" : tracker.finishReason, native_finish_reason: tracker.nativeFinishReason, message: acc.message(exclude) }],
    usage,
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/completions (legacy text completions)
// ---------------------------------------------------------------------------

export async function completions(c: Context<AppEnv>) {
  const auth = await inferenceAuth(c);
  const body = await readJson(c);
  const prompt = Array.isArray(body.prompt) ? body.prompt.join("") : body.prompt;
  if (typeof prompt !== "string") throw new ApiError(400, "prompt is required");
  const chatBody = { ...body, messages: [{ role: "user", content: prompt }] };
  delete chatBody.prompt;
  const started = await startChat(c, auth, chatBody, c.req.raw.signal);
  return renderChat(c, auth, chatBody, started, "text");
}

// ---------------------------------------------------------------------------
// POST /api/v1/embeddings
// ---------------------------------------------------------------------------

export async function embeddings(c: Context<AppEnv>) {
  const auth = await inferenceAuth(c);
  const body = await readJson(c);
  const m = resolveModel(body.model, c.env, "embeddings");
  preflight(auth, m);
  if (body.input == null) throw new ApiError(400, "input is required");
  const startedAt = Date.now();
  const upstreamBody: any = { model: m._upstream_id, input: body.input };
  for (const k of ["dimensions", "encoding_format", "user"]) if (body[k] != null) upstreamBody[k] = body[k];
  let res: Response;
  try {
    res = await openaiFetch(c.env, "/embeddings", upstreamBody, c.req.raw.signal);
  } catch (e) {
    if (e instanceof UpstreamError) throw new ApiError(e.status, e.message, e.metadata);
    throw e;
  }
  const j: any = await res.json();
  const usage: NormalizedUsage = { ...emptyUsage(), prompt_tokens: j.usage?.prompt_tokens ?? 0 };
  const id = generationId();
  c.executionCtx.waitUntil(
    recordGeneration(c.env, {
      id,
      auth,
      model: m,
      apiType: "embeddings",
      upstreamId: null,
      streamed: false,
      cancelled: false,
      finishReason: null,
      nativeFinishReason: null,
      usage,
      startedAt,
      firstTokenAt: null,
      status: 200,
      ...requestMeta(c),
      externalUser: typeof body.user === "string" ? body.user : null,
    }),
  );
  return jsonResponse({
    id,
    object: "list",
    data: j.data,
    model: m.id,
    provider: "OpenAI",
    usage: { prompt_tokens: usage.prompt_tokens, total_tokens: usage.prompt_tokens, cost: computeCost(m, usage).total },
  });
}

// ---------------------------------------------------------------------------
// POST /api/v1/responses (OpenAI Responses API; OpenAI models)
// ---------------------------------------------------------------------------

const OR_ONLY_FIELDS = ["models", "provider", "route", "transforms", "plugins", "usage", "session_id", "trace", "preset", "debug"];

export async function responses(c: Context<AppEnv>) {
  const auth = await inferenceAuth(c);
  const body = await readJson(c);
  const [m] = candidateModels(c, body);
  if (m._provider !== "openai") throw new ApiError(400, "The Responses API is only available for OpenAI models on this instance. Use /api/v1/chat/completions or /api/v1/messages instead.");
  preflight(auth, m);
  if (body.background) throw new ApiError(400, "Background responses are not supported on this instance");
  const builtin = (body.tools ?? []).find((t: any) => t?.type !== "function" && t?.type !== "custom");
  if (builtin) throw new ApiError(400, `Tool type "${builtin.type}" is not supported on this instance; use function tools`);
  const upstreamBody: any = { ...body, model: m._upstream_id, store: body.store === true };
  for (const k of [...OR_ONLY_FIELDS, "service_tier"]) delete upstreamBody[k];
  if (upstreamBody.reasoning?.effort === "max") upstreamBody.reasoning.effort = "xhigh";
  const started: StartedChat = { id: generationId(), model: m, stream: (async function* () {})(), startedAt: Date.now() };
  const tracker = newTracker(body);
  let res: Response;
  try {
    res = await openaiFetch(c.env, "/responses", upstreamBody, c.req.raw.signal);
  } catch (e) {
    if (e instanceof UpstreamError) throw new ApiError(e.status, e.message, e.metadata);
    throw e;
  }
  const observeResponse = (r: any) => {
    if (!r) return;
    tracker.upstreamId ??= r.id;
    if (r.usage) tracker.usage = fromOpenAIResponsesUsage(r.usage);
    if (r.status) tracker.finishReason = r.status === "completed" ? "stop" : r.status;
    r.model = m.id;
  };
  if (body.stream !== true) {
    const j: any = await res.json();
    observeResponse(j);
    c.executionCtx.waitUntil(tracker.record(c, auth, started, { streamed: false, cancelled: false, body }));
    return jsonResponse(j);
  }
  const w = new SseWriter();
  c.executionCtx.waitUntil(
    (async () => {
      let cancelled = false;
      try {
        for await (const ev of parseSse(res.body!)) {
          let j: any;
          try {
            j = JSON.parse(ev.data);
          } catch {
            await w.raw(`data: ${ev.data}\n\n`);
            continue;
          }
          if (j.response) observeResponse(j.response);
          if (j.type === "response.output_text.delta") tracker.observe({ delta: { content: j.delta } });
          await w.raw(`${ev.event ? `event: ${ev.event}\n` : ""}data: ${JSON.stringify(j)}\n\n`);
          if (w.isClosed) {
            cancelled = true;
            break;
          }
        }
      } catch {
        cancelled = true;
      } finally {
        await w.close();
        await tracker.record(c, auth, started, { streamed: true, cancelled, body });
      }
    })(),
  );
  return new Response(w.readable, { headers: SSE_HEADERS });
}

// ---------------------------------------------------------------------------
// POST /api/v1/messages (Anthropic Messages API, any model)
// ---------------------------------------------------------------------------

export async function messages(c: Context<AppEnv>) {
  const auth = await inferenceAuth(c);
  const body = await readJson(c);
  if (!Array.isArray(body.messages)) throw new ApiError(400, "messages must be an array");
  const [m] = candidateModels(c, body);
  if (m._provider === "anthropic") return anthropicPassthrough(c, auth, body, m);
  // Non-Anthropic model: translate to Chat Completions and back.
  const chatBody = anthropicToChat(body);
  chatBody.model = m.id;
  chatBody.provider = { only: ["openai"] };
  const started = await startChat(c, auth, chatBody, c.req.raw.signal);
  return renderAnthropic(c, auth, body, started);
}

async function anthropicPassthrough(c: Context<AppEnv>, auth: ApiKeyAuth, body: any, m: CatalogModel) {
  preflight(auth, m);
  const unmetered = (body.tools ?? []).find((t: any) => typeof t?.type === "string" && /^(code_execution|computer|bash_code)/.test(t.type));
  if (unmetered || body.container) throw new ApiError(400, `Tool type "${unmetered?.type ?? "container"}" is not supported on this instance`);
  const upstreamBody: any = { ...body, model: m._upstream_id };
  // Fast mode, priority tier and regional inference are priced above the catalog rate.
  for (const k of [...OR_ONLY_FIELDS, "reasoning", "speed", "service_tier", "inference_geo"]) delete upstreamBody[k];
  const extra: Record<string, string> = {};
  const beta = c.req.header("anthropic-beta");
  if (beta) extra["anthropic-beta"] = beta;
  const started: StartedChat = { id: generationId(), model: m, stream: (async function* () {})(), startedAt: Date.now() };
  const tracker = newTracker(body);
  let res: Response;
  try {
    res = await anthropicFetch(c.env, upstreamBody, extra, c.req.raw.signal);
  } catch (e) {
    if (e instanceof UpstreamError) {
      // Anthropic clients expect Anthropic-shaped errors on this endpoint.
      return jsonResponse({ type: "error", error: { type: e.status === 429 ? "rate_limit_error" : "api_error", message: e.message } }, { status: e.status });
    }
    throw e;
  }
  if (body.stream !== true) {
    const j: any = await res.json();
    tracker.upstreamId = j.id;
    tracker.usage = fromAnthropicUsage(j.usage);
    tracker.finishReason = j.stop_reason;
    j.model = m.id;
    c.executionCtx.waitUntil(tracker.record(c, auth, started, { streamed: false, cancelled: false, body }));
    return jsonResponse(j);
  }
  const w = new SseWriter();
  c.executionCtx.waitUntil(
    (async () => {
      let raw: any = {};
      let cancelled = false;
      try {
        for await (const ev of parseSse(res.body!)) {
          let j: any;
          try {
            j = JSON.parse(ev.data);
          } catch {
            continue;
          }
          if (j.type === "message_start") {
            tracker.upstreamId = j.message?.id;
            raw = { ...(j.message?.usage ?? {}) };
            if (j.message) j.message.model = m.id;
          } else if (j.type === "message_delta") {
            if (j.usage) raw = { ...raw, ...Object.fromEntries(Object.entries(j.usage).filter(([, v]) => v != null)) };
            if (j.delta?.stop_reason) tracker.finishReason = j.delta.stop_reason;
          } else if (j.type === "content_block_delta") {
            tracker.observe({ delta: { content: j.delta?.text ?? j.delta?.thinking ?? j.delta?.partial_json ?? "" } });
          }
          tracker.usage = fromAnthropicUsage(raw);
          await w.event(j.type ?? ev.event ?? "message", j);
          if (w.isClosed) {
            cancelled = true;
            break;
          }
        }
      } catch {
        cancelled = true;
      } finally {
        tracker.usage = fromAnthropicUsage(raw);
        await w.close();
        await tracker.record(c, auth, started, { streamed: true, cancelled, body });
      }
    })(),
  );
  return new Response(w.readable, { headers: SSE_HEADERS });
}

/** Anthropic Messages request → Chat Completions request. */
export function anthropicToChat(body: any): any {
  const messages: any[] = [];
  const sys = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((b: any) => b.text ?? "").join("\n") : null;
  if (sys) messages.push({ role: "system", content: sys });
  const imagePart = (src: any) => ({ type: "image_url", image_url: { url: src?.type === "base64" ? `data:${src.media_type};base64,${src.data}` : src?.url } });
  for (const msg of body.messages) {
    const blocks = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : (msg.content ?? []);
    if (msg.role === "user") {
      const parts: any[] = [];
      for (const b of blocks) {
        if (b.type === "tool_result") {
          const content = typeof b.content === "string" ? b.content : (b.content ?? []).map((x: any) => (x.type === "text" ? x.text : "")).join("");
          messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `Error: ${content}` : content });
        } else if (b.type === "text") parts.push({ type: "text", text: b.text });
        else if (b.type === "image") parts.push(imagePart(b.source));
        else if (b.type === "document" && b.source?.type === "base64") parts.push({ type: "file", file: { filename: b.title ?? "document.pdf", file_data: `data:${b.source.media_type};base64,${b.source.data}` } });
        else if (b.type === "document" && b.source?.type === "text") parts.push({ type: "text", text: b.source.data });
      }
      if (parts.length) messages.push({ role: "user", content: parts });
    } else if (msg.role === "assistant") {
      const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      const toolCalls = blocks
        .filter((b: any) => b.type === "tool_use")
        .map((b: any) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    }
  }
  const out: any = { messages, stream: body.stream === true, max_tokens: body.max_tokens };
  if (body.temperature != null) out.temperature = body.temperature;
  if (body.top_p != null) out.top_p = body.top_p;
  if (body.stop_sequences) out.stop = body.stop_sequences;
  if (body.metadata?.user_id) out.user = body.metadata.user_id;
  const tools = (body.tools ?? []).filter((t: any) => t.input_schema);
  if (tools.length) {
    out.tools = tools.map((t: any) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const tc = body.tool_choice;
    if (tc?.type === "any") out.tool_choice = "required";
    else if (tc?.type === "tool") out.tool_choice = { type: "function", function: { name: tc.name } };
    else if (tc?.type === "none") out.tool_choice = "none";
    if (tc?.disable_parallel_tool_use) out.parallel_tool_calls = false;
  }
  const effort = body.output_config?.effort;
  if (effort) out.reasoning = { effort };
  else if (body.thinking?.type === "enabled") out.reasoning = { max_tokens: body.thinking.budget_tokens };
  const fmt = body.output_config?.format;
  if (fmt?.type === "json_schema") out.response_format = { type: "json_schema", json_schema: { name: "response", schema: fmt.schema, strict: true } };
  return out;
}

const TO_ANTHROPIC_STOP: Record<string, string> = { stop: "end_turn", length: "max_tokens", tool_calls: "tool_use", content_filter: "refusal" };

function anthropicUsage(u: NormalizedUsage) {
  return { input_tokens: Math.max(0, u.prompt_tokens - u.cached_tokens), output_tokens: u.completion_tokens, cache_read_input_tokens: u.cached_tokens, cache_creation_input_tokens: 0 };
}

/** Render chat deltas as an Anthropic Messages response or event stream. */
async function renderAnthropic(c: Context<AppEnv>, auth: ApiKeyAuth, body: any, started: StartedChat) {
  const tracker = newTracker(body);
  const m = started.model;
  const msgId = `msg_${started.id.slice(4)}`;
  if (body.stream !== true) {
    const acc = new MessageAccumulator();
    for await (const chunk of started.stream) {
      tracker.observe(chunk);
      acc.add(chunk);
      if (chunk.error) break;
    }
    c.executionCtx.waitUntil(tracker.record(c, auth, started, { streamed: false, cancelled: false, body }));
    if (tracker.error && !acc.content) return jsonResponse({ type: "error", error: { type: "api_error", message: tracker.error } }, { status: tracker.status });
    const content: any[] = [];
    if (acc.content) content.push({ type: "text", text: acc.content });
    for (const tc of acc.toolCalls.filter(Boolean)) {
      let input: unknown = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
    return jsonResponse({
      id: msgId,
      type: "message",
      role: "assistant",
      model: m.id,
      content,
      stop_reason: TO_ANTHROPIC_STOP[tracker.finishReason ?? "stop"] ?? "end_turn",
      stop_sequence: null,
      usage: anthropicUsage(tracker.finalUsage()),
    });
  }
  const w = new SseWriter();
  c.executionCtx.waitUntil(
    (async () => {
      let cancelled = false;
      let index = -1;
      let open: "text" | "tool" | null = null;
      const toolBlock = new Map<number, number>();
      const close = async () => {
        if (open) await w.event("content_block_stop", { type: "content_block_stop", index });
        open = null;
      };
      try {
        await w.event("message_start", {
          type: "message_start",
          message: { id: msgId, type: "message", role: "assistant", model: m.id, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
        });
        for await (const chunk of started.stream) {
          tracker.observe(chunk);
          if (chunk.error) {
            await w.event("error", { type: "error", error: { type: "api_error", message: chunk.error.message } });
            break;
          }
          const d = chunk.delta;
          if (d?.content) {
            if (open !== "text") {
              await close();
              index++;
              open = "text";
              await w.event("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
            }
            await w.event("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: d.content } });
          }
          for (const tc of d?.tool_calls ?? []) {
            if (tc.id) {
              await close();
              index++;
              open = "tool";
              toolBlock.set(tc.index, index);
              await w.event("content_block_start", { type: "content_block_start", index, content_block: { type: "tool_use", id: tc.id, name: tc.function?.name ?? "", input: {} } });
            }
            if (tc.function?.arguments && toolBlock.get(tc.index) === index) {
              await w.event("content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: tc.function.arguments } });
            }
          }
          if (chunk.usage) {
            await close();
            await w.event("message_delta", {
              type: "message_delta",
              delta: { stop_reason: TO_ANTHROPIC_STOP[tracker.finishReason ?? "stop"] ?? "end_turn", stop_sequence: null },
              usage: anthropicUsage(chunk.usage),
            });
            await w.event("message_stop", { type: "message_stop" });
          }
          if (w.isClosed) {
            cancelled = true;
            break;
          }
        }
      } catch {
        cancelled = true;
      } finally {
        await w.close();
        await tracker.record(c, auth, started, { streamed: true, cancelled, body });
      }
    })(),
  );
  return new Response(w.readable, { headers: SSE_HEADERS });
}

// ---------------------------------------------------------------------------
// POST /api/v1/messages/count_tokens
// ---------------------------------------------------------------------------

export async function countTokens(c: Context<AppEnv>) {
  await inferenceAuth(c);
  const body = await readJson(c);
  const [m] = candidateModels(c, body);
  if (m._provider === "anthropic") {
    const upstreamBody: any = { ...body, model: m._upstream_id };
    for (const k of [...OR_ONLY_FIELDS, "reasoning", "stream", "max_tokens"]) delete upstreamBody[k];
    const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: { "x-api-key": c.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(upstreamBody),
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  }
  // Rough estimate for non-Anthropic models (~4 characters per token).
  return jsonResponse({ input_tokens: Math.ceil(JSON.stringify(body.messages ?? []).length / 4) });
}
