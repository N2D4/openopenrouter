import catalogData from "./catalog.generated.json";
import { ApiError } from "./errors";

export type Pricing = Record<string, any> & {
  prompt: string;
  completion: string;
  request?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  overrides?: Array<Record<string, any> & { min_prompt_tokens?: number }>;
};

export interface CatalogModel {
  id: string;
  canonical_slug: string;
  hugging_face_id: string | null;
  name: string;
  created: number;
  description: string;
  context_length: number;
  architecture: Record<string, any>;
  pricing: Pricing;
  top_provider: { context_length: number | null; max_completion_tokens: number | null; is_moderated: boolean };
  per_request_limits: unknown;
  supported_parameters: string[];
  default_parameters: Record<string, unknown>;
  reasoning: { mandatory?: boolean; supported_efforts?: string[]; default_effort?: string } | null;
  knowledge_cutoff: string | null;
  expiration_date: string | null;
  _provider: "openai" | "anthropic";
  _upstream_id: string;
  _api: "chat" | "responses" | "messages" | "embeddings";
}

export const PROVIDERS = {
  openai: {
    name: "OpenAI",
    slug: "openai",
    privacy_policy_url: "https://openai.com/policies/privacy-policy/",
    terms_of_service_url: "https://openai.com/policies/row-terms-of-use/",
    status_page_url: "https://status.openai.com/",
    headquarters: "US",
  },
  anthropic: {
    name: "Anthropic",
    slug: "anthropic",
    privacy_policy_url: "https://www.anthropic.com/legal/privacy",
    terms_of_service_url: "https://www.anthropic.com/legal/commercial-terms",
    status_page_url: "https://status.anthropic.com/",
    headquarters: "US",
  },
} as const;

const catalog = catalogData as unknown as { generated_at: string; models: CatalogModel[]; embeddings: CatalogModel[] };

export const chatModels: CatalogModel[] = catalog.models;
export const embeddingModels: CatalogModel[] = catalog.embeddings;

const byId = new Map<string, CatalogModel>();
const aliases = new Map<string, CatalogModel>();
for (const m of [...chatModels, ...embeddingModels]) {
  byId.set(m.id, m);
  aliases.set(m.canonical_slug, m);
  // Allow bare upstream IDs ("gpt-4o", "claude-sonnet-4-5-20250929") and bare slugs.
  aliases.set(m._upstream_id, m);
  aliases.set(m.id.split("/")[1], m);
  aliases.set(`${m._provider}/${m._upstream_id}`, m);
}
// Undated Anthropic aliases ("claude-sonnet-4-5") for dated upstream IDs.
for (const m of chatModels) {
  if (m._provider === "anthropic") aliases.set(m._upstream_id.replace(/-\d{8}$/, ""), m);
}

/** Variant suffixes that don't change routing on a single-provider-per-model gateway. */
const NOOP_VARIANTS = new Set(["nitro", "floor", "exacto"]);

export function findModel(id: string): CatalogModel | undefined {
  return byId.get(id) ?? aliases.get(id);
}

export function enabledProviders(env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string }) {
  return { openai: !!env.OPENAI_API_KEY, anthropic: !!env.ANTHROPIC_API_KEY };
}

export function isEnabled(m: CatalogModel, env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string }) {
  return enabledProviders(env)[m._provider];
}

export const AUTO_MODEL_ID = "openrouter/auto";
export const DEFAULT_AUTO_MODELS = ["anthropic/claude-sonnet-5.5", "openai/gpt-5.5"];

export function resolveModel(
  raw: unknown,
  env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string },
  kind: "chat" | "embeddings" = "chat",
): CatalogModel {
  if (typeof raw !== "string" || !raw) throw new ApiError(400, "No model specified");
  let id = raw.trim();
  const colon = id.indexOf(":");
  if (colon !== -1) {
    const variant = id.slice(colon + 1);
    if (!NOOP_VARIANTS.has(variant)) {
      throw new ApiError(400, `Model variant ":${variant}" is not supported on this instance`);
    }
    id = id.slice(0, colon);
  }
  if (id === AUTO_MODEL_ID || id === "openopenrouter/auto") {
    const pick = DEFAULT_AUTO_MODELS.map(findModel).find((m) => m && isEnabled(m, env));
    if (!pick) throw new ApiError(503, "No model is available for auto routing");
    return pick;
  }
  const m = findModel(id);
  const isEmbedding = m?._api === "embeddings";
  if (!m || (kind === "embeddings") !== isEmbedding) {
    throw new ApiError(400, `${raw} is not a valid model ID`);
  }
  if (!isEnabled(m, env)) throw new ApiError(503, `No provider is configured for ${m.id} on this instance`);
  return m;
}

/** The public (OpenRouter-shaped) model object, without gateway-internal fields. */
export function publicModel(m: CatalogModel) {
  const { _provider, _upstream_id, _api, ...rest } = m;
  const endpoints =
    _api === "embeddings"
      ? ["/api/v1/embeddings"]
      : _provider === "openai"
        ? ["/api/v1/chat/completions", "/api/v1/completions", "/api/v1/messages", "/api/v1/responses"]
        : ["/api/v1/chat/completions", "/api/v1/completions", "/api/v1/messages"];
  return {
    ...rest,
    supported_voices: null,
    links: { details: `/api/v1/models/${m.id}/endpoints` },
    endpoints,
  };
}

export function modelEndpoint(m: CatalogModel) {
  const p = PROVIDERS[m._provider];
  const { overrides, ...pricing } = m.pricing;
  const params = new Set(m.supported_parameters);
  return {
    name: `${p.name} | ${m._upstream_id}`,
    model_id: m.id,
    model_name: m.name,
    context_length: m.context_length,
    pricing: { ...pricing, discount: 0, ...(overrides ? { overrides } : {}) },
    provider_name: p.name,
    tag: p.slug,
    quantization: null,
    max_completion_tokens: m.top_provider.max_completion_tokens,
    max_prompt_tokens: null,
    supported_parameters: m.supported_parameters,
    status: 0,
    uptime_last_30m: null,
    uptime_last_5m: null,
    uptime_last_1d: null,
    latency_last_30m: null,
    throughput_last_30m: null,
    supports_implicit_caching: m._provider === "openai",
    supports_tool_choice: {
      auto: params.has("tools"),
      none: params.has("tools"),
      required: params.has("tools"),
      function: params.has("tools"),
    },
    supports_diarization: false,
    native_tools: {},
    service_tier: null,
  };
}

export const catalogGeneratedAt = catalog.generated_at;
