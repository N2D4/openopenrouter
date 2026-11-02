import { useUser } from "@hexclave/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { REPO_URL, fmtInt, loadModels, money, shortName } from "../api";
import { hexclaveClientApp } from "../hexclave";
import { ArrowRight, AuthorTile, CardIcon, CheckIcon, CodeIcon, ExternalIcon, FingerprintIcon, KeyIcon, LockIcon, MailIcon, PlugIcon, TerminalIcon, UserIcon } from "../icons";
import { useAsync } from "../lib";
import { compactTokens } from "./Models";

const FEATURED = ["anthropic/claude-opus-5.5", "openai/gpt-6.1-sol", "anthropic/claude-sonnet-5.5"];

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

function FeatureCard({ art, title, children, link }: { art: ReactNode; title: string; children: ReactNode; link: ReactNode }) {
  return (
    <div className="feature">
      <div className="feature-art" aria-hidden="true">
        {art}
      </div>
      <div className="feature-body">
        <h3>{title}</h3>
        <p>{children}</p>
        <div className="feature-link">{link}</div>
      </div>
    </div>
  );
}

/** Staggered grid of model chips, fading out at the bottom. */
function ModelsArt({ models }: { models: any[] }) {
  const ids = models.length ? models.map((m) => m.id) : FEATURED;
  const rows = [0, 1, 2, 3, 4].map((r) => Array.from({ length: 5 }, (_, i) => ids[(r * 5 + i) % ids.length] as string));
  return (
    <div className="art-models">
      {rows.map((row, r) => (
        <div key={r} className={r % 2 ? "shift" : ""}>
          {row.map((id, i) => (
            <AuthorTile key={i} author={id.split("/")[0]} size={26} />
          ))}
        </div>
      ))}
    </div>
  );
}

function FallbackArt() {
  return (
    <div className="art-fallback">
      <span className="chip">anthropic/claude-opus-5.5</span>
      <svg viewBox="0 0 200 64" preserveAspectRatio="none">
        <path d="M100 0v64M96 0C96 40 30 24 30 64M104 0c0 40 66 24 66 64" />
      </svg>
      <div className="art-fallback-tiles">
        <span className="tile-ok">
          <AuthorTile author="anthropic" size={32} />
        </span>
        <AuthorTile author="openai" size={32} />
        <AuthorTile author="anthropic" size={32} />
      </div>
    </div>
  );
}

function PriceArt() {
  return (
    <div className="art-price">
      <div className="mini-card back">
        <span>Input / 1M</span>
        <svg viewBox="0 0 120 40">
          <polyline points="0,30 15,26 30,28 45,18 60,22 75,14 90,16 105,10 120,12" className="l1" />
        </svg>
      </div>
      <div className="mini-card front">
        <span>Cost per request</span>
        <svg viewBox="0 0 160 60">
          <polyline points="0,40 12,34 24,38 36,26 48,30 60,22 72,28 84,18 96,24 108,16 120,22 132,14 144,20 160,12" className="l1" />
          <polyline points="0,48 12,46 24,50 36,42 48,44 60,40 72,44 84,36 96,40 108,34 120,38 132,32 144,36 160,30" className="l2" />
        </svg>
      </div>
    </div>
  );
}

function PrivacyArt() {
  return (
    <div className="art-privacy">
      <LockIcon size={18} className="lock left" />
      <span className="check">
        <CheckIcon size={16} />
      </span>
      <LockIcon size={18} className="lock right" />
      <svg viewBox="0 0 100 110" className="shield">
        <path d="M50 4 92 20v34c0 26-18 44-42 52C26 98 8 80 8 54V20Z" />
        <rect x="35" y="48" width="30" height="24" rx="4" />
        <path d="M41 48v-7a9 9 0 0 1 18 0v7" />
      </svg>
    </div>
  );
}

const TOOLS = [
  {
    name: "Claude Code",
    desc: "Claude or GPT models in Anthropic’s coding agent",
    icon: <TerminalIcon size={20} />,
    lines: ["$ export ANTHROPIC_BASE_URL=\\", `    ${__PUBLIC_URL__}/api`, "$ claude --model openai/gpt-6.1-sol"],
    to: "/docs#claude-code",
  },
  {
    name: "OpenAI SDKs",
    desc: "Python, TypeScript and every OpenAI-compatible client",
    icon: <CodeIcon size={20} />,
    lines: ["const client = new OpenAI({", `  baseURL: "${__PUBLIC_URL__}/api/v1",`, "  apiKey: process.env.OOR_KEY,", "});"],
    to: "/docs#quickstart",
  },
  {
    name: "OpenRouter Apps",
    desc: "Anything built for OpenRouter, with one changed URL",
    icon: <PlugIcon size={20} />,
    lines: ["- https://openrouter.ai/api/v1", `+ ${__PUBLIC_URL__}/api/v1`],
    to: "/docs#endpoints",
  },
];

