import { Hono } from "hono";
import { type ApiKeyAuth, type ApiKeyRow, authenticateApiKey, hashKey, newApiKey } from "../auth";
import { keyLimitRemaining, keyLimitUsage } from "../billing";
import { chatModels, embeddingModels, findModel, isEnabled, modelEndpoint, PROVIDERS, publicModel } from "../catalog";
import type { AppEnv, Env } from "../env";
import { ApiError } from "../errors";
import { isoOrNull, nanoToUsd, randomId, safeEqual, sha256Base64Url, usdToNano } from "../util";
import { chatCompletions, completions, countTokens, embeddings, messages, readJson, responses } from "./inference";

export const api = new Hono<AppEnv>();

// --- Inference -------------------------------------------------------------
api.post("/chat/completions", chatCompletions);
api.post("/completions", completions);
api.post("/embeddings", embeddings);
api.post("/responses", responses);
api.post("/messages", messages);
api.post("/messages/count_tokens", countTokens);

// --- Models ----------------------------------------------------------------
function listModels(env: Env, query: URLSearchParams) {
  let models = chatModels.filter((m) => isEnabled(m, env));
  const params = query.get("supported_parameters");
  if (params) {
    const want = params.split(",").map((s) => s.trim()).filter(Boolean);
    models = models.filter((m) => want.every((p) => m.supported_parameters.includes(p)));
  }
  const outMods = query.get("output_modalities");
  if (outMods && outMods !== "all") {
    const want = outMods.split(",");
    models = models.filter((m) => want.some((o) => m.architecture.output_modalities?.includes(o)));
  }
  return models.map(publicModel);
}

api.get("/models", (c) => c.json({ data: listModels(c.env, new URL(c.req.url).searchParams) }));
api.get("/models/user", (c) => c.json({ data: listModels(c.env, new URL(c.req.url).searchParams) }));
api.get("/models/count", (c) => c.json({ data: { count: listModels(c.env, new URL(c.req.url).searchParams).length } }));
api.get("/embeddings/models", (c) => c.json({ data: embeddingModels.filter((m) => isEnabled(m, c.env)).map(publicModel) }));

function modelOr404(env: Env, author: string, slug: string) {
  const m = findModel(`${author}/${slug}`);
  if (!m || !isEnabled(m, env)) throw new ApiError(404, "Model not found");
  return m;
}

api.get("/model/:author/:slug", (c) => c.json({ data: publicModel(modelOr404(c.env, c.req.param("author"), c.req.param("slug"))) }));
api.get("/models/:author/:slug/endpoints", (c) => {
  const m = modelOr404(c.env, c.req.param("author"), c.req.param("slug"));
  const pub = publicModel(m);
  return c.json({
    data: { id: m.id, name: m.name, created: m.created, description: m.description, architecture: pub.architecture, endpoints: [modelEndpoint(m)] },
  });
});

api.get("/providers", (c) =>
  c.json({ data: Object.entries(PROVIDERS).filter(([k]) => isEnabled({ _provider: k } as any, c.env)).map(([, p]) => ({ ...p, datacenters: null })) }),
);

