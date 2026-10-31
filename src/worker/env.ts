export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  KEY_LIMITER: RateLimit;
  DASHBOARD_LIMITER: RateLimit;

  // Plain vars (wrangler.jsonc)
  SITE_NAME: string;
  PUBLIC_URL: string;
  HEXCLAVE_PROJECT_ID: string;
  HEXCLAVE_API_URL: string;
  /** Credits (in USD) granted to every new account. "0" disables it. */
  SIGNUP_CREDITS_USD: string;
  /** Comma-separated Hexclave user IDs that may use the admin endpoints. */
  ADMIN_USER_IDS?: string;

  // Secrets (wrangler secret put)
  HEXCLAVE_SECRET_SERVER_KEY: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

export type AppEnv = { Bindings: Env; Variables: { auth?: import("./auth").ApiKeyAuth; userId?: string } };
