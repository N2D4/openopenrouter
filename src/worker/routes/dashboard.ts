import { Hono } from "hono";
import { type ApiKeyRow, hashKey, requireUser } from "../auth";
import { ensureAccount, grantCredits } from "../billing";
import type { AppEnv } from "../env";
import { ApiError } from "../errors";
import { CENT_IN_NANO, CREDIT_ITEM_ID, hexclaveServer } from "../hexclave";
import { nanoToUsd, usdToNano } from "../util";
import { createKey, generationObject, keyObject, newAuthCode, parseKeyFields, updateKey } from "./api";
import { readJson } from "./inference";

/** Private API used by the dashboard SPA. Authenticated with Hexclave access tokens. */
export const dashboard = new Hono<AppEnv>();

dashboard.use("*", async (c, next) => {
  const user = await requireUser(c);
  const { success } = await c.env.DASHBOARD_LIMITER.limit({ key: user.id });
  if (!success) throw new ApiError(429, "Too many requests");
  await ensureAccount(c.env, user.id, user.email);
  c.set("userId", user.id);
  await next();
  c.header("cache-control", "private, no-store");
});

async function account(c: any) {
  const a = await c.env.DB.prepare(`SELECT * FROM accounts WHERE user_id = ?`).bind(c.get("userId")).first();
  return {
    user_id: a.user_id,
    email: a.email,
    total_credits: nanoToUsd(a.credits_nano),
    total_usage: nanoToUsd(a.usage_nano),
    balance: nanoToUsd(a.credits_nano - a.usage_nano),
  };
}

dashboard.get("/me", async (c) => c.json(await account(c)));

/**
 * Move credits bought through Hexclave Payments into the gateway ledger.
 * The Hexclave item is decremented first (atomic, never negative), so a purchase is credited at most once.
 */
dashboard.post("/credits/claim", async (c) => {
  const userId = c.get("userId")!;
  const item = await hexclaveServer(c.env, `/payments/items/user/${encodeURIComponent(userId)}/${CREDIT_ITEM_ID}`);
  const cents = Math.floor(Number(item?.quantity ?? 0));
  let claimed = 0;
  if (cents > 0) {
    await hexclaveServer(c.env, `/payments/items/user/${encodeURIComponent(userId)}/${CREDIT_ITEM_ID}/update-quantity?allow_negative=false`, {
      method: "POST",
      body: { delta: -cents, description: "Moved to OpenOpenRouter balance" },
    });
    try {
      await grantCredits(c.env, userId, cents * CENT_IN_NANO, "purchase", `Credit purchase ($${(cents / 100).toFixed(2)})`);
    } catch (e) {
      // Put the purchased credits back so the next claim can retry.
      await hexclaveServer(c.env, `/payments/items/user/${encodeURIComponent(userId)}/${CREDIT_ITEM_ID}/update-quantity?allow_negative=false`, {
        method: "POST",
        body: { delta: cents, description: "Restored after a failed claim" },
      });
      throw e;
    }
    claimed = cents / 100;
  }
  return c.json({ claimed, account: await account(c) });
});

dashboard.post("/credits/checkout", async (c) => {
  const body = await readJson(c);
  const productId = String(body.product_id ?? "");
  if (!/^credits_\d+usd$/.test(productId)) throw new ApiError(400, "Unknown product");
  const res = await hexclaveServer(c.env, "/payments/purchases/create-purchase-url", {
    method: "POST",
    body: {
      customer_type: "user",
      customer_id: c.get("userId"),
      product_id: productId,
      return_url: `${c.env.PUBLIC_URL}/settings/credits?purchased=1`,
    },
  });
  return c.json({ url: res.url });
});

dashboard.get("/credits/grants", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM credit_grants WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`).bind(c.get("userId")).all<any>();
  return c.json({
    data: rows.results.map((g) => ({ id: g.id, amount: nanoToUsd(g.amount_nano), source: g.source, note: g.note, created_at: new Date(g.created_at).toISOString() })),
  });
});

// --- API keys ------------------------------------------------------------------
dashboard.get("/keys", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`).bind(c.get("userId")).all<ApiKeyRow>();
  return c.json({ data: await Promise.all(rows.results.map((k) => keyObject(c.env, k))) });
});

dashboard.post("/keys", async (c) => {
  const body = await readJson(c);
  const { secret, row } = await createKey(c.env, c.get("userId")!, parseKeyFields(body, false), body.is_management === true);
  return c.json({ data: await keyObject(c.env, row), key: secret }, 201);
});

