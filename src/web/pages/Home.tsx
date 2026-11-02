import { useUser } from "@hexclave/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { REPO_URL, loadModels, money, shortName } from "../api";
import { hexclaveClientApp } from "../hexclave";
import { ArrowRight, AuthorTile, CheckIcon, CloseIcon, CodeIcon, ExternalIcon, PlugIcon, TerminalIcon } from "../icons";
import { useAsync } from "../lib";
import { compactTokens } from "./Models";

const FEATURED = ["anthropic/claude-opus-5.5", "openai/gpt-6.1-sol", "anthropic/claude-sonnet-5.5"];
const HOST = new URL(__PUBLIC_URL__).host;

function SectionHead({ title, sub, to, cta = "View all", external }: { title: string; sub: ReactNode; to: string; cta?: string; external?: boolean }) {
  const inner = (
    <>
      {cta} <ArrowRight size={14} />
    </>
  );
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {external ? (
        <a className="view-all" href={to}>
          {inner}
        </a>
      ) : (
        <Link className="view-all" to={to}>
          {inner}
        </Link>
      )}
    </div>
  );
}

const COMPARISON: [string, ReactNode, ReactNode][] = [
  ["Source code", "Closed", "Open source, MIT licensed"],
  ["Where it runs", "openrouter.ai", <>{HOST}, or your own Cloudflare account</>],
  ["API", "OpenRouter API", "The same API: endpoints, request fields, errors, usage.cost"],
  ["Model IDs", <code>anthropic/claude-opus-5.5</code>, "The same IDs"],
  ["Token prices", "Provider prices", "The same provider prices"],
  ["Fee on credit purchases", "5.5%", "5.5% here, your choice when self-hosted"],
  ["Prompts and completions", "Not stored unless you opt in to logging", "Never stored, no option to turn it on"],
  ["Providers", "Dozens of providers, hundreds of models", "OpenAI and Anthropic"],
];

const SUPPORTED = [
  "/chat/completions with streaming, tools, structured outputs and reasoning",
  "/messages (Anthropic API), also for GPT models",
  "/responses, /completions and /embeddings",
  "models fallbacks and provider preferences",
  "reasoning_details round-tripping and prompt caching",
  "/models, /key, /credits, /generation and /activity",
  "Management keys with per-key spend limits",
  "OAuth PKCE (“Sign in with OpenRouter” flow)",
];

const NOT_YET = ["BYOK", "Presets and guardrails", "Web search (:online)", "Image, audio and video generation", "Batches, files and rerank"];

const TOOLS = [
  {
    name: "OpenRouter SDKs and apps",
    desc: "Anything built for OpenRouter, with one changed URL",
    icon: <PlugIcon size={20} />,
    lines: ["- https://openrouter.ai/api/v1", `+ ${__PUBLIC_URL__}/api/v1`],
    to: "/docs#endpoints",
  },
  {
    name: "OpenAI SDKs",
    desc: "Python, TypeScript and every OpenAI-compatible client",
    icon: <CodeIcon size={20} />,
    lines: ["const client = new OpenAI({", `  baseURL: "${__PUBLIC_URL__}/api/v1",`, "  apiKey: process.env.OOR_KEY,", "});"],
    to: "/docs#quickstart",
  },
  {
    name: "Claude Code",
    desc: "Claude or GPT models in Anthropic’s coding agent",
    icon: <TerminalIcon size={20} />,
    lines: ["$ export ANTHROPIC_BASE_URL=\\", `    ${__PUBLIC_URL__}/api`, "$ claude --model openai/gpt-6.1-sol"],
    to: "/docs#claude-code",
  },
];

