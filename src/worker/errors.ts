/** OpenRouter-compatible error body: { error: { code, message, metadata? } }. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public metadata?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorBody(status: number, message: string, metadata?: Record<string, unknown>) {
  return { error: { code: status, message, ...(metadata ? { metadata } : {}) } };
}

export function errorResponse(status: number, message: string, metadata?: Record<string, unknown>) {
  return new Response(JSON.stringify(errorBody(status, message, metadata)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
