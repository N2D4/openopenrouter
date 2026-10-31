import { Link } from "react-router";
import { CodeTabs } from "../CodeTabs";
import { CLAUDE_CODE, snippets } from "../snippets";

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/api/v1/chat/completions", "OpenAI-style chat completions (streaming, tools, structured outputs, reasoning, model fallbacks)"],
  ["POST", "/api/v1/completions", "Legacy text completions"],
  ["POST", "/api/v1/messages", "Anthropic Messages API, for any model (Claude Code works out of the box)"],
  ["POST", "/api/v1/messages/count_tokens", "Anthropic token counting"],
  ["POST", "/api/v1/responses", "OpenAI Responses API (OpenAI models)"],
  ["POST", "/api/v1/embeddings", "Embeddings"],
  ["GET", "/api/v1/models", "List models (OpenRouter schema)"],
  ["GET", "/api/v1/models/{author}/{slug}/endpoints", "Model endpoints and pricing"],
  ["GET", "/api/v1/embeddings/models", "List embedding models"],
  ["GET", "/api/v1/providers", "List providers"],
  ["GET", "/api/v1/key", "Current API key: usage, limits"],
  ["GET", "/api/v1/credits", "Total credits and usage"],
  ["GET", "/api/v1/generation?id=", "Stats and cost of a generation"],
  ["GET", "/api/v1/activity", "Daily usage grouped by model (last 30 days)"],
  ["GET/POST", "/api/v1/keys", "List and create keys (management keys)"],
  ["GET/PATCH/DELETE", "/api/v1/keys/{hash}", "Get, update and delete keys (management keys)"],
  ["POST", "/api/v1/auth/keys", "Exchange an OAuth PKCE code for a user API key"],
];

export function Docs() {
  return (
    <main className="page narrow">
      <h1>Documentation</h1>
      <p className="muted">
        {__SITE_NAME__} implements the OpenRouter API. Anything written for OpenRouter works by swapping the base URL from{" "}
        <code>https://openrouter.ai/api/v1</code> to <code>{__PUBLIC_URL__}/api/v1</code> and using a {__SITE_NAME__} API key.
      </p>

      <h2>Quickstart</h2>
      <ol className="muted">
        <li>
          Create an API key on the <Link to="/settings/keys">Keys</Link> page.
        </li>
        <li>
          Add credits on the <Link to="/settings/credits">Credits</Link> page.
        </li>
        <li>Send a request:</li>
      </ol>
      <CodeTabs tabs={snippets("openai/gpt-5.5")} />

      <h2>Claude Code and the Anthropic SDK</h2>
      <p className="muted">
        The <code>/api/v1/messages</code> endpoint speaks the Anthropic Messages API for every model, including OpenAI models. Anthropic models are
        passed through natively, including prompt caching, thinking and beta headers.
      </p>
      <pre>
        <code>{CLAUDE_CODE}</code>
      </pre>

      <h2>Model routing</h2>
      <p className="muted">
        Model IDs follow OpenRouter: <code>anthropic/claude-sonnet-5.5</code>, <code>openai/gpt-5.5</code>, and so on. Provider-native IDs such as{" "}
        <code>claude-sonnet-4-5-20250929</code> or <code>gpt-4o</code> are accepted too. Pass <code>models: [...]</code> for fallbacks: if the first
        model's provider is down or rate limited, the next one is tried. <code>openrouter/auto</code> picks a strong default. The <code>provider</code>{" "}
        object supports <code>only</code>, <code>ignore</code>, <code>allow_fallbacks</code>, <code>require_parameters</code> and <code>max_price</code>.
        Parameters a model doesn't support are dropped, as on OpenRouter.
      </p>

      <h2>Reasoning</h2>
      <p className="muted">
        Use <code>reasoning: {"{ effort: \"high\" }"}</code> (or <code>max_tokens</code>, <code>exclude</code>, <code>enabled</code>). Reasoning text is
        returned in <code>message.reasoning</code>, and <code>reasoning_details</code> carries signed blocks you can pass back to keep multi-turn tool use
        working with Claude.
      </p>

      <h2>Usage and cost</h2>
      <p className="muted">
        Every response includes <code>usage</code> with token counts and <code>cost</code> in USD. Look up any request later with{" "}
        <code>GET /api/v1/generation?id=gen-…</code>. Streaming responses end with a usage chunk before <code>[DONE]</code>.
      </p>

      <h2>Sign in with {__SITE_NAME__} (OAuth PKCE)</h2>
      <p className="muted">
        Send users to <code>{__PUBLIC_URL__}/auth?callback_url=…&amp;code_challenge=…&amp;code_challenge_method=S256</code>. After they approve, they
        are redirected to your callback with <code>?code=…</code>, which you exchange for a user-controlled key with{" "}
        <code>POST /api/v1/auth/keys {"{ code, code_verifier }"}</code>.
      </p>

      <h2>Endpoints</h2>
      <div className="card table-wrap">
        <table>
          <tbody>
            {ENDPOINTS.map(([m, p, d]) => (
              <tr key={p}>
                <td className="mono">{m}</td>
                <td className="mono">{p}</td>
                <td className="muted">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Errors</h2>
      <p className="muted">
        Errors use OpenRouter's shape: <code>{"{ error: { code, message, metadata? } }"}</code> with status 400 (bad request), 401 (invalid key), 402
        (insufficient credits), 403 (key disabled or over its limit), 404 (no matching endpoint), 408 (timeout), 429 (rate limited) and 502 (provider
        error).
      </p>

      <h2>Self-hosting</h2>
      <p className="muted">
        {__SITE_NAME__} runs on Cloudflare Workers + D1, with Hexclave for sign-in, emails and payments. Clone{" "}
        <a href="https://github.com/N2D4/openopenrouter">the repository</a> and follow the README to deploy your own instance with your own provider
        keys.
      </p>
    </main>
  );
}
