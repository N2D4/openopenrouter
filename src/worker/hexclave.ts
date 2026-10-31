import type { Env } from "./env";
import { ApiError } from "./errors";

/** Minimal server-side Hexclave REST client (secret server key). */
export async function hexclaveServer(env: Env, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${env.HEXCLAVE_API_URL}/api/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-hexclave-access-type": "server",
      "x-hexclave-project-id": env.HEXCLAVE_PROJECT_ID,
      "x-hexclave-secret-server-key": env.HEXCLAVE_SECRET_SERVER_KEY,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const code = res.headers.get("x-hexclave-known-error") ?? json?.code;
    throw Object.assign(new ApiError(res.status >= 500 ? 502 : res.status, `Hexclave: ${json?.error ?? json?.message ?? text.slice(0, 300)}`), { code });
  }
  return json;
}

/** Credit packs sold through Hexclave Payments. Item quantity unit: 1 US cent. */
export const CREDIT_ITEM_ID = "credits";
export const CENT_IN_NANO = 10_000_000;
