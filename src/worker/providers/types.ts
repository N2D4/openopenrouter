import type { NormalizedUsage } from "../pricing";

/** A single-choice chat completion delta, in OpenRouter's chunk format. */
export interface ChatDelta {
  role?: "assistant";
  content?: string;
  reasoning?: string;
  reasoning_details?: any[];
  refusal?: string;
  tool_calls?: Array<{ index: number; id?: string; type?: "function"; function: { name?: string; arguments?: string } }>;
  annotations?: any[];
}

export interface ChatChunk {
  delta?: ChatDelta;
  finish_reason?: string | null;
  native_finish_reason?: string | null;
  logprobs?: any;
  /** Present once, on the final chunk. */
  usage?: NormalizedUsage;
  /** Usage known so far (e.g. prompt tokens at stream start), billed if the stream is cut off. */
  partialUsage?: NormalizedUsage;
  upstream_id?: string;
  system_fingerprint?: string | null;
  /** A provider error after streaming has started. */
  error?: { code: number; message: string; metadata?: Record<string, unknown> };
}

export type ChatStream = AsyncGenerator<ChatChunk>;

/** Raised before any output is produced, so the router may try the next model. */
export class UpstreamError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryable: boolean,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Map an upstream HTTP failure to an OpenRouter-style status code. */
export async function upstreamFailure(res: Response, providerName: string): Promise<UpstreamError> {
  const text = await res.text().catch(() => "");
  let message = text.slice(0, 2000);
  try {
    const j = JSON.parse(text);
    message = j?.error?.message ?? j?.message ?? message;
  } catch {
    /* not JSON */
  }
  const s = res.status;
  const metadata = { provider_name: providerName, raw: text.slice(0, 2000) };
  if (s === 429) return new UpstreamError(429, `${providerName}: rate limited by upstream provider. ${message}`, true, metadata);
  if (s === 401 || s === 403) return new UpstreamError(502, `${providerName}: upstream authentication failed`, true, { provider_name: providerName });
  if (s === 408 || s === 504) return new UpstreamError(408, `${providerName}: upstream timed out`, true, metadata);
  if (s >= 500) return new UpstreamError(502, `${providerName}: ${message || "upstream error"}`, true, metadata);
  if (s === 413) return new UpstreamError(413, `${providerName}: ${message}`, false, metadata);
  return new UpstreamError(400, `${providerName}: ${message}`, false, metadata);
}
