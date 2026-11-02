<img src="assets/icon.svg" width="64" height="64" alt="">

# OpenOpenRouter

**OpenRouter, but open source.** The same API, model IDs and prices, as a gateway you can self-host on Cloudflare. Use the hosted instance or run your own; either way, migrating is one changed base URL.

Hosted instance: **https://openopenrouter.ai**

```ts
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://openopenrouter.ai/api/v1", // was https://openrouter.ai/api/v1
  apiKey: process.env.OPENOPENROUTER_API_KEY,
});

await client.chat.completions.create({
  model: "anthropic/claude-sonnet-5.5",
  messages: [{ role: "user", content: "Hello!" }],
});
```

Claude Code works too, with Claude **or** GPT models:

```sh
export ANTHROPIC_BASE_URL=https://openopenrouter.ai/api
export ANTHROPIC_AUTH_TOKEN=$OPENOPENROUTER_API_KEY
export ANTHROPIC_API_KEY=""
claude --model anthropic/claude-sonnet-5.5   # or openai/gpt-5.5
```

## What's compatible

| OpenRouter API | Status |
|---|---|
| `POST /chat/completions` (streaming, tools, `response_format`/structured outputs, `reasoning`, `reasoning_details` round-tripping, `models` fallbacks, `provider` preferences, `usage` with `cost`) | ✅ |
| `POST /completions` (legacy) | ✅ |
| `POST /messages` (Anthropic Messages API) for Anthropic models (native passthrough incl. caching, thinking, beta headers) and OpenAI models (translated) | ✅ |
| `POST /messages/count_tokens` | ✅ |
| `POST /responses` (OpenAI Responses API) | ✅ OpenAI models |
| `POST /embeddings`, `GET /embeddings/models` | ✅ |
| `GET /models`, `/models/count`, `/models/user`, `/model/{a}/{s}`, `/models/{a}/{s}/endpoints`, `/providers` | ✅ same schema, IDs and prices |
| `GET /key`, `GET /credits`, `GET /generation`, `GET /activity` | ✅ |
| `GET/POST /keys`, `GET/PATCH/DELETE /keys/{hash}` (management keys, per-key limits with daily/weekly/monthly reset, expiry) | ✅ |
| OAuth PKCE (`/auth?callback_url=…` + `POST /auth/keys`) | ✅ |
| Model variants `:nitro`, `:floor`, `:exacto` | ✅ (no-ops: one provider per model) |
| Responses-only OpenAI models (`*-pro`, `*-codex`) via `/chat/completions` | ✅ translated |
| BYOK, presets, guardrails, workspaces, web search plugin (`:online`), images/audio/video endpoints, batches, files, rerank | ❌ not yet |

Model IDs and per-token prices are taken from OpenRouter's public catalog and intersected with what your provider keys can actually serve (`pnpm catalog:sync`). Unsupported request parameters are dropped per model, as on OpenRouter.

## Architecture

```
Client ──► Cloudflare Worker (Hono) ──► api.openai.com / api.anthropic.com
              │   ├─ /api/v1/*        OpenRouter-compatible API (API-key auth)
              │   ├─ /api/internal/*  dashboard API (Hexclave JWT auth)
              │   └─ static assets    React dashboard (Vite)
              ├─ D1: accounts, credit ledger, hashed API keys, generation metadata
              └─ Hexclave: sign-in (email OTP, passkeys, GitHub, Google), emails,
                 credit-pack payments (Stripe), product analytics
```

- **Metering:** every request is streamed from the upstream provider (also for non-streaming clients), so usage is captured even on long requests. Cost is computed from provider-reported tokens, with cache-read/write and long-context tiers, and debited atomically from the account and key in nano-dollar integers.
- **Payments:** credit packs are Hexclave Payments products that grant a `credits` item (in cents). The dashboard moves purchased cents into the gateway ledger by atomically decrementing the Hexclave item first, so each purchase is credited exactly once.

## Security

- API keys (`sk-oor-v1-…`) are 256-bit random; only their SHA-256 is stored. Shown once.
- Prompts and completions are **never stored or logged**; only token counts, cost, model, latency and status.
- Dashboard API: Hexclave ES256 access tokens verified locally (JWKS, audience-checked), header-based, so no cookies and no CSRF surface. Anonymous/restricted users are rejected.
- Strict CSP (no `unsafe-eval`, no inline scripts), `frame-ancestors 'none'`, HSTS, nosniff.
- Per-key and per-user rate limits (Workers rate limiting), 32 MB body cap, PKCE (S256) with single-use, 10-minute codes, https-only callbacks.
- Provider and Hexclave secrets live only in Worker secrets.
- Supply chain: pnpm with a 7-day minimum release age, install scripts disabled except allow-listed (`esbuild`, `workerd`), no git/tarball transitive deps, exact versions, `trustPolicy: no-downgrade`, frozen lockfile in CI and SHA-pinned GitHub Actions.

## Self-hosting

You need a Cloudflare account, a [Hexclave](https://hexclave.com) project (or a self-hosted Hexclave), and OpenAI and/or Anthropic API keys.

```sh
git clone https://github.com/N2D4/openopenrouter && cd openopenrouter
pnpm install

# 1. Cloudflare: database
pnpm exec wrangler login
pnpm exec wrangler d1 create openopenrouter   # paste the ID into wrangler.jsonc
```

2. Edit `wrangler.jsonc`: `account_id`, `database_id`, `routes` (your domain), and the `vars` (`PUBLIC_URL`, `HEXCLAVE_PROJECT_ID`, `HEXCLAVE_API_URL`, `SIGNUP_CREDITS_USD`).
3. Hexclave: create a project, then push the config (auth methods, credit-pack products):
   ```sh
   pnpm exec hexclave login
   pnpm hexclave:push --cloud-project-id <project-id>
   ```
   In the Hexclave dashboard: add your domain under **Domains** (and disable localhost callbacks), connect Stripe under **Payments**, and keep **test mode off** in production (in test mode anyone can "buy" credits for free). For production OAuth, add your own GitHub/Google client credentials.
4. Secrets and deploy:
   ```sh
   pnpm exec wrangler secret put HEXCLAVE_SECRET_SERVER_KEY
   pnpm exec wrangler secret put OPENAI_API_KEY      # optional
   pnpm exec wrangler secret put ANTHROPIC_API_KEY   # optional
   pnpm run deploy   # build, apply D1 migrations, deploy
   ```
5. Optionally refresh the model catalog for your keys: `OPENAI_API_KEY=… ANTHROPIC_API_KEY=… pnpm catalog:sync`, then redeploy.

Give someone credits without payments: `pnpm admin:grant user@example.com 25 "Beta tester"` (they must have signed in once).

## Development

```sh
pnpm typecheck && pnpm test
pnpm exec wrangler dev        # API on :8787 (put secrets in .dev.vars)
pnpm dev                      # dashboard on :5173, proxies /api to :8787
```

## License

MIT. Not affiliated with OpenRouter, Inc.
