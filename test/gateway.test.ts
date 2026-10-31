import { describe, expect, it } from "vitest";
import { periodStart } from "../src/worker/billing";
import { findModel, resolveModel } from "../src/worker/catalog";
import { computeCost, fromAnthropicUsage, fromOpenAIChatUsage } from "../src/worker/pricing";
import { toAnthropicRequest } from "../src/worker/providers/anthropic";
import { chatToResponsesRequest, toOpenAIChat } from "../src/worker/providers/openai";
import { MessageAccumulator } from "../src/worker/router";
import { anthropicToChat } from "../src/worker/routes/inference";

const env = { OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y" };
const sonnet = resolveModel("anthropic/claude-sonnet-5.5", env);
const gpt = resolveModel("openai/gpt-5.5", env);

describe("model resolution", () => {
  it("accepts OpenRouter IDs, upstream IDs and no-op variants", () => {
    expect(resolveModel("claude-sonnet-5-5", env).id).toBe("anthropic/claude-sonnet-5.5");
    expect(resolveModel("openai/gpt-5.5:nitro", env).id).toBe("openai/gpt-5.5");
    expect(resolveModel("openrouter/auto", env).id).toBeTruthy();
    expect(findModel("claude-sonnet-4-5")?.id).toBe("anthropic/claude-sonnet-4.5");
  });
  it("rejects unknown models and disabled providers", () => {
    expect(() => resolveModel("nope/x", env)).toThrow(/not a valid model/);
    expect(() => resolveModel("openai/gpt-5.5", { ANTHROPIC_API_KEY: "y" })).toThrow(/No provider/);
    expect(() => resolveModel("openai/gpt-5.5:online", env)).toThrow(/variant/);
  });
});

describe("pricing", () => {
  it("bills cached and uncached prompt tokens separately", () => {
    const u = fromAnthropicUsage({ input_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 10 });
    expect(u.prompt_tokens).toBe(1100);
    const cost = computeCost(sonnet, u);
    const p = sonnet.pricing;
    expect(cost.total).toBeCloseTo(100 * +p.prompt + 1000 * +p.input_cache_read! + 10 * +p.completion, 12);
  });
  it("applies long-context price tiers", () => {
    const small = computeCost(gpt, fromOpenAIChatUsage({ prompt_tokens: 1000, completion_tokens: 0 }));
    const big = computeCost(gpt, fromOpenAIChatUsage({ prompt_tokens: 300_000, completion_tokens: 0 }));
    if (gpt.pricing.overrides?.length) expect(big.total / 300).toBeGreaterThan(small.total);
    else expect(big.total / 300).toBeCloseTo(small.total, 12);
  });
  it("prices 1h cache writes and server web searches", () => {
    const u = fromAnthropicUsage({ input_tokens: 0, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_1h_input_tokens: 1000 }, output_tokens: 0, server_tool_use: { web_search_requests: 2 } });
    const p = sonnet.pricing as any;
    expect(computeCost(sonnet, u).total).toBeCloseTo(1000 * +(p.input_cache_write_1h ?? p.input_cache_write) + 2 * +(p.web_search ?? 0), 10);
  });
  it("has no float noise", () => {
    const c = computeCost(sonnet, { prompt_tokens: 23, completion_tokens: 3, cached_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 });
    expect(String(c.completion)).not.toMatch(/0000000000/);
  });
});

describe("key limit windows", () => {
  it("computes UTC daily, weekly (Monday) and monthly starts", () => {
    const t = Date.UTC(2026, 9, 31, 15, 0); // Saturday
    expect(periodStart("daily", t)).toBe(Date.UTC(2026, 9, 31));
    expect(periodStart("weekly", t)).toBe(Date.UTC(2026, 9, 26));
    expect(periodStart("monthly", t)).toBe(Date.UTC(2026, 9, 1));
    expect(periodStart(null, t)).toBe(0);
  });
});

