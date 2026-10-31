import { useUser } from "@hexclave/react";
import { Link } from "react-router";
import { publicApi } from "../api";
import { CodeTabs } from "../CodeTabs";
import { hexclaveClientApp } from "../hexclave";
import { useAsync } from "../lib";
import { snippets } from "../snippets";

export function Home() {
  const user = useUser();
  const models = useAsync(() => publicApi<{ data: any[] }>("/models"));
  const count = models.data?.data.length;
  return (
    <main className="page">
      <section className="hero">
        <div>
          <span className="badge accent">Open source · Self-hostable</span>
          <h1 style={{ marginTop: 14 }}>One API for every frontier model. On infrastructure you control.</h1>
          <p className="lead">
            {__SITE_NAME__} is a drop-in, OpenRouter-compatible gateway for OpenAI and Anthropic models. Change the base URL and keep your code, SDKs and
            tools. Run it here, or deploy your own copy to Cloudflare in minutes.
          </p>
          <div className="row wrap">
            {user ? (
              <Link className="btn primary big" to="/settings/keys">
                Get an API key
              </Link>
            ) : (
              <button type="button" className="btn primary big" onClick={() => hexclaveClientApp.redirectToSignUp()}>
                Get started
              </button>
            )}
            <Link className="btn big" to="/models">
              Browse {count ? `${count} models` : "models"}
            </Link>
            <a className="btn big" href="https://github.com/N2D4/openopenrouter">
              Self-host
            </a>
          </div>
        </div>
        <CodeTabs tabs={snippets("anthropic/claude-sonnet-5.5")} />
      </section>
      <section className="features">
        <div className="card pad">
          <h3>Drop-in compatible</h3>
          <p className="muted">
            Same endpoints and model IDs as OpenRouter: <code>/chat/completions</code>, <code>/messages</code>, <code>/responses</code>,{" "}
            <code>/embeddings</code>, <code>/models</code>, <code>/key</code>, <code>/generation</code> and the key management API.
          </p>
        </div>
        <div className="card pad">
          <h3>Provider prices, passed through</h3>
          <p className="muted">Inference is billed at the providers' own per-token prices, with prompt-caching discounts. Prepaid credits, per-key spend limits, no subscriptions.</p>
        </div>
        <div className="card pad">
          <h3>Private by default</h3>
          <p className="muted">Prompts and completions are never stored, only token counts and cost. Keys are hashed at rest. Requests go straight to the provider.</p>
        </div>
      </section>
      <h2>Works with the tools you already use</h2>
      <p className="muted">
        Any OpenAI-compatible SDK (point <code>baseURL</code> at <code>{__PUBLIC_URL__}/api/v1</code>), the Anthropic SDK and Claude Code (
        <code>ANTHROPIC_BASE_URL={__PUBLIC_URL__}/api</code>), the OpenRouter SDKs, LangChain, Vercel AI SDK, Cline, Aider and more. See the{" "}
        <Link to="/docs">docs</Link>.
      </p>
    </main>
  );
}