export function Home() {
  const user = useUser();
  const models = useAsync(loadModels);
  const list = models.data ?? [];
  const featured = FEATURED.map((id) => list.find((m) => m.id === id)).filter(Boolean);
  const keyButton = user ? (
    <Link className="btn primary xl" to="/settings/keys">
      Get API Key
    </Link>
  ) : (
    <button type="button" className="btn primary xl" onClick={() => hexclaveClientApp.redirectToSignUp()}>
      Get API Key
    </button>
  );

  return (
    <main className="landing">
      <section className="hero">
        <a className="eyebrow" href={REPO_URL}>
          MIT licensed · Self-hostable · Star on GitHub <ArrowRight size={13} />
        </a>
        <h1>
          OpenRouter,
          <br />
          but Open Source
        </h1>
        <p className="hero-sub">
          The same API, model IDs and prices. Use our hosted instance, or run your own.
        </p>
        <div className="hero-ctas">
          {keyButton}
          <a className="btn xl" href={`${REPO_URL}#self-hosting`}>
            Self-host it <ExternalIcon size={14} />
          </a>
        </div>
      </section>

      <section className="migrate" aria-label="Migrating from OpenRouter">
        <div className="migrate-card">
          <div className="migrate-head">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span className="migrate-file">app.ts</span>
          </div>
          <pre>
            <span>{"const client = new OpenAI({\n"}</span>
            <span className="del">{"-  baseURL: \"https://openrouter.ai/api/v1\",\n"}</span>
            <span className="add">{`+  baseURL: "${__PUBLIC_URL__}/api/v1",\n`}</span>
            <span>{"   apiKey: process.env.OPENROUTER_API_KEY,\n});"}</span>
          </pre>
        </div>
        <p>
          That’s the whole migration. Streaming, tools, reasoning, fallbacks and <code>usage.cost</code> keep working.
        </p>
      </section>

      <section className="stats" aria-label="At a glance">
        <div>
          <p className="stat-value">1</p>
          <p className="stat-label">Line to Migrate</p>
        </div>
        <div>
          <p className="stat-value">{list.length || "50+"}</p>
          <p className="stat-label">Models</p>
        </div>
        <div>
          <p className="stat-value">0</p>
          <p className="stat-label">Prompts Stored</p>
        </div>
        <div>
          <p className="stat-value">MIT</p>
          <p className="stat-label">License</p>
        </div>
      </section>

      <section className="section">
        <SectionHead title="OpenRouter vs. OpenOpenRouter" sub="Same API and prices. The difference is who owns the gateway." to="/docs" cta="Read the docs" />
        <div className="compare">
          <table>
            <thead>
              <tr>
                <th />
                <th>OpenRouter</th>
                <th className="ours">{__SITE_NAME__}</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([label, theirs, ours]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{theirs}</td>
                  <td className="ours">{ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="compare-note">
          Need models from every provider? OpenRouter is the better choice today. Want the gateway, the ledger and the logs on infrastructure you control? That’s
          what this is for.
        </p>
      </section>

      <section className="section">
        <SectionHead title="What’s Compatible" sub="The OpenRouter API features people actually use, implemented to the same schema" to="/docs#endpoints" cta="Endpoint reference" />
        <div className="compat">
          <div>
            <h3>Works today</h3>
            <ul>
              {SUPPORTED.map((s) => (
                <li key={s}>
                  <CheckIcon size={16} className="yes" /> {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Not yet</h3>
            <ul>
              {NOT_YET.map((s) => (
                <li key={s} className="faint">
                  <CloseIcon size={16} /> {s}
                </li>
              ))}
            </ul>
            <a className="view-all" href={`${REPO_URL}/issues`}>
              Request a feature <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead title="Same Model IDs" sub="Copy a model ID from OpenRouter and it works here as-is" to="/models" />
        <div className="cards-3">
          {featured.map((m) => (
            <Link key={m.id} to={`/models/${m.id}`} className="model-card">
              <div className="model-card-head">
                <AuthorTile author={m.id.split("/")[0]} />
                <div>
                  <h3>{shortName(m.name)}</h3>
                  <p className="mono">{m.id}</p>
                </div>
              </div>
              <div className="model-card-stats">
                <div>
                  <span>Context</span>
                  <strong>{compactTokens(m.context_length)}</strong>
                </div>
                <div className="right">
                  <span>Input / Output</span>
                  <strong>
                    {money(m.pricing.prompt)} / {money(m.pricing.completion)} <small>per 1M</small>
                  </strong>
                </div>
              </div>
            </Link>
          ))}
          {!featured.length && [0, 1, 2].map((i) => <div key={i} className="model-card skeleton" />)}
        </div>
      </section>

      <section className="section">
        <SectionHead title="Your Integrations, Unchanged" sub="Anything that talks to OpenRouter talks to this" to="/docs" cta="View docs" />
        <div className="cards-3">
          {TOOLS.map((t) => (
            <Link key={t.name} to={t.to} className="tool-card">
              <div className="tool-banner" aria-hidden="true">
                <pre>
                  {t.lines.map((l, i) => (
                    <span key={i} className={l.startsWith("-") ? "del" : l.startsWith("+") ? "add" : ""}>
                      {l}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </div>
              <div className="tool-meta">
                <span className="tool-icon">{t.icon}</span>
                <div>
                  <h3>{t.name}</h3>
                  <p>{t.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <SectionHead title="Use Ours or Run Yours" sub="Same code either way" to={REPO_URL} cta="GitHub" external />
        <div className="paths">
          <div className="path">
            <h3>Hosted at {HOST}</h3>
            <p>Like OpenRouter: an account, prepaid credits and an API key. Nothing to deploy.</p>
            <ol className="path-steps">
              <li>
                <span className="step-num">1</span> Sign up with email, a passkey, Google or GitHub
              </li>
              <li>
                <span className="step-num">2</span> Buy credits, usable with every model
              </li>
              <li>
                <span className="step-num">3</span> Create a key and swap your base URL
              </li>
            </ol>
            {keyButton}
          </div>
          <div className="path">
            <h3>Self-hosted</h3>
            <p>One Cloudflare Worker and a D1 database, with your own provider keys. Sign-in and payments through Hexclave.</p>
            <pre className="selfhost-code">
              <code>
                {`git clone ${REPO_URL}
cd openopenrouter && pnpm install
pnpm exec wrangler d1 create openopenrouter
pnpm hexclave:push && pnpm run deploy`}
              </code>
            </pre>
            <a className="btn xl" href={`${REPO_URL}#self-hosting`}>
              Self-hosting guide <ExternalIcon size={14} />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