describe("chat → Anthropic", () => {
  it("maps system, tools, tool results and reasoning", () => {
    const req = toAnthropicRequest(
      {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] },
          {
            role: "assistant",
            content: null,
            reasoning_details: [{ type: "reasoning.text", text: "think", signature: "sig", format: "anthropic-claude-v1", index: 0 }],
            tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: '{"a":1}' } }],
          },
          { role: "tool", tool_call_id: "t1", content: "result" },
        ],
        tools: [{ type: "function", function: { name: "f", parameters: { type: "object" } } }],
        tool_choice: "required",
        reasoning: { effort: "high" },
        temperature: 0.5,
        stop: "END",
      },
      sonnet,
      true,
    );
    expect(req.system).toEqual([{ type: "text", text: "sys" }]);
    expect(req.messages[0].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(req.messages[1].content[0]).toEqual({ type: "thinking", thinking: "think", signature: "sig" });
    expect(req.messages[1].content[1]).toMatchObject({ type: "tool_use", id: "t1", input: { a: 1 } });
    expect(req.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(req.tool_choice).toEqual({ type: "any" });
    expect(req.thinking).toMatchObject({ type: "adaptive" });
    expect(req.output_config).toEqual({ effort: "high" });
    // Sonnet 5.5 doesn't support sampling parameters, so they are dropped like on OpenRouter.
    expect(req.temperature).toBeUndefined();
    expect(req.max_tokens).toBeLessThanOrEqual(sonnet.top_provider.max_completion_tokens!);
  });
  it("maps json_schema to structured outputs", () => {
    const req = toAnthropicRequest({ messages: [{ role: "user", content: "x" }], response_format: { type: "json_schema", json_schema: { name: "s", schema: { type: "object" } } } }, sonnet, false);
    expect(req.output_config.format).toEqual({ type: "json_schema", schema: { type: "object" } });
  });
});

describe("chat → OpenAI", () => {
  it("drops unsupported params and maps max_tokens and reasoning", () => {
    const out = toOpenAIChat({ messages: [{ role: "user", content: "x", reasoning: "r" }], max_tokens: 50, temperature: 0.2, top_k: 3, reasoning: { effort: "low" }, provider: { only: ["openai"] } }, gpt);
    expect(out.max_completion_tokens).toBe(50);
    expect(out.top_k).toBeUndefined();
    expect(out.provider).toBeUndefined();
    expect(out.reasoning_effort).toBe("low");
    expect(out.messages[0].reasoning).toBeUndefined();
    expect(out.stream_options).toEqual({ include_usage: true });
  });
  it("translates chat to the Responses API", () => {
    const out = chatToResponsesRequest(
      {
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
          { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: "ok" },
        ],
        max_tokens: 10,
      },
      gpt,
    );
    expect(out.input[0]).toEqual({ role: "developer", content: "sys" });
    expect(out.input[2]).toMatchObject({ type: "function_call", call_id: "c1" });
    expect(out.input[3]).toEqual({ type: "function_call_output", call_id: "c1", output: "ok" });
    expect(out.max_output_tokens).toBe(10);
    expect(out.store).toBe(false);
  });
});

describe("Anthropic → chat (for /messages with OpenAI models)", () => {
  it("maps tool_use and tool_result blocks", () => {
    const out = anthropicToChat({
      system: "sys",
      max_tokens: 10,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: { a: 1 } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
      ],
      tools: [{ name: "f", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
    });
    expect(out.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(out.messages[2].tool_calls[0].function).toEqual({ name: "f", arguments: '{"a":1}' });
    expect(out.messages[3]).toEqual({ role: "tool", tool_call_id: "t1", content: "done" });
    expect(out.tool_choice).toBe("required");
  });
});

describe("stream accumulation", () => {
  it("merges content, tool call deltas and reasoning details", () => {
    const acc = new MessageAccumulator();
    acc.add({ delta: { role: "assistant", content: "Hel" } });
    acc.add({ delta: { content: "lo" } });
    acc.add({ delta: { tool_calls: [{ index: 0, id: "c", type: "function", function: { name: "f", arguments: "" } }] } });
    acc.add({ delta: { tool_calls: [{ index: 0, function: { arguments: '{"x"' } }] } });
    acc.add({ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } });
    acc.add({ delta: { reasoning: "a", reasoning_details: [{ type: "reasoning.text", text: "a", index: 0, format: "anthropic-claude-v1" }] } });
    acc.add({ delta: { reasoning_details: [{ type: "reasoning.text", text: "", signature: "s", index: 0, format: "anthropic-claude-v1" }] } });
    const m = acc.message(false);
    expect(m.content).toBe("Hello");
    expect(m.tool_calls[0].function).toEqual({ name: "f", arguments: '{"x":1}' });
    expect(m.reasoning_details).toEqual([{ type: "reasoning.text", text: "a", signature: "s", index: 0, format: "anthropic-claude-v1" }]);
    expect(acc.message(true).reasoning).toBeNull();
  });
});
