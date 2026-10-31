import type { CatalogModel } from "./catalog";
import { NANO } from "./util";

/** Token usage normalized to OpenRouter semantics: prompt includes cached tokens, completion includes reasoning. */
export interface NormalizedUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  /** Cache writes (all TTLs), of which `cache_write_1h_tokens` used the 1-hour TTL. */
  cache_write_tokens: number;
  cache_write_1h_tokens?: number;
  reasoning_tokens: number;
  /** Server-side web searches (billed per request). */
  web_search_requests?: number;
}

export const emptyUsage = (): NormalizedUsage => ({
  prompt_tokens: 0,
  completion_tokens: 0,
  cached_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
});

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** Pick the price tier: the override with the highest min_prompt_tokens that the request reaches. */
function effectivePricing(m: CatalogModel, promptTokens: number) {
  const base = m.pricing;
  const tier = (base.overrides ?? [])
    .filter((o) => !o.utc_days && o.utc_start == null && (o.min_prompt_tokens ?? 0) <= promptTokens)
    .sort((a, b) => (b.min_prompt_tokens ?? 0) - (a.min_prompt_tokens ?? 0))[0];
  return { ...base, ...(tier ?? {}) };
}

/** Round away float noise (e.g. 6.879999999999999e-05) while keeping sub-cent precision. */
const round = (usd: number) => Math.round(usd * 1e12) / 1e12;

export interface CostBreakdown {
  total: number;
  prompt: number;
  completion: number;
}

/** Cost in USD (float) for display, plus the exact nano-dollar amount for the ledger. */
export function computeCost(m: CatalogModel, u: NormalizedUsage): CostBreakdown & { nano: number } {
  const p = effectivePricing(m, u.prompt_tokens);
  const promptPrice = num(p.prompt);
  const cacheRead = p.input_cache_read != null ? num(p.input_cache_read) : promptPrice;
  const cacheWrite = p.input_cache_write != null ? num(p.input_cache_write) : promptPrice;
  const cacheWrite1h = p.input_cache_write_1h != null ? num(p.input_cache_write_1h) : cacheWrite;
  const write1h = Math.min(u.cache_write_1h_tokens ?? 0, u.cache_write_tokens);
  const uncached = Math.max(0, u.prompt_tokens - u.cached_tokens - u.cache_write_tokens);
  const prompt = uncached * promptPrice + u.cached_tokens * cacheRead + (u.cache_write_tokens - write1h) * cacheWrite + write1h * cacheWrite1h;
  const completion = u.completion_tokens * num(p.completion);
  const total = prompt + completion + num(p.request) + (u.web_search_requests ?? 0) * num(p.web_search);
  return { total: round(total), prompt: round(prompt), completion: round(completion), nano: Math.round(total * NANO) };
}

/** The `usage` object OpenRouter attaches to chat completion responses. */
export function usageObject(m: CatalogModel, u: NormalizedUsage) {
  const cost = computeCost(m, u);
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.prompt_tokens + u.completion_tokens,
    cost: cost.total,
    is_byok: false,
    prompt_tokens_details: { cached_tokens: u.cached_tokens, cache_write_tokens: u.cache_write_tokens, audio_tokens: 0 },
    cost_details: {
      upstream_inference_cost: null,
      upstream_inference_prompt_cost: cost.prompt,
      upstream_inference_completions_cost: cost.completion,
    },
    completion_tokens_details: { reasoning_tokens: u.reasoning_tokens, image_tokens: 0 },
  };
}

export function fromOpenAIChatUsage(raw: any): NormalizedUsage {
  return {
    prompt_tokens: raw?.prompt_tokens ?? 0,
    completion_tokens: raw?.completion_tokens ?? 0,
    cached_tokens: raw?.prompt_tokens_details?.cached_tokens ?? 0,
    cache_write_tokens: 0,
    reasoning_tokens: raw?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

export function fromOpenAIResponsesUsage(raw: any): NormalizedUsage {
  return {
    prompt_tokens: raw?.input_tokens ?? 0,
    completion_tokens: raw?.output_tokens ?? 0,
    cached_tokens: raw?.input_tokens_details?.cached_tokens ?? 0,
    cache_write_tokens: 0,
    reasoning_tokens: raw?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

/** Anthropic reports uncached input separately from cache reads and writes. */
export function fromAnthropicUsage(raw: any): NormalizedUsage {
  const input = raw?.input_tokens ?? 0;
  const read = raw?.cache_read_input_tokens ?? 0;
  const write = raw?.cache_creation_input_tokens ?? 0;
  return {
    prompt_tokens: input + read + write,
    completion_tokens: raw?.output_tokens ?? 0,
    cached_tokens: read,
    cache_write_tokens: write,
    cache_write_1h_tokens: raw?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    reasoning_tokens: 0,
    web_search_requests: raw?.server_tool_use?.web_search_requests ?? 0,
  };
}
