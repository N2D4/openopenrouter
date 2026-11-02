import { hexclaveClientApp } from "./hexclave";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Call the dashboard API with the signed-in user's Hexclave access token. */
export async function internal<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const user = await hexclaveClientApp.getUser();
  const token = await user?.getAccessToken();
  if (!token) throw new HttpError(401, "Not signed in");
  const res = await fetch(`/api/internal${path}`, {
    method: init.method ?? "GET",
    headers: {
      "x-hexclave-access-token": token,
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, json?.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export async function publicApi<T = any>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new HttpError(res.status, json?.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export const usd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, n !== 0 && Math.abs(n) < 0.01 ? 6 : digits) });

/** Per-token USD price string → "$x / 1M tokens" number. */
export const perMillion = (p: string | undefined) => (p == null ? null : Number(p) * 1_000_000);

/** Per-token USD price string → "$2.50" per million tokens. */
export const money = (p: string | undefined) => {
  const v = perMillion(p);
  return v == null ? "–" : `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 3 })}`;
};

export const fmtInt = (n: number) => n.toLocaleString("en-US");

export function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

let modelsPromise: Promise<any[]> | undefined;
/** The public model list, fetched once per page load and shared by the nav search, landing page and model pages. */
export function loadModels(): Promise<any[]> {
  modelsPromise ??= publicApi<{ data: any[] }>("/models").then(
    (r) => r.data,
    (e) => {
      modelsPromise = undefined;
      throw e;
    },
  );
  return modelsPromise;
}

/** "OpenAI: GPT-6.1 Sol" → "GPT-6.1 Sol" */
export const shortName = (name: string) => name.replace(/^[^:]+:\s*/, "");

export const REPO_URL = "https://github.com/N2D4/openopenrouter";
