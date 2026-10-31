import type { Context } from "hono";
import type { ApiKeyAuth } from "./auth";
import { preflight, recordGeneration } from "./billing";
import { type CatalogModel, PROVIDERS, resolveModel } from "./catalog";
import type { AppEnv } from "./env";
import { ApiError } from "./errors";
import { emptyUsage, type NormalizedUsage } from "./pricing";
import { anthropicChatStream } from "./providers/anthropic";
import { openaiChatStream } from "./providers/openai";
import { type ChatChunk, type ChatStream, UpstreamError } from "./providers/types";
import { generationId } from "./util";

/** Request params that, with provider.require_parameters, must be supported by the chosen model. */
const CHECKED_PARAMS = [
  "tools",
  "tool_choice",
  "response_format",
  "temperature",
  "top_p",
  "top_k",
  "stop",
  "seed",
  "logprobs",
  "top_logprobs",
  "frequency_penalty",
  "presence_penalty",
  "logit_bias",
  "reasoning",
  "verbosity",
];

export interface RequestMeta {
  origin: string | null;
  appTitle: string | null;
  userAgent: string | null;
}

export function requestMeta(c: Context<AppEnv>): RequestMeta {
  return {
    origin: c.req.header("http-referer") ?? c.req.header("referer") ?? null,
    appTitle: c.req.header("x-title") ?? c.req.header("x-openrouter-title") ?? null,
    userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
  };
}

/** Candidate models in fallback order, filtered by the request's provider preferences. */
export function candidateModels(c: Context<AppEnv>, body: any): CatalogModel[] {
  const ids: string[] = [];
  if (body.model) ids.push(body.model);
  if (Array.isArray(body.models)) for (const id of body.models) if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  if (!ids.length) throw new ApiError(400, "No model specified");
  const models = ids.map((id, i) => {
    try {
      return resolveModel(id, c.env);
    } catch (e) {
      if (i === 0) throw e;
      return null;
    }
  }).filter((m): m is CatalogModel => m != null);

  const prefs = body.provider ?? {};
  const norm = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s).toLowerCase()) : null);
  const only = norm(prefs.only);
  const ignore = norm(prefs.ignore);
  const allowFallbacks = prefs.allow_fallbacks !== false && body.route !== "no-fallback";
  let filtered = models.filter((m) => {
    const slug = PROVIDERS[m._provider].slug;
    if (only && !only.includes(slug)) return false;
    if (ignore && ignore.includes(slug)) return false;
    if (prefs.require_parameters) {
      for (const p of CHECKED_PARAMS) if (body[p] != null && !m.supported_parameters.includes(p)) return false;
    }
    if (prefs.max_price) {
      if (prefs.max_price.prompt != null && Number(m.pricing.prompt) * 1e6 > prefs.max_price.prompt) return false;
      if (prefs.max_price.completion != null && Number(m.pricing.completion) * 1e6 > prefs.max_price.completion) return false;
    }
    return true;
  });
  if (!filtered.length) throw new ApiError(404, "No endpoints found matching your data policy and provider preferences");
  if (!allowFallbacks) filtered = filtered.slice(0, 1);
  return filtered;
}

export interface StartedChat {
  id: string;
  model: CatalogModel;
  stream: ChatStream;
  startedAt: number;
}

/** Try each candidate model until one accepts the request. Fails over only on retryable upstream errors. */
export async function startChat(c: Context<AppEnv>, auth: ApiKeyAuth, body: any, signal?: AbortSignal): Promise<StartedChat> {
  const models = candidateModels(c, body);
  preflight(auth, models[0]);
  const startedAt = Date.now();
  let last: UpstreamError | undefined;
  for (const [i, m] of models.entries()) {
    try {
      const stream = m._provider === "openai" ? await openaiChatStream(c.env, m, body, signal) : await anthropicChatStream(c.env, m, body, signal);
      return { id: generationId(), model: m, stream, startedAt };
    } catch (e) {
      if (e instanceof UpstreamError && e.retryable && i < models.length - 1) {
        last = e;
        continue;
      }
      if (e instanceof UpstreamError) throw new ApiError(e.status, e.message, e.metadata);
      throw e;
    }
  }
  throw new ApiError(last?.status ?? 502, last?.message ?? "All providers failed", last?.metadata);
}

/** Accumulates what a stream produced so the generation can be billed and recorded. */
export class GenerationTracker {
  usage: NormalizedUsage | null = null;
  partialUsage: NormalizedUsage | null = null;
  /** Rough prompt size (chars / 4), used only if a stream is cut off before the provider reports usage. */
  promptEstimate = 0;
  finishReason: string | null = null;
  nativeFinishReason: string | null = null;
  upstreamId: string | null = null;
  firstTokenAt: number | null = null;
  outputChars = 0;
  error: string | null = null;
  status = 200;