// --- Current key & credits ---------------------------------------------------
async function usageWindows(env: Env, hash: string) {
  const now = new Date();
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const week = day - ((now.getUTCDay() + 6) % 7) * 86_400_000;
  const month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const r = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at >= ?2 THEN cost_nano END), 0) AS daily,
       COALESCE(SUM(CASE WHEN created_at >= ?3 THEN cost_nano END), 0) AS weekly,
       COALESCE(SUM(CASE WHEN created_at >= ?4 THEN cost_nano END), 0) AS monthly
     FROM generations WHERE key_hash = ?1 AND created_at >= ?5`,
  )
    .bind(hash, day, week, month, Math.min(week, month))
    .first<{ daily: number; weekly: number; monthly: number }>();
  return { daily: nanoToUsd(r?.daily ?? 0), weekly: nanoToUsd(r?.weekly ?? 0), monthly: nanoToUsd(r?.monthly ?? 0) };
}

export async function keyObject(env: Env, k: ApiKeyRow) {
  const w = await usageWindows(env, k.hash);
  const remaining = keyLimitRemaining(k);
  return {
    hash: k.hash,
    name: k.name,
    label: k.label,
    disabled: !!k.disabled,
    limit: k.limit_nano == null ? null : nanoToUsd(k.limit_nano),
    limit_remaining: remaining == null ? null : nanoToUsd(remaining),
    limit_reset: k.limit_reset,
    include_byok_in_limit: !!k.include_byok_in_limit,
    usage: nanoToUsd(k.usage_nano),
    usage_daily: w.daily,
    usage_weekly: w.weekly,
    usage_monthly: w.monthly,
    byok_usage: 0,
    byok_usage_daily: 0,
    byok_usage_weekly: 0,
    byok_usage_monthly: 0,
    is_management_key: !!k.is_management,
    created_at: new Date(k.created_at).toISOString(),
    updated_at: isoOrNull(k.updated_at),
    last_used_at: isoOrNull(k.last_used_at),
    expires_at: isoOrNull(k.expires_at),
    creator_user_id: k.creator_user_id,
    external_user: null,
    workspace_id: null,
  };
}

async function currentKey(c: any) {
  const auth: ApiKeyAuth = await authenticateApiKey(c);
  const k = auth.key;
  const obj = await keyObject(c.env, k);
  return c.json({
    data: {
      ...obj,
      is_free_tier: false,
      is_provisioning_key: !!k.is_management,
      rate_limit: { requests: 600, interval: "1m", note: "This field is deprecated and safe to ignore." },
      organization_id: null,
      allowed_data_regions: [],
      budgets: [],
      effective_budget: null,
      free_model_daily_requests: { limit: 0, remaining: 0, used: 0 },
      label: k.label,
    },
  });
}
api.get("/key", currentKey);
api.get("/auth/key", currentKey);

api.get("/credits", async (c) => {
  const auth = await authenticateApiKey(c);
  return c.json({ data: { total_credits: nanoToUsd(auth.credits_nano), total_usage: nanoToUsd(auth.account_usage_nano) } });
});

// --- Generations & activity --------------------------------------------------
export function generationObject(g: any) {
  return {
    id: g.id,
    upstream_id: g.upstream_id,
    total_cost: nanoToUsd(g.cost_nano),
    usage: nanoToUsd(g.cost_nano),
    cache_discount: null,
    upstream_inference_cost: null,
    created_at: new Date(g.created_at).toISOString(),
    model: g.model,
    app_id: null,
    streamed: !!g.streamed,
    cancelled: !!g.cancelled,
    provider_name: g.provider_name,
    latency: g.latency_ms,
    moderation_latency: null,
    generation_time: g.generation_time_ms,
    finish_reason: g.finish_reason,
    native_finish_reason: g.native_finish_reason,
    tokens_prompt: g.tokens_prompt,
    tokens_completion: g.tokens_completion,
    native_tokens_prompt: g.tokens_prompt,
    native_tokens_completion: g.tokens_completion,
    native_tokens_completion_images: 0,
    native_tokens_reasoning: g.native_tokens_reasoning,
    native_tokens_cached: g.native_tokens_cached,
    num_media_prompt: null,
    num_input_audio_prompt: null,
    num_media_completion: 0,
    num_search_results: 0,
    num_fetches: 0,
    origin: g.origin ?? "",
    is_byok: false,
    api_type: g.api_type,
    router: null,
    preset_id: null,
    provider_responses: null,
    request_id: null,
    session_id: null,
    service_tier: null,
    data_region: "global",
    external_user: g.external_user,
    http_referer: g.origin,
    user_agent: g.user_agent,
    workspace_id: null,
    web_search_engine: null,
  };
}

api.get("/generation", async (c) => {
  const auth = await authenticateApiKey(c);
  const id = c.req.query("id");
  if (!id) throw new ApiError(400, "id is required");
  const g = await c.env.DB.prepare(`SELECT * FROM generations WHERE id = ? AND user_id = ?`).bind(id, auth.key.user_id).first();
  if (!g) throw new ApiError(404, "Generation not found");
  return c.json({ data: generationObject(g) });
});

api.get("/activity", async (c) => {
  const auth = await authenticateApiKey(c);
  const date = c.req.query("date");
  const keyHash = c.req.query("api_key_hash");
  const since = Date.now() - 30 * 86_400_000;
  const conds = ["user_id = ?", "created_at >= ?"];
  const binds: unknown[] = [auth.key.user_id, since];
  if (date) {
    const start = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(start)) throw new ApiError(400, "date must be YYYY-MM-DD");
    conds.push("created_at >= ? AND created_at < ?");
    binds.push(start, start + 86_400_000);
  }
  if (keyHash) {
    conds.push("key_hash = ?");
    binds.push(keyHash);
  }
  const rows = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS date, model, model_permaslug, provider_name,
       COUNT(*) AS requests, SUM(cost_nano) AS cost, SUM(tokens_prompt) AS prompt_tokens,
       SUM(tokens_completion) AS completion_tokens, SUM(native_tokens_reasoning) AS reasoning_tokens,
       SUM(native_tokens_cached) AS cached_tokens
     FROM generations WHERE ${conds.join(" AND ")}
     GROUP BY date, model ORDER BY date DESC, cost DESC`,
  )
    .bind(...binds)
    .all<any>();
  return c.json({
    data: rows.results.map((r) => ({
      date: r.date,
      model: r.model,
      model_permaslug: r.model_permaslug ?? r.model,
      endpoint_id: `${r.provider_name?.toLowerCase()}:${r.model}`,
      provider_name: r.provider_name,
      usage: nanoToUsd(r.cost ?? 0),
      byok_usage_inference: 0,
      requests: r.requests,
      prompt_tokens: r.prompt_tokens ?? 0,
      completion_tokens: r.completion_tokens ?? 0,
      reasoning_tokens: r.reasoning_tokens ?? 0,
      cached_tokens: r.cached_tokens ?? 0,
    })),
  });
});