export function Home() {
  const user = useUser();
  const models = useAsync(loadModels);
  const list = models.data ?? [];
  const featured = FEATURED.map((id) => list.find((m) => m.id === id)).filter(Boolean);
  const getKey = () => (user ? undefined : hexclaveClientApp.redirectToSignUp());

  return (
    <main className="landing">
      <section className="hero">
        <h1>
          The Open Interface
          <br />
          For Every Model
        </h1>
        <p className="hero-sub">
          Same <Link to="/docs">API</Link>, provider <Link to="/models?sort=price">prices</Link>, <a href={REPO_URL}>open source</a>.
        </p>
        <div className="hero-ctas">
          {user ? (
            <Link className="btn primary xl" to="/settings/keys">
              Get API Key
            </Link>
          ) : (
            <button type="button" className="btn primary xl" onClick={getKey}>
              Get API Key
            </button>
          )}
          <Link className="btn xl" to="/models">
            Discover Models
          </Link>
        </div>
      </section>

      <section className="stats" aria-label="At a glance">
        <div>
          <p className="stat-value">{list.length ? `${list.length}+` : "50+"}</p>
          <p className="stat-label">Models</p>
        </div>
        <div>
          <p className="stat-value">0%</p>
          <p className="stat-label">Token Markup</p>
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

      <section className="features">
        <FeatureCard
          art={<ModelsArt models={list} />}
          title="Every Frontier Model"
          link={<Link to="/models">Browse all</Link>}
        >
          GPT, Claude and embedding models through a single endpoint and a single API key.
        </FeatureCard>
        <FeatureCard
          art={<FallbackArt />}
          title="Automatic Fallbacks"
          link={
            <Link to="/docs#routing">
              Learn more <ExternalIcon size={14} />
            </Link>
          }
        >
          Pass a list of models and requests move to the next one when a provider errors or rate-limits.
        </FeatureCard>
        <FeatureCard
          art={<PriceArt />}
          title="Provider Prices"
          link={
            <Link to="/docs#usage">
              Learn more <ExternalIcon size={14} />
            </Link>
          }
        >
          Pay exactly what the provider charges per token, including prompt-cache discounts. Prepaid credits, no subscriptions.
        </FeatureCard>
        <FeatureCard
          art={<PrivacyArt />}
          title="Private by Default"
          link={
            <a href={REPO_URL}>
              View source <ExternalIcon size={14} />
            </a>
          }
        >
          Prompts and completions are never stored. Keys are hashed at rest. Or run your own copy on Cloudflare.
        </FeatureCard>
      </section>

      <section className="section">
        <SectionHead title="Featured Models" sub={`${list.length || "50+"} models from OpenAI and Anthropic`} to="/models" />
        <div className="cards-3">
          {featured.map((m) => (
            <Link key={m.id} to={`/models/${m.id}`} className="model-card">
              <div className="model-card-head">
                <AuthorTile author={m.id.split("/")[0]} />
                <div>
                  <h3>{shortName(m.name)}</h3>
                  <p>by {m.id.split("/")[0]}</p>
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
        <SectionHead title="Works With Your Tools" sub="Any OpenAI-, Anthropic- or OpenRouter-compatible client, unchanged" to="/docs" cta="View docs" />
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

      <section className="section how">
        <h2>How it works</h2>
        <div className="steps">
          <div className="step">
            <div className="step-head">
              <span className="step-num">1</span>
              <h3>Sign up</h3>
            </div>
            <p>Create an account with your email, a passkey, Google or GitHub.</p>
            <div className="step-art">
              <div className="skel-row">
                <UserIcon size={18} />
                <i style={{ width: 24 }} />
                <i style={{ width: 48 }} />
              </div>
              <div className="icon-tiles">
                <span title="Email code">
                  <MailIcon size={18} />
                </span>
                <span title="Passkey">
                  <FingerprintIcon size={18} />
                </span>
                <span title="Google">G</span>
                <span title="GitHub">
                  <CodeIcon size={18} />
                </span>
              </div>
            </div>
          </div>
          <div className="step">
            <div className="step-head">
              <span className="step-num">2</span>
              <h3>Buy credits</h3>
            </div>
            <p>Credits work with every model. Set per-key spend limits whenever you like.</p>
            <div className="step-art">
              <div className="skel-row">
                <CardIcon size={18} />
                <i style={{ width: 24 }} />
                <i style={{ width: 24 }} />
                <i style={{ width: 24 }} />
                <i style={{ width: 24 }} />
              </div>
              <div className="ledger">
                <div>
                  <span>Nov 2</span>
                  <i />
                  <i />
                  <strong>$25</strong>
                </div>
                <div>
                  <span>Oct 30</span>
                  <i />
                  <i />
                  <strong>$10</strong>
                </div>
              </div>
            </div>
          </div>
          <div className="step">
            <div className="step-head">
              <span className="step-num">3</span>
              <h3>Get your API key</h3>
            </div>
            <p>
              Create an API key and start making requests. <Link to="/docs">Fully OpenRouter compatible</Link>.
            </p>
            <div className="step-art">
              <div className="keyline">
                <KeyIcon size={18} />
                <span>OPENOPENROUTER_API_KEY</span>
              </div>
              <div className="keydots">••••••••••••••••</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <SectionHead title="Run Your Own" sub="Deploy a private copy to Cloudflare Workers with D1 and Hexclave" to={`${REPO_URL}#self-hosting`} cta="Self-hosting guide" external />
        <div className="selfhost">
          <ul>
            <li>
              <CheckIcon size={16} /> One Worker, one D1 database, no servers to run
            </li>
            <li>
              <CheckIcon size={16} /> Your own provider keys, prices and credit packs
            </li>
            <li>
              <CheckIcon size={16} /> Sign-in, emails and payments through Hexclave
            </li>
            <li>
              <CheckIcon size={16} /> {fmtInt(list.length || 50)}+ models, synced from your provider accounts
            </li>
          </ul>
          <pre className="selfhost-code">
            <code>
              {`git clone ${REPO_URL}
cd openopenrouter && pnpm install
pnpm exec wrangler d1 create openopenrouter
pnpm hexclave:push
pnpm run deploy`}
            </code>
          </pre>
        </div>
      </section>
    </main>
  );
}
