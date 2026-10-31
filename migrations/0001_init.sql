-- Accounts are keyed by Hexclave user ID. Money is stored in nano-dollars.
CREATE TABLE accounts (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  credits_nano INTEGER NOT NULL DEFAULT 0,
  usage_nano INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE credit_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  amount_nano INTEGER NOT NULL,
  source TEXT NOT NULL, -- 'purchase' | 'signup' | 'admin'
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX credit_grants_user ON credit_grants(user_id, created_at);

-- Only the SHA-256 of a key is stored. The plaintext is shown once at creation.
CREATE TABLE api_keys (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES accounts(user_id),
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  is_management INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  limit_nano INTEGER,
  limit_reset TEXT, -- NULL | 'daily' | 'weekly' | 'monthly'
  include_byok_in_limit INTEGER NOT NULL DEFAULT 0,
  usage_nano INTEGER NOT NULL DEFAULT 0,
  period_usage_nano INTEGER NOT NULL DEFAULT 0,
  period_start INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  last_used_at INTEGER,
  creator_user_id TEXT
);
CREATE INDEX api_keys_user ON api_keys(user_id);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT,
  model TEXT NOT NULL,
  model_permaslug TEXT,
  provider_name TEXT,
  api_type TEXT NOT NULL,
  upstream_id TEXT,
  streamed INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  finish_reason TEXT,
  native_finish_reason TEXT,
  tokens_prompt INTEGER NOT NULL DEFAULT 0,
  tokens_completion INTEGER NOT NULL DEFAULT 0,
  native_tokens_cached INTEGER NOT NULL DEFAULT 0,
  native_tokens_cache_write INTEGER NOT NULL DEFAULT 0,
  native_tokens_reasoning INTEGER NOT NULL DEFAULT 0,
  cost_nano INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  generation_time_ms INTEGER,
  status INTEGER NOT NULL DEFAULT 200,
  error TEXT,
  origin TEXT,
  app_title TEXT,
  user_agent TEXT,
  external_user TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX generations_user ON generations(user_id, created_at);
CREATE INDEX generations_key ON generations(key_hash, created_at);

-- PKCE authorization codes for the "Sign in with OpenOpenRouter" key flow.
CREATE TABLE auth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  callback_url TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT,
  key_label TEXT,
  limit_nano INTEGER,
  limit_reset TEXT,
  key_expires_at INTEGER,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
