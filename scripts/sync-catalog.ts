/**
 * Builds src/worker/catalog.generated.json.
 *
 * Model metadata and per-token prices come from OpenRouter's public model list,
 * so IDs and pricing match OpenRouter 1:1. A model is only included when the
 * configured upstream provider actually serves it (checked against the
 * provider's own /models endpoint when an API key is available).
 *
 * Usage:
 *   OPENAI_API_KEY=... ANTHROPIC_API_KEY=... pnpm catalog:sync
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../src/worker/catalog.generated.json", import.meta.url));

type OrModel = Record<string, any> & { id: string };

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function providerIds(provider: "openai" | "anthropic"): Promise<Set<string> | null> {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return null;
    const j = await getJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${key}` });
    return new Set(j.data.map((m: any) => m.id as string));
  }
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  const j = await getJson("https://api.anthropic.com/v1/models?limit=1000", {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  });
  return new Set(j.data.map((m: any) => m.id as string));
}

/** Models that OpenAI only serves through the Responses API. */
function openaiApi(upstreamId: string): "chat" | "responses" {
  return /(-pro$|-pro-\d|codex|deep-research|computer-use)/.test(upstreamId) ? "responses" : "chat";
}

function resolveUpstream(model: OrModel, available: Set<string> | null): string | null {
  const [author, slug] = model.id.split("/");
  if (author === "openai") {
    if (slug === "gpt-chat-latest") return available == null || available.has("chat-latest") ? "chat-latest" : null;
    if (available == null) return slug;
    return available.has(slug) ? slug : null;
  }
  if (author === "anthropic") {
    const dashed = slug.replace(/\./g, "-");
    if (available == null) return dashed;
    if (available.has(dashed)) return dashed;
    const dated = [...available].filter((id) => id.startsWith(`${dashed}-20`)).sort().at(-1);
    return dated ?? null;
  }
  return null;
}

const PROVIDER_NAMES: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic" };

function pick(m: OrModel, provider: string, upstreamId: string, api: string) {
  const providerName = PROVIDER_NAMES[provider];
  const shortName = String(m.name).replace(/^[^:]+:\s*/, "");
  return {
    id: m.id,
    canonical_slug: m.canonical_slug ?? m.id,
    hugging_face_id: m.hugging_face_id || null,
    name: m.name,
    created: m.created,
    description: `${shortName} by ${providerName}, served directly from the ${providerName} API.`,
    context_length: m.context_length,
    architecture: m.architecture,
    pricing: m.pricing,
    top_provider: m.top_provider,
    per_request_limits: m.per_request_limits ?? null,
    supported_parameters: m.supported_parameters ?? [],
    default_parameters: m.default_parameters ?? {},
    reasoning: m.reasoning ?? null,
    knowledge_cutoff: m.knowledge_cutoff ?? null,
    expiration_date: m.expiration_date ?? null,
    // Gateway-internal routing data (stripped from public API responses).
    _provider: provider,
    _upstream_id: upstreamId,
    _api: api,
  };
}

async function main() {
  const [chat, embeddings, openaiAvail, anthropicAvail] = await Promise.all([
    getJson("https://openrouter.ai/api/v1/models"),
    getJson("https://openrouter.ai/api/v1/embeddings/models"),
    providerIds("openai"),
    providerIds("anthropic"),
  ]);
  const avail: Record<string, Set<string> | null> = { openai: openaiAvail, anthropic: anthropicAvail };

  const models: any[] = [];
  for (const m of chat.data as OrModel[]) {
    const provider = m.id.split("/")[0];
    if (!(provider in avail) || m.id.includes(":")) continue;
    const upstream = resolveUpstream(m, avail[provider]);
    if (!upstream) continue;
    models.push(pick(m, provider, upstream, provider === "openai" ? openaiApi(upstream) : "messages"));
  }
  const embeddingModels: any[] = [];
  for (const m of embeddings.data as OrModel[]) {
    if (!m.id.startsWith("openai/")) continue;
    const upstream = resolveUpstream(m, openaiAvail);
    if (!upstream) continue;
    embeddingModels.push(pick(m, "openai", upstream, "embeddings"));
  }
  models.sort((a, b) => b.created - a.created);
  writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), models, embeddings: embeddingModels }, null, 1) + "\n");
  console.log(`Wrote ${models.length} chat models and ${embeddingModels.length} embedding models to ${OUT}`);
}

await main();