// --- Key management API (management keys) --------------------------------------
const LIMIT_RESETS = new Set([null, "daily", "weekly", "monthly"]);

export function parseKeyFields(body: any, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined || !partial) {
    if (typeof body.name !== "string" || !body.name.trim()) throw new ApiError(400, "name is required");
    out.name = body.name.trim().slice(0, 200);
  }
  if (body.limit !== undefined) {
    if (body.limit !== null && (typeof body.limit !== "number" || body.limit < 0)) throw new ApiError(400, "limit must be a non-negative number or null");
    out.limit_nano = body.limit === null ? null : usdToNano(body.limit);
  }
  if (body.limit_reset !== undefined) {
    if (!LIMIT_RESETS.has(body.limit_reset)) throw new ApiError(400, "limit_reset must be daily, weekly, monthly or null");
    out.limit_reset = body.limit_reset;
  }
  if (body.expires_at !== undefined) {
    const t = body.expires_at === null ? null : Date.parse(body.expires_at);
    if (t !== null && (Number.isNaN(t) || t <= Date.now())) throw new ApiError(400, "expires_at must be a future ISO 8601 date");
    out.expires_at = t;
  }
  if (body.include_byok_in_limit !== undefined) out.include_byok_in_limit = body.include_byok_in_limit ? 1 : 0;
  if (partial && body.disabled !== undefined) out.disabled = body.disabled ? 1 : 0;
  return out;
}

export async function createKey(env: Env, userId: string, fields: Record<string, unknown>, isManagement = false) {
  const { secret, label } = newApiKey();
  const hash = await hashKey(secret);
  const now = Date.now();
  const row: ApiKeyRow = {
    hash,
    user_id: userId,
    name: String(fields.name),
    label,
    is_management: isManagement ? 1 : 0,
    disabled: 0,
    limit_nano: (fields.limit_nano as number | null | undefined) ?? null,
    limit_reset: (fields.limit_reset as string | null | undefined) ?? null,
    include_byok_in_limit: (fields.include_byok_in_limit as number | undefined) ?? 0,
    usage_nano: 0,
    period_usage_nano: 0,
    period_start: 0,
    expires_at: (fields.expires_at as number | null | undefined) ?? null,
    created_at: now,
    updated_at: null,
    last_used_at: null,
    creator_user_id: userId,
  };
  await env.DB.prepare(
    `INSERT INTO api_keys (hash, user_id, name, label, is_management, disabled, limit_nano, limit_reset, include_byok_in_limit,
       usage_nano, period_usage_nano, period_start, expires_at, created_at, creator_user_id)
     VALUES (?,?,?,?,?,0,?,?,?,0,0,0,?,?,?)`,
  )
    .bind(hash, userId, row.name, label, row.is_management, row.limit_nano, row.limit_reset, row.include_byok_in_limit, row.expires_at, now, userId)
    .run();
  return { secret, row };
}

