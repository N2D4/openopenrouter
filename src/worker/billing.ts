import type { ApiKeyAuth, ApiKeyRow } from "./auth";
import type { CatalogModel } from "./catalog";
import type { Env } from "./env";
import { ApiError } from "./errors";
import { computeCost, type NormalizedUsage } from "./pricing";
import { randomId, usdToNano } from "./util";

/** Start (ms) of the current limit window for a key's limit_reset setting. 0 = never resets. */
export function periodStart(reset: string | null, now = Date.now()): number {
  if (!reset) return 0;
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (reset === "daily") return midnight;
  if (reset === "weekly") return midnight - ((d.getUTCDay() + 6) % 7) * 86_400_000; // Monday 00:00 UTC
  if (reset === "monthly") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return 0;
}

/** Usage counted against the key's limit in the current window. */
export function keyLimitUsage(key: ApiKeyRow, now = Date.now()): number {
  if (!key.limit_reset) return key.usage_nano;
  return key.period_start < periodStart(key.limit_reset, now) ? 0 : key.period_usage_nano;
}

export function keyLimitRemaining(key: ApiKeyRow): number | null {
  return key.limit_nano == null ? null : Math.max(0, key.limit_nano - keyLimitUsage(key));
}

/** Reject requests that cannot be paid for before contacting the upstream provider. */
export function preflight(auth: ApiKeyAuth, model: CatalogModel) {
  const free = Number(model.pricing.prompt) === 0 && Number(model.pricing.completion) === 0;
  if (free) return;
  if (auth.credits_nano - auth.account_usage_nano <= 0) {
    throw new ApiError(402, "Insufficient credits. Add more using https://openopenrouter.ai/settings/credits", {
      balance: (auth.credits_nano - auth.account_usage_nano) / 1e9,
    });
  }
  const remaining = keyLimitRemaining(auth.key);
  if (remaining != null && remaining <= 0) {
    throw new ApiError(403, "Key limit exceeded. Manage it using https://openopenrouter.ai/settings/keys");
  }
}

export interface GenerationRecord {
  id: string;
  auth: ApiKeyAuth;
  model: CatalogModel;
  apiType: "completions" | "embeddings";
  upstreamId: string | null;
  streamed: boolean;
  cancelled: boolean;
  finishReason: string | null;
  nativeFinishReason: string | null;
  usage: NormalizedUsage;
  startedAt: number;
  firstTokenAt: number | null;
  status: number;
  error?: string | null;
  origin: string | null;
  appTitle: string | null;
  userAgent: string | null;
  externalUser: string | null;
}

/** Persist a generation and debit its cost from the account and key, atomically. */
export async function recordGeneration(env: Env, r: GenerationRecord) {
  const cost = computeCost(r.model, r.usage).nano;
  const now = Date.now();
  const ps = periodStart(r.auth.key.limit_reset, now);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO generations (id, user_id, key_hash, model, model_permaslug, provider_name, api_type, upstream_id,
        streamed, cancelled, finish_reason, native_finish_reason, tokens_prompt, tokens_completion,
        native_tokens_cached, native_tokens_cache_write, native_tokens_reasoning, cost_nano, latency_ms,
        generation_time_ms, status, error, origin, app_title, user_agent, external_user, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      r.id,
      r.auth.key.user_id,
      r.auth.key.hash,
      r.model.id,
      r.model.canonical_slug,
      r.model._provider === "openai" ? "OpenAI" : "Anthropic",
      r.apiType,
      r.upstreamId,
      r.streamed ? 1 : 0,
      r.cancelled ? 1 : 0,
      r.finishReason,
      r.nativeFinishReason,
      r.usage.prompt_tokens,
      r.usage.completion_tokens,
      r.usage.cached_tokens,
      r.usage.cache_write_tokens,
      r.usage.reasoning_tokens,
      cost,
      r.firstTokenAt != null ? r.firstTokenAt - r.startedAt : null,
      now - r.startedAt,
      r.status,
      r.error ?? null,
      r.origin,
      r.appTitle,
      r.userAgent,
      r.externalUser,
      r.startedAt,
    ),
    env.DB.prepare(`UPDATE accounts SET usage_nano = usage_nano + ? WHERE user_id = ?`).bind(cost, r.auth.key.user_id),
    env.DB.prepare(
      `UPDATE api_keys SET usage_nano = usage_nano + ?1,
         period_usage_nano = CASE WHEN period_start < ?2 THEN ?1 ELSE period_usage_nano + ?1 END,
         period_start = CASE WHEN period_start < ?2 THEN ?2 ELSE period_start END,
         last_used_at = ?3
       WHERE hash = ?4`,
    ).bind(cost, ps, now, r.auth.key.hash),
  ]);
}

/** Create the account row on first sign-in, granting the configured signup credits once. */
export async function ensureAccount(env: Env, userId: string, email: string | null) {
  const res = await env.DB.prepare(
    `INSERT INTO accounts (user_id, email, credits_nano, usage_nano, created_at) VALUES (?, ?, 0, 0, ?)
     ON CONFLICT(user_id) DO NOTHING`,
  )
    .bind(userId, email, Date.now())
    .run();
  if (res.meta.changes > 0) {
    const bonus = usdToNano(Number(env.SIGNUP_CREDITS_USD || "0"));
    if (bonus > 0) await grantCredits(env, userId, bonus, "signup", "Welcome credits");
  } else if (email) {
    await env.DB.prepare(`UPDATE accounts SET email = ? WHERE user_id = ? AND email IS NOT ?`).bind(email, userId, email).run();
  }
}

export async function grantCredits(env: Env, userId: string, amountNano: number, source: string, note: string | null) {
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO credit_grants (id, user_id, amount_nano, source, note, created_at) VALUES (?,?,?,?,?,?)`).bind(
      `grant_${randomId(20)}`,
      userId,
      amountNano,
      source,
      note,
      Date.now(),
    ),
    env.DB.prepare(`UPDATE accounts SET credits_nano = credits_nano + ? WHERE user_id = ?`).bind(amountNano, userId),
  ]);
}