dashboard.patch("/keys/:hash", async (c) => {
  const row = await updateKey(c.env, c.get("userId")!, c.req.param("hash"), parseKeyFields(await readJson(c), true));
  return c.json({ data: await keyObject(c.env, row) });
});

dashboard.delete("/keys/:hash", async (c) => {
  const res = await c.env.DB.prepare(`DELETE FROM api_keys WHERE hash = ? AND user_id = ?`).bind(c.req.param("hash"), c.get("userId")).run();
  if (!res.meta.changes) throw new ApiError(404, "API key not found");
  return c.json({ deleted: true });
});

// --- Activity --------------------------------------------------------------------
dashboard.get("/activity", async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query("days") ?? "30") || 30));
  const since = Date.now() - days * 86_400_000;
  const userId = c.get("userId");
  const [daily, byModel] = await Promise.all([
    c.env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS date, COUNT(*) AS requests, SUM(cost_nano) AS cost,
         SUM(tokens_prompt) AS prompt_tokens, SUM(tokens_completion) AS completion_tokens
       FROM generations WHERE user_id = ? AND created_at >= ? GROUP BY date ORDER BY date`,
    )
      .bind(userId, since)
      .all<any>(),
    c.env.DB.prepare(
      `SELECT model, COUNT(*) AS requests, SUM(cost_nano) AS cost, SUM(tokens_prompt) AS prompt_tokens, SUM(tokens_completion) AS completion_tokens
       FROM generations WHERE user_id = ? AND created_at >= ? GROUP BY model ORDER BY cost DESC LIMIT 20`,
    )
      .bind(userId, since)
      .all<any>(),
  ]);
  const map = (r: any) => ({ ...r, cost: nanoToUsd(r.cost ?? 0) });
  return c.json({ daily: daily.results.map(map), by_model: byModel.results.map(map) });
});

dashboard.get("/generations", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? "50") || 50));
  const before = Number(c.req.query("before") ?? "0") || Number.MAX_SAFE_INTEGER;
  const rows = await c.env.DB.prepare(
    `SELECT g.*, k.name AS key_name FROM generations g LEFT JOIN api_keys k ON k.hash = g.key_hash
     WHERE g.user_id = ? AND g.created_at < ? ORDER BY g.created_at DESC LIMIT ?`,
  )
    .bind(c.get("userId"), before, limit)
    .all<any>();
  return c.json({
    data: rows.results.map((g) => ({ ...generationObject(g), key_name: g.key_name, app_title: g.app_title, status: g.status, error: g.error })),
    next_before: rows.results.length === limit ? rows.results.at(-1).created_at : null,
  });
});

// --- OAuth PKCE consent ----------------------------------------------------------
function validateCallback(raw: unknown): URL {
  if (typeof raw !== "string") throw new ApiError(400, "callback_url is required");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ApiError(400, "callback_url must be a valid URL");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) throw new ApiError(400, "callback_url must use https (or http on localhost)");
  return u;
}

dashboard.post("/auth-codes", async (c) => {
  const body = await readJson(c);
  const cb = validateCallback(body.callback_url);
  const method = body.code_challenge_method ?? (body.code_challenge ? "plain" : null);
  if (method && method !== "S256" && method !== "plain") throw new ApiError(400, "code_challenge_method must be S256 or plain");
  const code = newAuthCode();
  const limit = body.limit != null ? Number(body.limit) : null;
  if (limit != null && (!Number.isFinite(limit) || limit < 0)) throw new ApiError(400, "limit must be a non-negative number");
  const keyExpires = body.expires_at ? Date.parse(body.expires_at) : null;
  await c.env.DB.prepare(
    `INSERT INTO auth_codes (code_hash, user_id, callback_url, code_challenge, code_challenge_method, key_label, limit_nano, limit_reset, key_expires_at, expires_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      await hashKey(code),
      c.get("userId"),
      cb.toString(),
      body.code_challenge ?? null,
      method,
      typeof body.key_label === "string" ? body.key_label.slice(0, 200) : null,
      limit == null ? null : usdToNano(limit),
      ["daily", "weekly", "monthly"].includes(body.usage_limit_type) ? body.usage_limit_type : null,
      keyExpires && !Number.isNaN(keyExpires) ? keyExpires : null,
      Date.now() + 10 * 60 * 1000,
      Date.now(),
    )
    .run();
  const redirect = new URL(cb);
  redirect.searchParams.set("code", code);
  return c.json({ code, redirect_url: redirect.toString() });
});