export async function updateKey(env: Env, userId: string, hash: string, fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  if (cols.length) {
    const res = await env.DB.prepare(`UPDATE api_keys SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE hash = ? AND user_id = ?`)
      .bind(...cols.map((k) => fields[k]), Date.now(), hash, userId)
      .run();
    if (!res.meta.changes) throw new ApiError(404, "API key not found");
  }
  const row = await env.DB.prepare(`SELECT * FROM api_keys WHERE hash = ? AND user_id = ?`).bind(hash, userId).first<ApiKeyRow>();
  if (!row) throw new ApiError(404, "API key not found");
  return row;
}

api.get("/keys", async (c) => {
  const auth = await authenticateApiKey(c, { management: true });
  const offset = Math.max(0, Number(c.req.query("offset") ?? "0") || 0);
  const includeDisabled = c.req.query("include_disabled") === "true";
  const rows = await c.env.DB.prepare(
    `SELECT * FROM api_keys WHERE user_id = ? AND is_management = 0 ${includeDisabled ? "" : "AND disabled = 0"}
     ORDER BY created_at DESC LIMIT 100 OFFSET ?`,
  )
    .bind(auth.key.user_id, offset)
    .all<ApiKeyRow>();
  return c.json({ data: await Promise.all(rows.results.map((k) => keyObject(c.env, k))) });
});

api.post("/keys", async (c) => {
  const auth = await authenticateApiKey(c, { management: true });
  const fields = parseKeyFields(await readJson(c), false);
  const { secret, row } = await createKey(c.env, auth.key.user_id, fields);
  return c.json({ data: await keyObject(c.env, row), key: secret }, 201);
});

api.get("/keys/:hash", async (c) => {
  const auth = await authenticateApiKey(c, { management: true });
  const row = await c.env.DB.prepare(`SELECT * FROM api_keys WHERE hash = ? AND user_id = ?`).bind(c.req.param("hash"), auth.key.user_id).first<ApiKeyRow>();
  if (!row) throw new ApiError(404, "API key not found");
  return c.json({ data: await keyObject(c.env, row) });
});

api.patch("/keys/:hash", async (c) => {
  const auth = await authenticateApiKey(c, { management: true });
  const row = await updateKey(c.env, auth.key.user_id, c.req.param("hash"), parseKeyFields(await readJson(c), true));
  return c.json({ data: await keyObject(c.env, row) });
});

api.delete("/keys/:hash", async (c) => {
  const auth = await authenticateApiKey(c, { management: true });
  const hash = c.req.param("hash");
  if (hash === auth.key.hash) throw new ApiError(400, "A management key cannot delete itself");
  const res = await c.env.DB.prepare(`DELETE FROM api_keys WHERE hash = ? AND user_id = ?`).bind(hash, auth.key.user_id).run();
  if (!res.meta.changes) throw new ApiError(404, "API key not found");
  return c.json({ deleted: true });
});

// --- OAuth PKCE: exchange an authorization code for a user-controlled API key --
api.post("/auth/keys", async (c) => {
  const body = await readJson(c);
  if (typeof body.code !== "string") throw new ApiError(400, "code is required");
  const codeHash = await hashKey(body.code);
  const row = await c.env.DB.prepare(`UPDATE auth_codes SET used = 1 WHERE code_hash = ? AND used = 0 AND expires_at > ? RETURNING *`)
    .bind(codeHash, Date.now())
    .first<any>();
  if (!row) throw new ApiError(403, "Invalid or expired authorization code");
  if (row.code_challenge) {
    if (typeof body.code_verifier !== "string") throw new ApiError(400, "code_verifier is required");
    const method = row.code_challenge_method ?? "plain";
    const computed = method === "S256" ? await sha256Base64Url(body.code_verifier) : body.code_verifier;
    if (!safeEqual(computed, row.code_challenge)) throw new ApiError(403, "Invalid code_verifier");
  }
  const { secret } = await createKey(c.env, row.user_id, {
    name: row.key_label ?? `OAuth key (${new URL(row.callback_url).host})`,
    limit_nano: row.limit_nano,
    limit_reset: row.limit_reset,
    expires_at: row.key_expires_at,
  });
  return c.json({ key: secret, user_id: row.user_id });
});

export function newAuthCode() {
  return `oorc_${randomId(40)}`;
}