  observe(chunk: ChatChunk) {
    if (chunk.upstream_id) this.upstreamId ??= chunk.upstream_id;
    const d = chunk.delta;
    if (d) {
      const n = (d.content?.length ?? 0) + (d.reasoning?.length ?? 0) + (d.tool_calls?.reduce((a, t) => a + (t.function.arguments?.length ?? 0), 0) ?? 0);
      if (n > 0) {
        this.firstTokenAt ??= Date.now();
        this.outputChars += n;
      }
    }
    if (chunk.finish_reason) this.finishReason = chunk.finish_reason;
    if (chunk.native_finish_reason) this.nativeFinishReason = chunk.native_finish_reason;
    if (chunk.usage) this.usage = chunk.usage;
    if (chunk.partialUsage) this.partialUsage = chunk.partialUsage;
    if (chunk.error) {
      this.error = chunk.error.message;
      this.status = chunk.error.code;
    }
  }

  /** Usage to bill. If the stream was cut off before the provider reported usage, estimate output from characters. */
  finalUsage(): NormalizedUsage {
    if (this.usage && !(this.usage.completion_tokens === 0 && this.outputChars > 0)) return this.usage;
    const u = this.usage ?? this.partialUsage ?? { ...emptyUsage(), prompt_tokens: this.promptEstimate };
    return { ...u, completion_tokens: Math.max(u.completion_tokens, Math.ceil(this.outputChars / 4)) };
  }

  async record(c: Context<AppEnv>, auth: ApiKeyAuth, started: StartedChat, opts: { streamed: boolean; cancelled: boolean; body: any; apiType?: "completions" | "embeddings" }) {
    const meta = requestMeta(c);
    await recordGeneration(c.env, {
      id: started.id,
      auth,
      model: started.model,
      apiType: opts.apiType ?? "completions",
      upstreamId: this.upstreamId,
      streamed: opts.streamed,
      cancelled: opts.cancelled,
      finishReason: this.error ? "error" : this.finishReason,
      nativeFinishReason: this.nativeFinishReason,
      usage: this.finalUsage(),
      startedAt: started.startedAt,
      firstTokenAt: this.firstTokenAt,
      status: this.status,
      error: this.error,
      ...meta,
      externalUser: typeof opts.body?.user === "string" ? opts.body.user.slice(0, 256) : null,
    });
  }
}

/** Whether reasoning text should be hidden from the client. */
export function excludeReasoning(body: any) {
  return body.reasoning?.exclude === true || body.include_reasoning === false;
}

/** Merge streamed deltas into a complete assistant message. */
export class MessageAccumulator {
  content = "";
  reasoning = "";
  refusal: string | null = null;
  toolCalls: any[] = [];
  reasoningDetails: any[] = [];
  annotations: any[] = [];
  logprobs: any = null;
  systemFingerprint: string | null = null;

  add(chunk: ChatChunk) {
    if (chunk.system_fingerprint) this.systemFingerprint = chunk.system_fingerprint;
    if (chunk.logprobs) {
      this.logprobs ??= { content: [], refusal: null };
      this.logprobs.content.push(...(chunk.logprobs.content ?? []));
    }
    const d = chunk.delta;
    if (!d) return;
    if (d.content) this.content += d.content;
    if (d.reasoning) this.reasoning += d.reasoning;
    if (d.refusal) this.refusal = (this.refusal ?? "") + d.refusal;
    if (d.annotations) this.annotations.push(...d.annotations);
    for (const tc of d.tool_calls ?? []) {
      const cur = (this.toolCalls[tc.index] ??= { id: tc.id, type: "function", function: { name: "", arguments: "" } });
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.function.name += tc.function.name;
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
    }
    for (const rd of d.reasoning_details ?? []) {
      const cur = this.reasoningDetails.find((x) => x.index === rd.index && x.type === rd.type && x.format === rd.format);
      if (!cur || rd.type === "reasoning.encrypted") this.reasoningDetails.push({ ...rd });
      else {
        if (rd.text) cur.text = (cur.text ?? "") + rd.text;
        if (rd.summary) cur.summary = (cur.summary ?? "") + rd.summary;
        if (rd.signature) cur.signature = rd.signature;
      }
    }
  }

  message(excludeReasoningText: boolean) {
    const msg: any = { role: "assistant", content: this.content, refusal: this.refusal, reasoning: excludeReasoningText ? null : this.reasoning || null };
    const tools = this.toolCalls.filter(Boolean);
    if (tools.length) msg.tool_calls = tools;
    if (this.reasoningDetails.length && !excludeReasoningText) msg.reasoning_details = this.reasoningDetails;
    if (this.annotations.length) msg.annotations = this.annotations;
    return msg;
  }
}
