export interface SseEvent {
  event?: string;
  data: string;
}

/** Incrementally parse a text/event-stream body. Comment lines are skipped. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];
  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = undefined;
          data = [];
        } else if (line.startsWith(":")) {
          continue;
        } else {
          const idx = line.indexOf(":");
          const field = idx === -1 ? line : line.slice(0, idx);
          let val = idx === -1 ? "" : line.slice(idx + 1);
          if (val.startsWith(" ")) val = val.slice(1);
          if (field === "data") data.push(val);
          else if (field === "event") event = val;
        }
      }
    }
    if (data.length) yield { event, data: data.join("\n") };
    finished = true;
  } finally {
    // Stopped early (client gone, error, or consumer broke out): cancel upstream so the provider stops generating.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

const encoder = new TextEncoder();

/** A push-based SSE writer backed by a TransformStream. */
export class SseWriter {
  readonly readable: ReadableStream<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private closed = false;

  constructor() {
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    this.readable = ts.readable;
    this.writer = ts.writable.getWriter();
  }

  async comment(text: string) {
    await this.raw(`: ${text}\n\n`);
  }

  async data(obj: unknown) {
    await this.raw(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`);
  }

  async event(name: string, obj: unknown) {
    await this.raw(`event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`);
  }

  async raw(text: string) {
    if (this.closed) return;
    try {
      await this.writer.write(encoder.encode(text));
    } catch {
      // Client disconnected.
      this.closed = true;
    }
  }

  get isClosed() {
    return this.closed;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.writer.close();
    } catch {
      /* already closed */
    }
  }
}

export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};
