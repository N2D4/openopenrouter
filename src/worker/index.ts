import { Hono } from "hono";
import { cors } from "hono/cors";
import { catalogGeneratedAt } from "./catalog";
import type { AppEnv, Env } from "./env";
import { ApiError, errorResponse } from "./errors";
import { api } from "./routes/api";
import { dashboard } from "./routes/dashboard";

const app = new Hono<AppEnv>();

// Public API: callable from browsers with an API key (no cookies are ever used).
const apiCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [
    "authorization",
    "content-type",
    "http-referer",
    "x-title",
    "x-openrouter-title",
    "x-api-key",
    "anthropic-version",
    "anthropic-beta",
    "x-stainless-arch",
    "x-stainless-lang",
    "x-stainless-os",
    "x-stainless-package-version",
    "x-stainless-retry-count",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
    "x-stainless-timeout",
  ],
  maxAge: 86400,
});
app.use("/api/v1/*", apiCors);
app.use("/v1/*", apiCors);

app.use("*", async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  c.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store");
});

app.get("/api/health", (c) => c.json({ ok: true, catalog_generated_at: catalogGeneratedAt }));
app.route("/api/v1", api);
app.route("/v1", api);
app.route("/api/internal", dashboard);

app.all("/api/*", () => errorResponse(404, "Not found"));
app.all("/v1/*", () => errorResponse(404, "Not found"));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    const res = errorResponse(err.status, err.message, err.metadata);
    // Keep CORS headers on errors so browser clients can read them.
    if (c.req.path.startsWith("/api/v1") || c.req.path.startsWith("/v1")) res.headers.set("access-control-allow-origin", "*");
    return res;
  }
  console.error("Unhandled error", c.req.method, c.req.path, err);
  return errorResponse(500, "Internal server error");
});

// Everything else is the dashboard SPA (served from static assets).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env) {
    // Expired PKCE codes are useless; keep the table small.
    await env.DB.prepare(`DELETE FROM auth_codes WHERE expires_at < ?`).bind(Date.now() - 86_400_000).run();
  },
} satisfies ExportedHandler<Env>;
