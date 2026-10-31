import type { Context } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv, Env } from "./env";
import { ApiError } from "./errors";
import { randomHex, sha256Hex } from "./util";

export const KEY_PREFIX = "sk-oor-v1-";

export interface ApiKeyRow {
  hash: string;
  user_id: string;
  name: string;
  label: string;
  is_management: number;
  disabled: number;
  limit_nano: number | null;
  limit_reset: string | null;
  include_byok_in_limit: number;
  usage_nano: number;
  period_usage_nano: number;
  period_start: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number | null;
  last_used_at: number | null;
  creator_user_id: string | null;
}

export interface ApiKeyAuth {
  key: ApiKeyRow;
  credits_nano: number;
  account_usage_nano: number;
}

export function newApiKey() {
  const secret = `${KEY_PREFIX}${randomHex(32)}`;
  return { secret, label: `${secret.slice(0, 13)}...${secret.slice(-4)}` };
}

export const hashKey = (secret: string) => sha256Hex(secret);

/** Extract a bearer token. Accepts `Authorization: Bearer` and Anthropic-style `x-api-key`. */
export function bearerToken(c: Context): string | null {
  const auth = c.req.header("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const xKey = c.req.header("x-api-key");
  return xKey ? xKey.trim() : null;
}

export async function authenticateApiKey(c: Context<AppEnv>, opts: { management?: boolean } = {}): Promise<ApiKeyAuth> {
  const token = bearerToken(c);
  if (!token) throw new ApiError(401, "No auth credentials found");
  if (!token.startsWith(KEY_PREFIX)) throw new ApiError(401, "Invalid API key");
  const hash = await hashKey(token);
  const row = await c.env.DB.prepare(
    `SELECT k.*, a.credits_nano AS a_credits, a.usage_nano AS a_usage
     FROM api_keys k JOIN accounts a ON a.user_id = k.user_id WHERE k.hash = ?`,
  )
    .bind(hash)
    .first<ApiKeyRow & { a_credits: number; a_usage: number }>();
  if (!row) throw new ApiError(401, "User not found.");
  if (row.disabled) throw new ApiError(403, "This API key is disabled");
  if (row.expires_at != null && row.expires_at <= Date.now()) throw new ApiError(401, "This API key has expired");
  if (opts.management === true && !row.is_management) {
    throw new ApiError(403, "Only management keys can perform this operation");
  }
  if (opts.management === false && row.is_management) {
    throw new ApiError(403, "Management keys cannot be used for inference. Create a regular API key instead.");
  }
  const { a_credits, a_usage, ...key } = row;
  return { key, credits_nano: a_credits, account_usage_nano: a_usage };
}

// ---------------------------------------------------------------------------
// Dashboard auth: Hexclave access tokens (ES256 JWTs), verified locally.
// ---------------------------------------------------------------------------

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;

function getJwks(env: Env) {
  const url = `${env.HEXCLAVE_API_URL}/api/v1/projects/${env.HEXCLAVE_PROJECT_ID}/.well-known/jwks.json`;
  if (!jwks || jwks.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60 * 1000 }) };
  return jwks.set;
}

export interface DashboardUser {
  id: string;
  email: string | null;
}

/** Verify the Hexclave access token sent by the dashboard SPA. */
export async function requireUser(c: Context<AppEnv>): Promise<DashboardUser> {
  const token = c.req.header("x-hexclave-access-token") ?? bearerToken(c);
  if (!token) throw new ApiError(401, "Not signed in");
  try {
    const { payload } = await jwtVerify(token, getJwks(c.env), {
      audience: c.env.HEXCLAVE_PROJECT_ID,
      algorithms: ["ES256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("missing sub");
    if (payload.is_anonymous === true) throw new ApiError(401, "Anonymous users cannot use the dashboard");
    if (payload.is_restricted === true) throw new ApiError(403, "Finish setting up your account (verify your email) first");
    const email = typeof payload.email === "string" ? payload.email : null;
    return { id: payload.sub, email };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(401, "Invalid or expired session");
  }
}
